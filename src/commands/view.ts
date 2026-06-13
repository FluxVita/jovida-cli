import { toFullTodo, toSeriesTodo, repeatToOutput } from '../core/convert'
import type { Ctx } from '../ctx'
import { NotFoundError } from './shared'

const WEEKDAY_NAME = ['', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
/** RepeatRule 输出 → 人类可读一行(如 "week ×2 (mon,wed,fri) until 2026-12-31")。 */
function fmtRepeat(r: Record<string, unknown>): string {
  const parts: string[] = [String(r.unit)]
  if (typeof r.interval === 'number' && r.interval > 1) parts.push(`×${r.interval}`)
  if (Array.isArray(r.weekdays)) parts.push(`(${(r.weekdays as number[]).map((w) => WEEKDAY_NAME[w] ?? w).join(',')})`)
  if (r.day_of_month) parts.push(`day ${r.day_of_month}`)
  if (r.month_of_year) parts.push(`month ${r.month_of_year}`)
  if (r.until) parts.push(`until ${r.until}`)
  return parts.join(' ')
}

export async function cmdView(ctx: Ctx, a: { id: string; json?: boolean }): Promise<void> {
  if (!a.id) throw new Error('entry_id required:  jovida view <entry_id | recurring_id>')
  await ctx.session.ensureSession()
  const snap = await ctx.sync.pull()

  // 普通待办(含重复待办的某次发生)
  const entry = snap.entries.find((x) => x.entryId === a.id)
  if (entry) {
    const full = toFullTodo(entry)
    if (a.json) {
      console.log(JSON.stringify(full, null, 2))
      return
    }
    const lines = [
      `${entry.completedAt > 0 ? '[x]' : '[ ]'} ${entry.title}`,
      `    id        ${entry.entryId}`,
      full.when ? `    when      ${full.when}` : '',
      `    priority  ${entry.priority}`,
      entry.category ? `    list      ${entry.category}` : '',
      entry.description ? `    note      ${entry.description}` : '',
      full.remind_at ? `    remind    ${(full.remind_at as string[]).join(', ')}` : '',
      entry.subtasks.length ? `    subtasks  ${entry.subtasks.map((s, i) => `${i + 1}.${s.completedAt > 0 ? '✓' : '·'} ${s.title}`).join('  ')}` : '',
      entry.hint ? `    hint      ${entry.hint}` : ''
    ].filter(Boolean)
    console.log(lines.join('\n'))
    return
  }

  // 重复待办:用 recurring_id 回看其重复规则(规则本身即完整排程)
  const series = snap.recurrings.find((s) => s.recurringId === a.id)
  if (series) {
    const full = toSeriesTodo(series)
    if (a.json) {
      console.log(JSON.stringify(full, null, 2))
      return
    }
    const lines = [
      `[repeats] ${series.title}`,
      `    id        ${series.recurringId}`,
      `    repeat    ${fmtRepeat(repeatToOutput(series.repeat))}`,
      full.when ? `    first     ${full.when}` : '',
      `    priority  ${series.priority}`,
      series.category ? `    list      ${series.category}` : '',
      series.description ? `    note      ${series.description}` : '',
      full.remind_at ? `    remind    ${(full.remind_at as string[]).join(', ')}` : '',
      series.subtasks.length ? `    subtasks  ${series.subtasks.map((s) => `· ${s.title}`).join('  ')}` : ''
    ].filter(Boolean)
    console.log(lines.join('\n'))
    return
  }

  throw new NotFoundError(a.id)
}
