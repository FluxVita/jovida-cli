import { newSubtaskId } from '../core/ids'
import type { Subtask, TodoEntry } from '../core/types'
import type { Ctx } from '../ctx'
import { nowSec, NotFoundError } from './shared'

const ACTIONS = ['check', 'uncheck', 'add', 'rm']

export interface SubtaskArgs {
  action?: string // check | uncheck | add | rm
  entryId?: string
  rest: string[] // check/uncheck/rm: 目标(id 或 1-based 序号);add: 标题词
  json?: boolean
}

/** 把目标(sub_ id 或 1-based 序号)解析为 subtasks 数组下标;无效返回 -1。 */
function resolveIndex(subtasks: Subtask[], target: string): number {
  if (/^\d+$/.test(target)) {
    const idx = Number(target) - 1
    if (idx >= 0 && idx < subtasks.length) return idx
    return -1
  }
  return subtasks.findIndex((s) => s.id === target)
}

/**
 * 管理一条普通待办的子任务:check / uncheck / add / rm。
 * 读改写整条 entry(后端无子任务专用接口,只能整条 upsert),保留其余子任务的 id + 完成状态。
 */
export async function cmdSubtask(ctx: Ctx, a: SubtaskArgs): Promise<void> {
  if (!a.action || !ACTIONS.includes(a.action)) {
    throw new Error('usage: jovida subtask <check|uncheck|add|rm> <entry_id> ...')
  }
  if (!a.entryId) throw new Error(`entry_id required:  jovida subtask ${a.action} <entry_id> ...`)

  await ctx.session.ensureSession()
  const snap = await ctx.sync.pull()
  const entry = snap.entries.find((x) => x.entryId === a.entryId)
  if (!entry) {
    if (snap.recurrings.find((s) => s.recurringId === a.entryId)) {
      throw new Error(
        "That's a repeating todo; its subtasks are a template. Change their titles with `jovida update`. Per-occurrence subtask checking isn't supported."
      )
    }
    throw new NotFoundError(a.entryId)
  }

  let subtasks = [...entry.subtasks]
  const t = nowSec()

  if (a.action === 'add') {
    const title = a.rest.join(' ').trim()
    if (!title) throw new Error('subtask title required:  jovida subtask add <entry_id> "<title>"')
    subtasks.push({ id: newSubtaskId(), title, completedAt: 0 })
  } else {
    if (a.rest.length === 0) {
      throw new Error(`target(s) required:  jovida subtask ${a.action} <entry_id> <id|index ...>`)
    }
    const idxs = a.rest.map((target) => {
      const i = resolveIndex(subtasks, target)
      if (i < 0) {
        throw new Error(`subtask not found: ${target} (use its id like sub_… or a 1-based number from \`jovida view ${a.entryId}\`)`)
      }
      return i
    })
    if (a.action === 'check') for (const i of idxs) subtasks[i] = { ...subtasks[i], completedAt: t }
    else if (a.action === 'uncheck') for (const i of idxs) subtasks[i] = { ...subtasks[i], completedAt: 0 }
    else if (a.action === 'rm') {
      const remove = new Set(idxs)
      subtasks = subtasks.filter((_, i) => !remove.has(i))
    }
  }

  const updated: TodoEntry = { ...entry, subtasks, updatedAt: t }
  await ctx.sync.putEntries([updated])

  if (a.json) {
    console.log(
      JSON.stringify({
        entry_id: entry.entryId,
        subtasks: subtasks.map((s, i) => ({ index: i + 1, id: s.id, title: s.title, completed: s.completedAt > 0 })),
        status: 'updated'
      })
    )
    return
  }
  console.log(`✓ ${entry.title}  (${entry.entryId})`)
  subtasks.forEach((s, i) => console.log(`  ${i + 1}. ${s.completedAt > 0 ? '✓' : '·'} ${s.title}  (${s.id})`))
}
