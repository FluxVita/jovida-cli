// 待办即触发器（rules）——「当 X 发生就做 Y」的声明式规则。纯模块：类型、读写 rules.json、
// 匹配、模板渲染。执行（exec/notify）与冷却在 ../rules.ts（有状态），实际触发在守护里（嵌入式）。
//
// 事件词汇复用 watch 的变更种类 + 守护本地定时器的时刻：
//   added|updated|completed|reopened|deleted（快照对账）、reminder|overdue（本地时刻）。
// 规则的 on 里可写这些，或 '*' 匹配全部。match 是可选过滤（标题含/分类/优先级，全 AND）。
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { ulid } from 'ulid'
import type { Priority } from './types'
import type { ChangeKind } from './diff'

// 触发时刻种类（守护本地定时器产出，非数据变更）。与 ChangeKind 并集构成规则事件词汇。
export type MomentKind = 'reminder' | 'overdue'
export type RuleEventKind = ChangeKind | MomentKind
export type RuleOn = RuleEventKind | '*'

export const ALL_EVENT_KINDS: RuleEventKind[] = [
  'added',
  'updated',
  'completed',
  'reopened',
  'deleted',
  'reminder',
  'overdue'
]

/** 一条规则命中时拿到的事件（种类 + 待办的列表形态字段）。 */
export interface RuleEvent {
  kind: RuleEventKind
  todo: Record<string, unknown> // toListItem 形态：entry_id/title/when/priority/status/category/recurring_id
}

/** 可选过滤，全部 AND；缺省=不限。 */
export interface RuleMatch {
  title_contains?: string // 标题子串，大小写不敏感
  category?: string // 分类精确匹配
  priority?: Priority // 优先级精确匹配
}

/** 内置桌面通知动作；title/message/subtitle 支持 {title}/{event}/{category}… 模板占位。 */
export interface RuleNotify {
  title?: string
  message?: string
  subtitle?: string
}

export interface Rule {
  id: string
  name?: string
  on: RuleOn[] // 事件种类；含 '*' = 任意
  match?: RuleMatch
  exec?: string // shell 命令（sh -c 跑；事件 JSON 走 stdin + JOVIDA_* 环境变量）
  notify?: RuleNotify // 内置通知
  enabled: boolean
  cooldown_sec?: number // 同一规则两次触发的最短间隔（秒），防抖；缺省=不限
}

export interface RulesFile {
  rules: Rule[]
}

const DIR = process.env['JOVIDA_HOME'] ?? join(homedir(), '.jovida', 'cli')
export const RULES_FILE = join(DIR, 'rules.json')

export const newRuleId = (): string => `rul_${ulid()}`

function ensureDir(): void {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true, mode: 0o700 })
}

/** 解析 rules.json 文本 → 规则列表（容错：坏结构/坏项一律跳过，绝不抛，避免拖垮守护）。 */
export function parseRules(text: string): Rule[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return []
  }
  const raw = (data as { rules?: unknown })?.rules
  if (!Array.isArray(raw)) return []
  const out: Rule[] = []
  for (const r of raw) {
    const rule = r as Partial<Rule>
    if (!rule || typeof rule.id !== 'string' || !Array.isArray(rule.on)) continue
    if (!rule.exec && !rule.notify) continue // 无动作的规则无意义
    out.push({
      id: rule.id,
      name: typeof rule.name === 'string' ? rule.name : undefined,
      on: rule.on.filter((k): k is RuleOn => typeof k === 'string'),
      match: rule.match,
      exec: typeof rule.exec === 'string' ? rule.exec : undefined,
      notify: rule.notify,
      enabled: rule.enabled !== false, // 缺省视为启用
      cooldown_sec: typeof rule.cooldown_sec === 'number' ? rule.cooldown_sec : undefined
    })
  }
  return out
}

/** 读 rules.json（不存在/坏 → 空表）。命令与守护共用；守护侧另有 mtime 缓存见 ../rules.ts。 */
export function loadRules(): Rule[] {
  try {
    return parseRules(readFileSync(RULES_FILE, 'utf8'))
  } catch {
    return []
  }
}

export function saveRules(rules: Rule[]): void {
  ensureDir()
  writeFileSync(RULES_FILE, JSON.stringify({ rules } satisfies RulesFile, null, 2) + '\n', { mode: 0o600 })
}

/** 事件是否命中规则：启用 + on 覆盖其种类 + match 全过。 */
export function matchRule(ev: RuleEvent, rule: Rule): boolean {
  if (!rule.enabled) return false
  if (!rule.on.includes('*') && !rule.on.includes(ev.kind)) return false
  const m = rule.match
  if (m) {
    const title = String(ev.todo.title ?? '')
    if (m.title_contains && !title.toLowerCase().includes(m.title_contains.toLowerCase())) return false
    if (m.category && String(ev.todo.category ?? '') !== m.category) return false
    if (m.priority && String(ev.todo.priority ?? '') !== m.priority) return false
  }
  return true
}

/** 事件 → 模板/环境变量上下文（字符串化，缺省空串）。 */
export function eventContext(ev: RuleEvent): Record<string, string> {
  const t = ev.todo
  const s = (v: unknown): string => (v === undefined || v === null ? '' : String(v))
  return {
    event: ev.kind,
    title: s(t.title),
    entry_id: s(t.entry_id),
    recurring_id: s(t.recurring_id),
    when: s(t.when),
    priority: s(t.priority),
    category: s(t.category),
    status: s(t.status)
  }
}

/** `{key}` 占位替换（未知键 → 空串）。用于 notify 的 title/message/subtitle。 */
export function renderTemplate(tpl: string, ctx: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => ctx[k] ?? '')
}
