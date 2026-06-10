// reminder 触发时刻的纯计算。保证「显示的下次提醒」与「同步转换」用同一锚定义。
import type { TodoEntry } from './types'

const DAY_SECS = 86400

/**
 * reminder 触发锚：有精确 due 用 due，否则 belong 当天 24 点（次日 0 点）。
 * 仅用于 reminder offset 计算，区别于 scope 查询锚（belong 当天 0 点）。
 * ⚠️ 跨端契约：所有客户端须用同一锚定义，否则同步后提醒错时。
 */
export function reminderAnchorSec(dueAt?: number, belongAt?: number): number | undefined {
  if (dueAt && dueAt > 0) return dueAt
  if (belongAt && belongAt > 0) return belongAt + DAY_SECS
  return undefined
}

/** entry 的所有提醒触发时刻（Unix 秒，= 锚 − 各 offset）。无 reminder / 无锚 → []。 */
export function triggerTimesSec(entry: TodoEntry): number[] {
  if (!entry.reminder || entry.reminder.offsetSecs.length === 0) return []
  const anchor = reminderAnchorSec(entry.dueAt, entry.belongAt)
  if (anchor === undefined) return []
  return entry.reminder.offsetSecs.map((o) => anchor - o)
}

/** 最近的未来触发时刻（Unix 秒）；无则 undefined（用于 UI 铃铛旁显示）。 */
export function nextTriggerSec(entry: TodoEntry, nowSec: number): number | undefined {
  const future = triggerTimesSec(entry)
    .filter((t) => t > nowSec)
    .sort((a, b) => a - b)
  return future[0]
}
