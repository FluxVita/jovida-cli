import { toDraft, normalizeRepeatUnit, parseWeekdays, type DraftInput, type RepeatInput } from '../core/convert'
import type { Priority } from '../core/types'
import type { Ctx } from '../ctx'
import { draftToEntry, draftToRecurring } from './shared'

const PRIORITIES: Priority[] = ['none', 'low', 'medium', 'high']

export interface CreateArgs {
  title: string
  when?: string
  priority?: string
  category?: string
  desc?: string
  remind?: string[]
  subtask?: string[]
  hint?: string
  // 循环（存在 repeat 即创建循环「类」；需配合 when 指定首次发生）
  repeat?: string // day|week|month|year（+ daily/weekly/... 别名）
  every?: number // 每 N 个单位（interval，默认 1）
  weekdays?: string // week：mon,wed,fri 或 1,3,5
  dayOfMonth?: number // month/year
  monthOfYear?: number // year
  until?: string // 结束（YYYY-MM-DD | ISO）
  json?: boolean
}

export async function cmdCreate(ctx: Ctx, a: CreateArgs): Promise<void> {
  if (!a.title) throw new Error('title is required:  jovida create "<title>" [--when <ISO>] ...')
  if (a.priority && !PRIORITIES.includes(a.priority as Priority)) {
    throw new Error(`--priority must be one of: ${PRIORITIES.join(', ')}`)
  }

  let repeat: RepeatInput | undefined
  if (a.repeat) {
    const unit = normalizeRepeatUnit(a.repeat)
    if (!unit) throw new Error('--repeat must be one of: day, week, month, year')
    if (!a.when) throw new Error('--repeat needs --when (the first date, e.g. --when 2026-06-15)')
    repeat = {
      unit,
      interval: a.every,
      weekdays: parseWeekdays(a.weekdays),
      day_of_month: a.dayOfMonth,
      month_of_year: a.monthOfYear,
      until: a.until
    }
  }

  const input: DraftInput = {
    title: a.title,
    when: a.when,
    priority: a.priority as Priority | undefined,
    category: a.category,
    description: a.desc,
    remind_at: a.remind && a.remind.length ? a.remind : undefined,
    subtasks: a.subtask && a.subtask.length ? a.subtask.map((s) => ({ title: s })) : undefined,
    hint: a.hint,
    repeat
  }
  const draft = toDraft(input) // toDraft 内含 when→belong/due、提醒锚、repeat 解析
  await ctx.session.ensureSession()

  // 循环「类」走 putRecurrings；普通待办走 putEntries。
  if (repeat) {
    const series = draftToRecurring(draft)
    await ctx.sync.putRecurrings([series])
    if (a.json) console.log(JSON.stringify({ recurring_id: series.recurringId, status: 'created' }))
    else console.log(`✓ created (recurring)  ${series.title}  (${series.recurringId})`)
    return
  }

  const entry = draftToEntry(draft)
  await ctx.sync.putEntries([entry])
  if (a.json) console.log(JSON.stringify({ entry_id: entry.entryId, status: 'created' }))
  else console.log(`✓ created  ${entry.title}  (${entry.entryId})`)
}
