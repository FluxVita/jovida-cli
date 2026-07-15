// 「到期雷达」纯计算:从快照算出 逾期 / 窗口内临期(含提醒触发时刻)。
// 纯函数不触网不读状态;IO/缓存/输出格式在 commands/due.ts。
// 锚定义与 reminder 一致(due 时刻,否则归属日结束)——纯日期待办到当天结束前算「临期」,过了才算逾期。
import type { TodoEntry, TodoRecurring } from './types'
import { reminderAnchorSec } from './reminder'
import { expandRecurring } from './recurrence'

const DAY = 86400

export interface DueItem {
  entry: TodoEntry
  anchorAt: number // 到期锚:due 时刻,或归属日结束(belong+1天)
  nextAt: number // 窗口内最早需要注意的时刻:锚本身,或某次提醒的触发时刻(锚 − offset)
  nextIsReminder: boolean // nextAt 是提醒触发(而非到期本身)
}

export interface DueReport {
  overdue: DueItem[] // 锚已过、未完成(升序=拖得最久在前)
  upcoming: DueItem[] // 窗口内将到期/将提醒(按 nextAt 升序)
}

// 各次提醒的触发时刻。enabled=false(App 端关掉的提醒)不参与;canAlarm 只关乎渠道,不影响时刻。
export function reminderFires(e: TodoEntry, anchor: number): number[] {
  if (!e.reminder || e.reminder.enabled === false) return []
  return e.reminder.offsetSecs.map((o) => anchor - o)
}

/**
 * 计算到期雷达。循环规则展开 [今天0点, 窗口末] 内的虚拟发生混入
 * (更早的未 fork 发生视为已错过的例行,不计逾期——与官方 app 一致,例行不欠账)。
 */
export function computeDue(opts: {
  entries: TodoEntry[]
  recurrings: TodoRecurring[]
  nowSec: number
  withinSecs: number
  todayStart: number // 本地今天 0 点(注入以便测试固定时刻)
}): DueReport {
  const { entries, recurrings, nowSec, withinSecs, todayStart } = opts
  const horizon = nowSec + withinSecs
  const virtuals = expandRecurring({
    recurrings,
    realEntries: entries,
    scope: 'range',
    status: 'pending',
    todayStart,
    tomorrowStart: todayStart + DAY,
    rangeFrom: todayStart,
    rangeTo: horizon,
    horizonDays: 0, // range 有界,不用展望窗
    collapseHorizonDays: 0
  })

  const overdue: DueItem[] = []
  const upcoming: DueItem[] = []
  for (const e of [...entries, ...virtuals]) {
    if (e.completedAt > 0) continue
    const anchor = reminderAnchorSec(e.dueAt, e.belongAt)
    if (anchor === undefined) continue // 无时间的待办不进雷达
    if (anchor < nowSec) {
      overdue.push({ entry: e, anchorAt: anchor, nextAt: anchor, nextIsReminder: false })
      continue
    }
    const times = [anchor, ...reminderFires(e, anchor)].filter((t) => t >= nowSec && t <= horizon)
    if (!times.length) continue
    const nextAt = Math.min(...times)
    upcoming.push({ entry: e, anchorAt: anchor, nextAt, nextIsReminder: nextAt !== anchor })
  }
  overdue.sort((a, b) => a.anchorAt - b.anchorAt)
  upcoming.sort((a, b) => a.nextAt - b.nextAt)
  return { overdue, upcoming }
}
