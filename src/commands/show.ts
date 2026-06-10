import { toFullTodo } from '../core/convert'
import type { Ctx } from '../ctx'
import { fetchEntry } from './shared'

export async function cmdShow(ctx: Ctx, a: { id: string; json?: boolean }): Promise<void> {
  if (!a.id) throw new Error('entry_id required:  jovida show <entry_id>')
  const e = await fetchEntry(ctx, a.id)
  const full = toFullTodo(e)

  if (a.json) {
    console.log(JSON.stringify(full, null, 2))
    return
  }
  const lines = [
    `${e.completedAt > 0 ? '[x]' : '[ ]'} ${e.title}`,
    `    id        ${e.entryId}`,
    full.when ? `    when      ${full.when}` : '',
    `    priority  ${e.priority}`,
    e.category ? `    list      ${e.category}` : '',
    e.description ? `    note      ${e.description}` : '',
    full.remind_at ? `    remind    ${(full.remind_at as string[]).join(', ')}` : '',
    e.subtasks.length ? `    subtasks  ${e.subtasks.map((s) => `${s.completedAt > 0 ? '✓' : '·'} ${s.title}`).join('  ')}` : '',
    e.hint ? `    hint      ${e.hint}` : ''
  ].filter(Boolean)
  console.log(lines.join('\n'))
}
