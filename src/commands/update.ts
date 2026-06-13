import {
  mergeDraft,
  mergeRepeat,
  normalizeRepeatUnit,
  parseWeekdays,
  type ChangesInput,
  type RepeatInput
} from '../core/convert'
import type { Priority, RepeatUnit, TodoEntry, TodoRecurring } from '../core/types'
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
  json?: boolean
}

export async function cmdUpdate(ctx: Ctx, a: UpdateArgs): Promise<void> {
  if (!a.id) throw new Error('id required:  jovida update <entry_id | recurring_id> [--title ...] ...')
  if (a.priority && !PRIORITIES.includes(a.priority as Priority)) {
    throw new Error(`--priority must be one of: ${PRIORITIES.join(', ')}`)
  }

  // 重复规则的部分变更(传了任一相关 flag 才有)。
  const repeatTouched =
    a.repeat !== undefined ||
    a.every !== undefined ||
    a.weekdays !== undefined ||
    a.dayOfMonth !== undefined ||
    a.monthOfYear !== undefined ||
    a.until !== undefined
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
    await ctx.sync.putRecurrings([updated])
    if (a.json) console.log(JSON.stringify({ recurring_id: updated.recurringId, status: 'updated' }))
    else console.log(`✓ updated (repeating)  ${updated.title}  (${updated.recurringId})`)
    return
  }

  throw new NotFoundError(a.id)
}
