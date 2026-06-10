// 接口形态 ↔ 存储形态的转换。
// 时间：接口用**单个 `when`** 表达待办时间——纯日期(YYYY-MM-DD)=归属那天、带时刻(ISO datetime)=精确截止；
// 存储侧拆成 belong_at(归属日 0 点) + due_at(截止时刻)，有 due 则 belong 派生 = due 那天。priority 两侧都是字符串。
import type {
  TodoEntry,
  TodoDraft,
  TodoRecurring,
  Subtask,
  Priority,
  Reminder,
  RepeatRule,
  RepeatUnit
} from './types'
import { newSubtaskId, newReminderId } from './ids'
import { reminderAnchorSec } from './reminder'

// ---- 标量 ----
export function isoToSec(iso: string): number {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new Error(`Cannot parse time (ISO 8601 required): ${iso}`)
  return Math.floor(ms / 1000)
}

export function secToIso(sec: number): string {
  return new Date(sec * 1000).toISOString()
}

/** YYYY-MM-DD → 本地时区当天 0 点的 Unix 秒（belong_at 锚点）。 */
export function belongDateToSec(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) throw new Error(`Date must be YYYY-MM-DD: ${date}`)
  return Math.floor(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() / 1000)
}

/** Unix 秒 → 本地时区 YYYY-MM-DD。 */
export function secToBelongDate(sec: number): string {
  const d = new Date(sec * 1000)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * 单个 `when` → 存储的 { dueAt, belongAt }。
 * - 纯日期 `2026-06-05` → 那天的事：belongAt=当天 0 点，无 due。
 * - 带时刻 `2026-06-05T18:00:00+08:00` → 精确截止：dueAt=该时刻，belongAt 派生=due 那天 0 点。
 * 不变量：有 due ⇒ belong = due 那天（belong/due 是同一时间点的两种精度，不允许分属不同天）。
 */
function whenToTime(when?: string): { dueAt?: number; belongAt?: number } {
  if (when === undefined) return {}
  if (DATE_ONLY.test(when)) return { belongAt: belongDateToSec(when) }
  const dueAt = isoToSec(when)
  return { dueAt, belongAt: belongDateToSec(secToBelongDate(dueAt)) }
}

// ---- 入参 → 存储 ----
/** 循环规则入参（AI 友好命名；映射到存储 RepeatRule）。 */
export interface RepeatInput {
  unit: RepeatUnit // day|week|month|year
  interval?: number // 每 N 个单位，默认 1
  weekdays?: number[] // ISO 1=周一..7=周日（week 用）
  day_of_month?: number // 1-31（month/year 用）
  month_of_year?: number // 1-12（year 用）
  until?: string // 结束（YYYY-MM-DD | ISO datetime），缺省=永不结束
}
export interface DraftInput {
  title: string
  description?: string
  category?: string
  priority?: Priority
  when?: string // ISO8601：日期=归属那天 | datetime=精确截止；循环时为「首次发生日期」（种子）
  subtasks?: { title: string }[]
  remind_at?: string | string[] // 提醒时刻，可多个；须早于 when（截止 / 归属日结束）
  hint?: string // companion 口吻短提示（≤~20 字）；仅在确有帮助时附带，否则省略
  repeat?: RepeatInput // 存在=循环待办；需配合 when 指定首次发生日期
}
export type ChangesInput = Partial<DraftInput>

// repeat 入参 → 存储 RepeatRule。until（日期或时刻）→ endAt（落在结束日即可，发生计算按「日」比较）。
function toRepeat(r: RepeatInput | undefined): RepeatRule | undefined {
  if (!r) return undefined
  let endAt = 0
  if (r.until) endAt = DATE_ONLY.test(r.until) ? belongDateToSec(r.until) : isoToSec(r.until)
  return {
    unit: r.unit,
    interval: r.interval && r.interval > 0 ? r.interval : 1,
    weekdays: (r.weekdays ?? []).filter((w) => Number.isInteger(w) && w >= 1 && w <= 7),
    dayOfMonth: r.day_of_month ?? 0,
    monthOfYear: r.month_of_year ?? 0,
    endAt
  }
}

function toSubtasks(items?: { title: string }[]): Subtask[] | undefined {
  return items?.map((s) => ({ id: newSubtaskId(), title: s.title, completedAt: 0 }))
}

// reminder 触发锚 reminderAnchorSec 见 capability/reminder/triggers.ts（与调度器共用）。

// remind_at（一个或多个 ISO 绝对时刻）→ Reminder。每个 offset = 锚 − remind_at，须 ≥0（提醒只能在锚前）。
function toReminder(
  remindAt: string | string[] | undefined,
  dueAt?: number,
  belongAt?: number
): Reminder | undefined {
  if (remindAt === undefined) return undefined
  const list = Array.isArray(remindAt) ? remindAt : [remindAt]
  if (list.length === 0) return undefined
  const anchor = reminderAnchorSec(dueAt, belongAt)
  if (anchor === undefined)
    throw new Error('A reminder needs the todo to have a time first (when: a date or datetime)')
  const offsetSecs = list.map((r) => {
    const off = anchor - isoToSec(r)
    if (off < 0)
      throw new Error(`Reminder time (${r}) is after the todo — it must be at or before the deadline / end of the belong day`)
    return off
  })
  return { id: newReminderId(), canAlarm: true, offsetSecs }
}

/**
 * 无 when 但有 remind_at 时的归属兜底（用户定 2026-06-09）：belongAt = 【最晚】一条提醒的日期 0 点，
 * 不设 due（提醒≠截止）。否则 toReminder 因无锚抛错 → 提案静默建不出来。
 * 取「最晚」（而非最早）：锚 = belong+1天（归属日结束）须 ≥ 所有提醒才都合法、不被「晚于归属」拒。
 */
function belongFromReminders(remindAt: string | string[] | undefined): number | undefined {
  if (remindAt === undefined) return undefined
  const list = Array.isArray(remindAt) ? remindAt : [remindAt]
  if (list.length === 0) return undefined
  const latest = Math.max(...list.map(isoToSec))
  return belongDateToSec(secToBelongDate(latest))
}

// 存储 Reminder → remind_at 列表（ISO）：锚 − 各 offset。用于读工具回显（与入参对称）。
// 结构化入参（dueAt/belongAt/reminder）→ entry 与 recurring「类」通用。
function reminderToIsoList(e: { dueAt: number; belongAt: number; reminder: Reminder | null }): string[] | undefined {
  if (!e.reminder || e.reminder.offsetSecs.length === 0) return undefined
  const anchor = reminderAnchorSec(e.dueAt, e.belongAt)
  if (anchor === undefined) return undefined
  return e.reminder.offsetSecs.map((o) => secToIso(anchor - o))
}

// 存储 RepeatRule → 输出（与入参对称，按 unit 只给相关字段）。
export function repeatToOutput(r: RepeatRule): Record<string, unknown> {
  const out: Record<string, unknown> = { unit: r.unit, interval: r.interval }
  if (r.unit === 'week' && r.weekdays.length > 0) out.weekdays = r.weekdays
  if ((r.unit === 'month' || r.unit === 'year') && r.dayOfMonth > 0) out.day_of_month = r.dayOfMonth
  if (r.unit === 'year' && r.monthOfYear > 0) out.month_of_year = r.monthOfYear
  if (r.endAt > 0) out.until = secToBelongDate(r.endAt)
  return out
}

// 存储 → 单个 when：有 due 回显完整时刻，否则回显归属日期。
function toWhen(e: TodoEntry): string | undefined {
  if (e.dueAt > 0) return secToIso(e.dueAt)
  if (e.belongAt > 0) return secToBelongDate(e.belongAt)
  return undefined
}

export function toDraft(item: DraftInput): TodoDraft {
  const { dueAt, belongAt: belongFromWhen } = whenToTime(item.when)
  // 无 when（due/belong 皆无）但有 remind_at → 归属兜底到最晚提醒那天，使 toReminder 有锚可算。
  const belongAt = belongFromWhen ?? belongFromReminders(item.remind_at)
  return {
    title: item.title,
    description: item.description,
    category: item.category,
    priority: item.priority,
    dueAt,
    belongAt,
    subtasks: toSubtasks(item.subtasks),
    reminder: toReminder(item.remind_at, dueAt, belongAt),
    hint: item.hint,
    repeat: toRepeat(item.repeat)
  }
}

/** update：读当前 target、用 changes 覆盖，产出完整 draft（与后端整条覆盖语义一致）。 */
export function mergeDraft(target: TodoEntry, changes: ChangesInput): TodoDraft {
  // 改了 when 才重新分流；否则沿用 target 的 due/belong。
  const { dueAt, belongAt: belongFromWhen } =
    changes.when !== undefined
      ? whenToTime(changes.when)
      : { dueAt: target.dueAt || undefined, belongAt: target.belongAt || undefined }
  // 仍无 due/belong（target 也没）但本次改了 remind_at → 同 toDraft，兜底到最晚提醒那天。
  const belongAt = belongFromWhen ?? belongFromReminders(changes.remind_at)
  return {
    title: changes.title ?? target.title,
    description: changes.description ?? target.description,
    category: changes.category ?? target.category,
    priority: changes.priority ?? target.priority,
    dueAt,
    belongAt,
    subtasks: changes.subtasks !== undefined ? toSubtasks(changes.subtasks) : target.subtasks,
    // 改了 remind_at 才按新锚重算；否则保留原 offset（锚变则提醒时刻随之平移，符合"提前量"语义）
    reminder:
      changes.remind_at !== undefined ? toReminder(changes.remind_at, dueAt, belongAt) : (target.reminder ?? undefined),
    hint: changes.hint ?? target.hint
  }
}

// ---- 存储 → 接口返回 ----
export function toListItem(e: TodoEntry): Record<string, unknown> {
  return {
    entry_id: e.entryId,
    title: e.title,
    when: toWhen(e),
    priority: e.priority,
    status: e.completedAt > 0 ? 'completed' : 'pending',
    category: e.category,
    // 循环发生（材料化的或虚发生）带回 recurring_id，AI 据此知道这是循环待办的某次发生。
    recurring_id: e.recurringId || undefined
  }
}

/** entry 完整视图。`repeat` 仅当调用方查到所属「类」时传入（材料化/虚发生回显其循环规则）。 */
export function toFullTodo(e: TodoEntry, repeat?: RepeatRule): Record<string, unknown> {
  return {
    entry_id: e.entryId,
    title: e.title,
    description: e.description,
    category: e.category,
    priority: e.priority,
    when: toWhen(e),
    subtasks: e.subtasks.map((s) => ({ title: s.title, completed: s.completedAt > 0 })),
    remind_at: reminderToIsoList(e),
    hint: e.hint || undefined,
    status: e.completedAt > 0 ? 'completed' : 'pending',
    completed_at: e.completedAt > 0 ? secToIso(e.completedAt) : undefined,
    recurring_id: e.recurringId || undefined,
    occurrence_at: e.occurrenceAt > 0 ? secToBelongDate(e.occurrenceAt) : undefined,
    repeat: repeat ? repeatToOutput(repeat) : undefined,
    created_at: secToIso(e.createdAt),
    updated_at: secToIso(e.updatedAt)
  }
}

/** 循环「类」视图（todo_get 传入 recurring_id 时返回）。nextOccurrences = 近几次发生日（YYYY-MM-DD）。 */
export function toSeriesTodo(s: TodoRecurring, nextOccurrences: string[]): Record<string, unknown> {
  return {
    recurring_id: s.recurringId,
    type: 'recurring',
    title: s.title,
    description: s.description,
    category: s.category,
    priority: s.priority,
    when: s.dueAt > 0 ? secToIso(s.dueAt) : secToBelongDate(s.belongAt), // 首次发生（种子）
    subtasks: s.subtasks.map((st) => ({ title: st.title, completed: st.completedAt > 0 })),
    remind_at: reminderToIsoList(s),
    repeat: repeatToOutput(s.repeat),
    next_occurrences: nextOccurrences,
    created_at: secToIso(s.createdAt),
    updated_at: secToIso(s.updatedAt)
  }
}
