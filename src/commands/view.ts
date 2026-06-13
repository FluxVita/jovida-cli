import { toFullTodo, toSeriesTodo, repeatToOutput } from '../core/convert'
import { occurrenceToEntry, parseOccurrenceId, seriesOccursOn, ymdFromSec } from '../core/recurrence'
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

  // 普通待办(含已材料化的循环发生)。带 recurringId 的条目附带其重复规则。
  const entry = snap.entries.find((x) => x.entryId === a.id)
  if (entry) {
    const repeat = entry.recurringId
      ? snap.recurrings.find((s) => s.recurringId === entry.recurringId)?.repeat
      : undefined
    const full = toFullTodo(entry, repeat)
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

  // 尚未材料化的循环发生(list 展开出的虚拟项 id):合成发生视图并附带规则。
  const occ = parseOccurrenceId(a.id)
  if (occ) {
    const s = snap.recurrings.find((x) => x.recurringId === occ.recurringId)
    const day = ymdFromSec(occ.occurrenceSec)
    if (s && seriesOccursOn(s, day)) {
      const full = toFullTodo(occurrenceToEntry(s, day), s.repeat)
      if (a.json) {
        console.log(JSON.stringify(full, null, 2))
        return
      }
      const lines = [
        `[ ] ${s.title}  🔁`,
        `    id        ${full.entry_id}`,
        full.when ? `    when      ${full.when}` : '',
        `    repeat    ${fmtRepeat(repeatToOutput(s.repeat))}`,
        `    priority  ${s.priority}`,
        s.category ? `    list      ${s.category}` : '',
        s.description ? `    note      ${s.description}` : '',
        full.remind_at ? `    remind    ${(full.remind_at as string[]).join(', ')}` : '',
        s.subtasks.length ? `    subtasks  ${s.subtasks.map((st, i) => `${i + 1}.· ${st.title}`).join('  ')}` : ''
      ].filter(Boolean)
      console.log(lines.join('\n'))
      return
    }
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
