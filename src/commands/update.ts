import {
  mergeDraft,
  mergeRepeat,
  normalizeRepeatUnit,
  parseWeekdays,
  type ChangesInput,
  type RepeatInput
} from '../core/convert'
import type { Priority, Reminder, RepeatUnit, Subtask, TodoEntry, TodoRecurring } from '../core/types'
import { occurrenceToEntry, parseOccurrenceId, seriesOccursOn, ymdFromSec } from '../core/recurrence'
import type { Ctx } from '../ctx'
import { nowSec, NotFoundError } from './shared'

const PRIORITIES: Priority[] = ['none', 'low', 'medium', 'high']

export interface UpdateArgs {
  id: string
  title?: string
  when?: string
  priority?: string
  category?: string
  desc?: string
  remind?: string[]
  subtask?: string[]
  hint?: string
  // 重复规则(仅当目标是重复待办时适用)
  repeat?: string
  every?: number
  weekdays?: string
  dayOfMonth?: number
  monthOfYear?: number
  until?: string
  // 清空字段(unset 语义;`??` 合并只增不清,故需显式 clear)
  clearWhen?: boolean
  clearRemind?: boolean
  clearCategory?: boolean
  clearDesc?: boolean
  clearSubtasks?: boolean
  clearHint?: boolean
  clearUntil?: boolean // 仅重复待办:移除结束日,恢复永不结束
  json?: boolean
}

/** 把内容字段就地清空(merge 之后套用)。clearWhen 连带清提醒——提醒须有时间锚。 */
function applyContentClears(
  o: { dueAt: number; belongAt: number; reminder: Reminder | null; category: string; description: string; subtasks: Subtask[] },
  a: UpdateArgs
): void {
  if (a.clearWhen) {
    o.dueAt = 0
    o.belongAt = 0
    o.reminder = null
  }
  if (a.clearRemind) o.reminder = null
  if (a.clearCategory) o.category = ''
  if (a.clearDesc) o.description = ''
  if (a.clearSubtasks) o.subtasks = []
}

export async function cmdUpdate(ctx: Ctx, a: UpdateArgs): Promise<void> {
  if (!a.id) throw new Error('id required:  jovida update <entry_id | recurring_id> [--title ...] ...')
  if (a.priority && !PRIORITIES.includes(a.priority as Priority)) {
    throw new Error(`--priority must be one of: ${PRIORITIES.join(', ')}`)
  }
  // set 与 clear 同名互斥。
  const conflict = (setVal: unknown, clear: boolean | undefined, set: string, clr: string): void => {
    if (setVal !== undefined && clear) throw new Error(`--${set} and --${clr} can't be combined`)
  }
  conflict(a.when, a.clearWhen, 'when', 'clear-when')
  conflict(a.remind, a.clearRemind, 'remind', 'clear-remind')
  conflict(a.category, a.clearCategory, 'category', 'clear-category')
  conflict(a.desc, a.clearDesc, 'desc', 'clear-desc')
  conflict(a.subtask, a.clearSubtasks, 'subtask', 'clear-subtasks')
  conflict(a.hint, a.clearHint, 'hint', 'clear-hint')
  conflict(a.until, a.clearUntil, 'until', 'clear-until')

  // 重复规则的部分变更(传了任一相关 flag 才有;clear-until 也算动了规则)。
  const repeatTouched =
    a.repeat !== undefined ||
    a.every !== undefined ||
    a.weekdays !== undefined ||
    a.dayOfMonth !== undefined ||
    a.monthOfYear !== undefined ||
    a.until !== undefined ||
    a.clearUntil === true
  let repeatChanges: Partial<RepeatInput> | undefined
  if (repeatTouched) {
    let unit: RepeatUnit | undefined
    if (a.repeat !== undefined) {
      unit = normalizeRepeatUnit(a.repeat)
      if (!unit) throw new Error('--repeat must be one of: day, week, month, year')
    }
    repeatChanges = {
      unit,
      interval: a.every,
      weekdays: parseWeekdays(a.weekdays),
      day_of_month: a.dayOfMonth,
      month_of_year: a.monthOfYear,
      until: a.until
    }
  }

  // 普通字段变更(entry / recurring 通用;hint 仅 entry 有)。
  const changes: ChangesInput = {}
  if (a.title !== undefined) changes.title = a.title
  if (a.when !== undefined) changes.when = a.when
  if (a.priority !== undefined) changes.priority = a.priority as Priority
  if (a.category !== undefined) changes.category = a.category
  if (a.desc !== undefined) changes.description = a.desc
  if (a.remind !== undefined) changes.remind_at = a.remind
  if (a.subtask !== undefined) changes.subtasks = a.subtask.map((s) => ({ title: s }))
  if (a.hint !== undefined) changes.hint = a.hint

  await ctx.session.ensureSession()
  const snap = await ctx.sync.pull()

  // ── 普通待办 ──
  const entry = snap.entries.find((x) => x.entryId === a.id)
  if (entry) {
    if (repeatTouched) {
      if (entry.recurringId) {
        throw new Error(
          `Can't change the repeat rule from a single occurrence — that belongs to the routine. ` +
            `Edit the whole routine via its recurring_id (${entry.recurringId}).`
        )
      }
      throw new Error(
        "This todo doesn't repeat. Turning an existing todo into a repeating one isn't supported — create a repeating todo instead (jovida create … --repeat …)."
      )
    }
    const d = mergeDraft(entry, changes)
    const updated: TodoEntry = {
      ...entry,
      title: d.title,
      description: d.description ?? '',
      category: d.category ?? '',
      priority: d.priority ?? 'none',
      dueAt: d.dueAt ?? 0,
      belongAt: d.belongAt ?? 0,
      subtasks: d.subtasks ?? [],
      reminder: d.reminder ?? null,
      hint: d.hint ?? '',
      updatedAt: nowSec()
    }
    applyContentClears(updated, a)
    if (a.clearHint) updated.hint = ''
    await ctx.sync.putEntries([updated])
    if (a.json) console.log(JSON.stringify({ entry_id: updated.entryId, status: 'updated' }))
    else console.log(`✓ updated  ${updated.title}  (${updated.entryId})`)
    return
  }

  // ── 重复待办 ──
  const series = snap.recurrings.find((s) => s.recurringId === a.id)
  if (series) {
    // 复用 mergeDraft 处理 when→首次日期 / remind 按锚重算 / subtasks(伪 entry;hint 对重复待办不适用)。
    const pseudo: TodoEntry = {
      entryId: series.recurringId,
      title: series.title,
      description: series.description,
      category: series.category,
      priority: series.priority,
      dueAt: series.dueAt,
      belongAt: series.belongAt,
      recurringId: '',
      occurrenceAt: 0,
      subtasks: series.subtasks,
      reminder: series.reminder,
      completedAt: 0,
      createdAt: series.createdAt,
      updatedAt: series.updatedAt,
      hint: ''
    }
    const d = mergeDraft(pseudo, changes)
    const updated: TodoRecurring = {
      ...series,
      title: d.title,
      description: d.description ?? '',
      category: d.category ?? '',
      priority: d.priority ?? 'none',
      dueAt: d.dueAt ?? 0,
      belongAt: d.belongAt ?? 0,
      subtasks: d.subtasks ?? [],
      reminder: d.reminder ?? null,
      repeat: repeatChanges ? mergeRepeat(series.repeat, repeatChanges) : series.repeat,
      updatedAt: nowSec()
    }
    applyContentClears(updated, a)
    if (a.clearUntil) updated.repeat = { ...updated.repeat, endAt: 0 } // 恢复永不结束
    await ctx.sync.putRecurrings([updated])
    if (a.json) console.log(JSON.stringify({ recurring_id: updated.recurringId, status: 'updated' }))
    else console.log(`✓ updated (repeating)  ${updated.title}  (${updated.recurringId})`)
    return
  }

  // ── 重复待办某次「发生」的 id(尚未材料化)──:override = fork 该发生成真实条目 + 套用改动。
  // (已材料化的发生其 id = 真实 entry id,上面 entry 分支已处理 → 这里只剩纯虚拟发生。)
  const occ = parseOccurrenceId(a.id)
  if (occ) {
    const series = snap.recurrings.find((s) => s.recurringId === occ.recurringId)
    const day = ymdFromSec(occ.occurrenceSec)
    if (series && seriesOccursOn(series, day)) {
      if (repeatTouched) {
        throw new Error(
          `Can't change the repeat rule of a single occurrence — that belongs to the routine. ` +
            `Edit the whole routine via its recurring_id (${series.recurringId}).`
        )
      }
      const base = occurrenceToEntry(series, day) // 继承 series 字段 + 确定性 id/recurringId/occurrenceAt
      const d = mergeDraft(base, changes)
      const forked: TodoEntry = {
        ...base,
        title: d.title,
        description: d.description ?? '',
        category: d.category ?? '',
        priority: d.priority ?? 'none',
        dueAt: d.dueAt ?? 0,
        belongAt: d.belongAt ?? 0,
        subtasks: d.subtasks ?? [],
        reminder: d.reminder ?? null,
        hint: d.hint ?? '',
        updatedAt: nowSec()
      }
      applyContentClears(forked, a)
      if (a.clearHint) forked.hint = ''
      await ctx.sync.putEntries([forked])
      if (a.json) console.log(JSON.stringify({ entry_id: forked.entryId, status: 'updated' }))
      else console.log(`✓ updated (occurrence)  ${forked.title}  (${forked.entryId})`)
      return
    }
  }

  throw new NotFoundError(a.id)
}
