// jovida import lark — 把飞书(Lark)「我的任务」单向导入 Jovida。可重复跑:
// - 幂等:guid → `lark_<guid>` 确定性 id,重跑只补新增/追平变化,不重复建;
// - 只导未完成;此前导入的任务在飞书完成后,重跑会把 Jovida 侧也标记完成;
// - 单向:不写飞书;Jovida 侧的完成/编辑不回流。
// 数据源走官方 `lark-cli`(它管飞书鉴权):需已安装并 `lark-cli auth login --domain task`。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  isLarkEntryId,
  larkGuidOf,
  larkTaskCompletedAtSec,
  mapLarkTask,
  larkFieldsChanged,
  newEntryFromLark,
  type LarkTask
} from '../core/lark-import'
import type { TodoEntry } from '../core/types'
import type { Ctx } from '../ctx'

const execFileP = promisify(execFile)
const DEFAULT_CATEGORY = '飞书'

export interface ImportArgs {
  source?: string // 目前仅 'lark'
  category?: string
  dryRun?: boolean
  json?: boolean
}

/** 跑 lark-cli 并解析 JSON stdout。未安装/未登录给可执行的指引,而非裸错误。 */
async function larkCli(args: string[]): Promise<Record<string, unknown>> {
  let stdout: string
  try {
    ;({ stdout } = await execFileP('lark-cli', args, { maxBuffer: 64 * 1024 * 1024 }))
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stdout?: string }
    if (err.code === 'ENOENT') {
      throw new Error(
        'lark-cli not found — the Lark import reads tasks via the official Lark CLI.\n' +
          'Install and sign in first:  npm i -g @larksuite/cli && lark-cli auth login --domain task'
      )
    }
    // lark-cli 失败时常在 stdout 给结构化错误,尽量转述
    stdout = err.stdout ?? ''
    if (!stdout) throw new Error(`lark-cli failed: ${err.message}`)
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(stdout) as Record<string, unknown>
  } catch {
    throw new Error(`lark-cli returned non-JSON output (first 200 chars): ${stdout.slice(0, 200)}`)
  }
  return parsed
}

/** 未完成的「我的任务」guid 列表(compact 投影;全字段随后逐条取)。 */
async function listIncompleteGuids(): Promise<string[]> {
  const r = await larkCli(['task', '+get-my-tasks', '--complete=false', '--page-all', '--format', 'json'])
  if (r.ok !== true) {
    const e = (r.error ?? {}) as { type?: string; message?: string; hint?: string }
    throw new Error(
      `lark-cli could not list tasks${e.type ? ` (${e.type})` : ''}: ${e.message ?? 'unknown error'}` +
        (e.hint ? `\n${e.hint}` : '')
    )
  }
  const items = ((r.data as { items?: { guid?: string }[] })?.items ?? []).filter((t) => t.guid)
  return items.map((t) => t.guid as string)
}

/** 单条任务详情(带 is_all_day / completed_at / description)。404(已删)→ null。 */
async function getTaskDetail(guid: string): Promise<LarkTask | null> {
  const r = await larkCli(['api', 'GET', `/open-apis/task/v2/tasks/${guid}`])
  const code = r.code as number | undefined
  if (code === 0) return (r.data as { task?: LarkTask })?.task ?? null
  return null // 非 0:任务被删/无权限——导入侧按「飞书侧已不存在」处理
}

interface Plan {
  creates: TodoEntry[]
  updates: TodoEntry[]
  completes: TodoEntry[]
  unchanged: number
  orphaned: string[] // Jovida 里 pending 的 lark_ 条目,但飞书侧已删/不可见:不动,仅报告
}

async function buildPlan(ctx: Ctx, category: string): Promise<Plan> {
  const guids = await listIncompleteGuids()
  const snap = await ctx.sync.pull()
  const existing = new Map(snap.entries.filter((e) => isLarkEntryId(e.entryId)).map((e) => [e.entryId, e]))
  const nowSec = Math.floor(Date.now() / 1000)

  const plan: Plan = { creates: [], updates: [], completes: [], unchanged: 0, orphaned: [] }
  const seen = new Set<string>()
  for (const guid of guids) {
    const detail = await getTaskDetail(guid)
    if (!detail) continue // 列表与详情间隙被删,当不存在
    const m = mapLarkTask(detail)
    seen.add(m.entryId)
    const cur = existing.get(m.entryId)
    if (!cur) {
      plan.creates.push(newEntryFromLark(m, category, nowSec))
    } else if (cur.completedAt > 0) {
      plan.unchanged++ // Jovida 侧已完成(单向导入,不因飞书仍 pending 而 reopen)
    } else if (larkFieldsChanged(cur, m)) {
      plan.updates.push({ ...cur, title: m.title, description: m.description, dueAt: m.dueAt, belongAt: m.belongAt, updatedAt: nowSec })
    } else {
      plan.unchanged++
    }
  }

  // 此前导入、Jovida 仍 pending、但已不在飞书未完成列表里的:去飞书确认是完成了还是删了。
  for (const [id, cur] of existing) {
    if (cur.completedAt > 0 || seen.has(id)) continue
    const detail = await getTaskDetail(larkGuidOf(id))
    const doneAt = detail ? larkTaskCompletedAtSec(detail) : 0
    if (doneAt > 0) plan.completes.push({ ...cur, completedAt: doneAt, updatedAt: nowSec })
    else plan.orphaned.push(id) // 飞书侧删了(或查不到):Jovida 侧保留,由用户处置
  }
  return plan
}

export async function cmdImport(ctx: Ctx, a: ImportArgs): Promise<void> {
  if (a.source !== 'lark') {
    throw new Error(`usage: jovida import lark [--category <s>] [--dry-run] [--json]  (supported source: lark)`)
  }
  await ctx.session.ensureSession()
  const category = a.category ?? DEFAULT_CATEGORY
  const plan = await buildPlan(ctx, category)

  if (!a.dryRun) {
    const writes = [...plan.creates, ...plan.updates, ...plan.completes]
    if (writes.length) await ctx.sync.putEntries(writes)
  }

  const summary = {
    source: 'lark',
    dry_run: a.dryRun || undefined,
    created: plan.creates.length,
    updated: plan.updates.length,
    completed: plan.completes.length,
    unchanged: plan.unchanged,
    orphaned: plan.orphaned.length ? plan.orphaned : undefined,
    todos: [
      ...plan.creates.map((e) => ({ entry_id: e.entryId, action: 'create', title: e.title })),
      ...plan.updates.map((e) => ({ entry_id: e.entryId, action: 'update', title: e.title })),
      ...plan.completes.map((e) => ({ entry_id: e.entryId, action: 'complete', title: e.title }))
    ]
  }
  if (a.json) {
    console.log(JSON.stringify(summary, null, 2))
    return
  }
  const head = a.dryRun ? 'would import (dry-run)' : 'imported'
  console.log(`✓ ${head} from Lark: ${plan.creates.length} new · ${plan.updates.length} updated · ${plan.completes.length} completed · ${plan.unchanged} unchanged`)
  for (const t of summary.todos) console.log(`  ${t.action.padEnd(8)} ${t.title}  (${t.entry_id})`)
  if (plan.orphaned.length) {
    console.log(`  note: ${plan.orphaned.length} previously imported todo(s) no longer exist in Lark (kept in Jovida):`)
    for (const id of plan.orphaned) console.log(`    ${id}`)
  }
}
