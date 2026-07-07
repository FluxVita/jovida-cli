// 飞书(Lark)任务 → Jovida 待办的纯映射(`jovida import lark`)。
// IO(lark-cli 子进程、jovida 同步)在 commands/import.ts;这里只做可测试的形状转换。
//
// 幂等契约:飞书任务 guid → 确定性 entryId `lark_<guid>`。重复导入对同一任务算出同一 id,
// 后端按 (user, item_id) upsert,不会重复建;字段没变则连 put 都省掉(调用方 diff)。
import type { TodoEntry } from './types'
import { belongDateToSec, secToBelongDate } from './convert'

export const LARK_ID_PREFIX = 'lark_'

export function larkEntryId(guid: string): string {
  return LARK_ID_PREFIX + guid
}
export function isLarkEntryId(id: string): boolean {
  return id.startsWith(LARK_ID_PREFIX)
}
export function larkGuidOf(id: string): string {
  return id.slice(LARK_ID_PREFIX.length)
}

/** lark openapi task/v2 单条任务(只列映射用到的字段;时间戳是**毫秒字符串**)。 */
export interface LarkTask {
  guid: string
  summary?: string
  description?: string
  url?: string
  completed_at?: string // "0" = 未完成
  created_at?: string
  due?: { is_all_day?: boolean; timestamp?: string }
}

const msToSec = (s?: string): number => {
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? Math.floor(n / 1000) : 0
}

export function larkTaskCompletedAtSec(t: LarkTask): number {
  return msToSec(t.completed_at)
}

/** summary 首个非空行为标题(消息转任务常多行);其余行进 description。 */
export function splitSummary(summary: string): { title: string; rest: string } {
  const lines = summary.split('\n')
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  const title = (lines[i] ?? '').trim().replace(/\s+/g, ' ') || '(untitled)'
  const rest = lines
    .slice(i + 1)
    .join('\n')
    .trim()
  return { title, rest }
}

/** 导入映射出的字段(只覆盖这些;已有条目的 reminder/subtasks/priority 等由调用方原样保留)。 */
export interface MappedLarkTodo {
  entryId: string
  title: string
  description: string
  dueAt: number
  belongAt: number
  createdAt: number // 飞书创建时刻(秒);新建时带上,更新时不动
}

/**
 * 时间映射:
 * - 全天(is_all_day)→ 纯日期待办:belong = 时间戳落在的**本地**日 0 点,无 due。
 *   (飞书全天 due 存日期的 UTC 零点;取本地日对 UTC+8 恰好回到同一天。)
 * - 带时刻 → 精确 due;belong 派生 = due 那天(与 convert.whenToTime 不变量一致)。
 * - 无 due → 两者皆 0(不进 due 雷达,list --scope all 可见)。
 */
export function mapLarkTask(t: LarkTask): MappedLarkTodo {
  const { title, rest } = splitSummary(t.summary ?? '')
  // description = 摘要余行 + 飞书自带描述 + 回跳链接(保留去处,导入不丢上下文)。
  const description = [rest, (t.description ?? '').trim(), t.url ?? '']
    .filter(Boolean)
    .join('\n')
  let dueAt = 0
  let belongAt = 0
  const ts = msToSec(t.due?.timestamp)
  if (ts > 0) {
    belongAt = belongDateToSec(secToBelongDate(ts))
    if (!t.due?.is_all_day) dueAt = ts
  }
  return { entryId: larkEntryId(t.guid), title, description, dueAt, belongAt, createdAt: msToSec(t.created_at) }
}

/** 已导入条目是否需要更新(只比导入管辖的字段;别的字段是用户在 Jovida 侧的,不追平)。 */
export function larkFieldsChanged(cur: TodoEntry, m: MappedLarkTodo): boolean {
  return cur.title !== m.title || cur.description !== m.description || cur.dueAt !== m.dueAt || cur.belongAt !== m.belongAt
}

/** 映射结果 → 新建 TodoEntry(pending;分组默认「飞书」,可由 --category 覆盖)。 */
export function newEntryFromLark(m: MappedLarkTodo, category: string, nowSec: number): TodoEntry {
  return {
    entryId: m.entryId,
    title: m.title,
    description: m.description,
    category,
    priority: 'none',
    dueAt: m.dueAt,
    belongAt: m.belongAt,
    recurringId: '',
    occurrenceAt: 0,
    subtasks: [],
    reminder: null,
    completedAt: 0,
    createdAt: m.createdAt || nowSec,
    updatedAt: nowSec,
    hint: ''
  }
}
