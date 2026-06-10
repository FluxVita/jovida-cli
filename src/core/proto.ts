// 本地 TodoEntry ↔ 后端 proto3-JSON 的双向映射（同步用）。
// 后端契约:proto3-JSON(base.v1.TodoEntry 等)。
// proto3-JSON 约定：字段名 camelCase；int64 编码为**字符串**；enum 编码为**名字字符串**；
// 默认/零值字段在响应里可能被**省略** → 解析侧一律补默认。第一部分只同步 standalone entry。
import type { TodoEntry, Priority, Subtask, Reminder, TodoRecurring, RepeatRule, RepeatUnit } from './types'

// ---- priority enum ↔ 本地字符串 ----
const PRIORITY_TO_PROTO: Record<Priority, string> = {
  none: 'PRIORITY_NONE',
  low: 'PRIORITY_LOW',
  medium: 'PRIORITY_MEDIUM',
  high: 'PRIORITY_HIGH'
}

// 名字或序号都接受（protojson 通常回名字，但容错数字）。UNSPECIFIED/缺省 → 'none'。
function priorityFromProto(v: unknown): Priority {
  switch (v) {
    case 'PRIORITY_LOW':
    case 2:
      return 'low'
    case 'PRIORITY_MEDIUM':
    case 3:
      return 'medium'
    case 'PRIORITY_HIGH':
    case 4:
      return 'high'
    default:
      return 'none' // PRIORITY_NONE(1) / UNSPECIFIED(0) / 省略
  }
}

// int64：写出转字符串（canonical proto3-JSON）；读入用 Number（时间戳/秒在 JS 安全整数内）。
function i64(n: number): string {
  return String(n)
}
function num(v: unknown): number {
  return v == null ? 0 : Number(v)
}

// ---- RepeatUnit / Weekday enum ↔ 本地 ----
const UNIT_TO_PROTO: Record<RepeatUnit, string> = {
  day: 'REPEAT_UNIT_DAY',
  week: 'REPEAT_UNIT_WEEK',
  month: 'REPEAT_UNIT_MONTH',
  year: 'REPEAT_UNIT_YEAR'
}
function unitFromProto(v: unknown): RepeatUnit {
  switch (v) {
    case 'REPEAT_UNIT_WEEK':
    case 2:
      return 'week'
    case 'REPEAT_UNIT_MONTH':
    case 3:
      return 'month'
    case 'REPEAT_UNIT_YEAR':
    case 4:
      return 'year'
    default:
      return 'day' // REPEAT_UNIT_DAY(1) / UNSPECIFIED(0) / 省略
  }
}

const WEEKDAY_NAMES = [
  'WEEKDAY_UNSPECIFIED',
  'WEEKDAY_MONDAY',
  'WEEKDAY_TUESDAY',
  'WEEKDAY_WEDNESDAY',
  'WEEKDAY_THURSDAY',
  'WEEKDAY_FRIDAY',
  'WEEKDAY_SATURDAY',
  'WEEKDAY_SUNDAY'
]
// 本地 ISO 1-7 → proto enum 名。
function weekdayToProto(iso: number): string {
  return WEEKDAY_NAMES[iso] ?? 'WEEKDAY_UNSPECIFIED'
}
// proto enum 名或序号 → 本地 ISO 1-7（无效返回 0，调用方过滤）。
function weekdayFromProto(v: unknown): number {
  if (typeof v === 'number') return v >= 1 && v <= 7 ? v : 0
  const i = WEEKDAY_NAMES.indexOf(String(v))
  return i >= 1 ? i : 0
}

// ---- 本地 → proto3-JSON ----
export interface ProtoSubtask {
  id: string
  title: string
  completedAt: string
}
export interface ProtoReminder {
  id: string
  canAlarm: boolean
  offsetSecs: string[]
}
export interface ProtoEntry {
  entryId: string
  title: string
  description: string
  category: string
  priority: string
  dueAt: string
  belongAt: string
  recurringId: string
  occurrenceAt: string
  subtasks: ProtoSubtask[]
  reminder?: ProtoReminder
  completedAt: string
  createdAt: string
  updatedAt: string
}

export function entryToProto(e: TodoEntry): ProtoEntry {
  const out: ProtoEntry = {
    entryId: e.entryId,
    title: e.title,
    description: e.description,
    category: e.category,
    priority: PRIORITY_TO_PROTO[e.priority],
    dueAt: i64(e.dueAt),
    belongAt: i64(e.belongAt),
    recurringId: e.recurringId,
    occurrenceAt: i64(e.occurrenceAt),
    subtasks: e.subtasks.map((s) => ({ id: s.id, title: s.title, completedAt: i64(s.completedAt) })),
    completedAt: i64(e.completedAt),
    createdAt: i64(e.createdAt),
    updatedAt: i64(e.updatedAt)
  }
  if (e.reminder) {
    out.reminder = {
      id: e.reminder.id,
      canAlarm: e.reminder.canAlarm,
      offsetSecs: e.reminder.offsetSecs.map(i64)
    }
  }
  return out
}

// ---- proto3-JSON → 本地（缺省字段补默认）----
interface RawEntry {
  entryId?: string
  title?: string
  description?: string
  category?: string
  priority?: unknown
  dueAt?: unknown
  belongAt?: unknown
  recurringId?: string
  occurrenceAt?: unknown
  subtasks?: { id?: string; title?: string; completedAt?: unknown }[]
  reminder?: { id?: string; canAlarm?: boolean; offsetSecs?: unknown[] }
  completedAt?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

export function entryFromProto(o: RawEntry): TodoEntry {
  const subtasks: Subtask[] = (o.subtasks ?? []).map((s) => ({
    id: s.id ?? '',
    title: s.title ?? '',
    completedAt: num(s.completedAt)
  }))
  let reminder: Reminder | null = null
  if (o.reminder) {
    reminder = {
      id: o.reminder.id ?? '',
      canAlarm: o.reminder.canAlarm ?? false,
      offsetSecs: (o.reminder.offsetSecs ?? []).map(num)
    }
  }
  return {
    entryId: o.entryId ?? '',
    title: o.title ?? '',
    description: o.description ?? '',
    category: o.category ?? '',
    priority: priorityFromProto(o.priority),
    dueAt: num(o.dueAt),
    belongAt: num(o.belongAt),
    recurringId: o.recurringId ?? '',
    occurrenceAt: num(o.occurrenceAt),
    subtasks,
    reminder,
    completedAt: num(o.completedAt),
    createdAt: num(o.createdAt),
    updatedAt: num(o.updatedAt),
    hint: '' // hint 是本地列、不在同步 proto；importFromServer 会保留本地既有 hint，不被此 '' 覆盖
  }
}

// ---- TodoRecurring（「类」）↔ proto3-JSON ----
export interface ProtoRepeatRule {
  unit: string
  interval: number
  weekdays: string[]
  dayOfMonth: number
  monthOfYear: number
  endAt: string
}
export interface ProtoRecurring {
  recurringId: string
  title: string
  description: string
  category: string
  priority: string
  dueAt: string
  belongAt: string
  subtasks: ProtoSubtask[]
  reminder?: ProtoReminder
  repeatRule: ProtoRepeatRule
  createdAt: string
  updatedAt: string
}

export function recurringToProto(s: TodoRecurring): ProtoRecurring {
  const out: ProtoRecurring = {
    recurringId: s.recurringId,
    title: s.title,
    description: s.description,
    category: s.category,
    priority: PRIORITY_TO_PROTO[s.priority],
    dueAt: i64(s.dueAt),
    belongAt: i64(s.belongAt),
    subtasks: s.subtasks.map((t) => ({ id: t.id, title: t.title, completedAt: i64(t.completedAt) })),
    repeatRule: {
      unit: UNIT_TO_PROTO[s.repeat.unit],
      interval: s.repeat.interval,
      weekdays: s.repeat.weekdays.map(weekdayToProto),
      dayOfMonth: s.repeat.dayOfMonth,
      monthOfYear: s.repeat.monthOfYear,
      endAt: i64(s.repeat.endAt)
    },
    createdAt: i64(s.createdAt),
    updatedAt: i64(s.updatedAt)
  }
  if (s.reminder) {
    out.reminder = {
      id: s.reminder.id,
      canAlarm: s.reminder.canAlarm,
      offsetSecs: s.reminder.offsetSecs.map(i64)
    }
  }
  return out
}

interface RawRecurring {
  recurringId?: string
  title?: string
  description?: string
  category?: string
  priority?: unknown
  dueAt?: unknown
  belongAt?: unknown
  subtasks?: { id?: string; title?: string; completedAt?: unknown }[]
  reminder?: { id?: string; canAlarm?: boolean; offsetSecs?: unknown[] }
  repeatRule?: {
    unit?: unknown
    interval?: unknown
    weekdays?: unknown[]
    dayOfMonth?: unknown
    monthOfYear?: unknown
    endAt?: unknown
  }
  createdAt?: unknown
  updatedAt?: unknown
}

export function recurringFromProto(o: RawRecurring): TodoRecurring {
  const subtasks: Subtask[] = (o.subtasks ?? []).map((s) => ({
    id: s.id ?? '',
    title: s.title ?? '',
    completedAt: num(s.completedAt)
  }))
  let reminder: Reminder | null = null
  if (o.reminder) {
    reminder = {
      id: o.reminder.id ?? '',
      canAlarm: o.reminder.canAlarm ?? false,
      offsetSecs: (o.reminder.offsetSecs ?? []).map(num)
    }
  }
  const r = o.repeatRule ?? {}
  const repeat: RepeatRule = {
    unit: unitFromProto(r.unit),
    interval: Math.max(1, num(r.interval)),
    weekdays: (r.weekdays ?? []).map(weekdayFromProto).filter((w) => w >= 1 && w <= 7),
    dayOfMonth: num(r.dayOfMonth),
    monthOfYear: num(r.monthOfYear),
    endAt: num(r.endAt)
  }
  return {
    recurringId: o.recurringId ?? '',
    title: o.title ?? '',
    description: o.description ?? '',
    category: o.category ?? '',
    priority: priorityFromProto(o.priority),
    dueAt: num(o.dueAt),
    belongAt: num(o.belongAt),
    subtasks,
    reminder,
    repeat,
    createdAt: num(o.createdAt),
    updatedAt: num(o.updatedAt)
  }
}

// ---- 同步接口响应形（proto3-JSON）----
// put_todo_snapshot 回 { serverVersion } 但写不据它推进版本（版本只由 pull 推进），
// 故此处只需 get_snapshot 的响应形。
export interface TodoObject {
  type?: unknown // OBJECT_TYPE_ENTRY | OBJECT_TYPE_RECURRING（名字或序号）
  objectId?: string
  entry?: RawEntry
  recurring?: RawRecurring
}
export interface GetSnapshotResponse {
  serverVersion?: string
  objects?: TodoObject[]
  nextPageToken?: string
  hasMore?: boolean
  // 分页一致性令牌（后端 harden todo sync versioning）：第一页服务端下发、后续页原样带回；
  // 分页期间服务端版本变化 → 后端回 409 TODO_SNAPSHOT_EXPIRED，客户端从第一页重拉。
  snapshotToken?: string
}
