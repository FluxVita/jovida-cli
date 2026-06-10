import { mergeDraft, type ChangesInput } from '../core/convert'
import type { Priority, TodoEntry } from '../core/types'
import type { Ctx } from '../ctx'
import { fetchEntry, nowSec } from './shared'

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
  json?: boolean
}

export async function cmdUpdate(ctx: Ctx, a: UpdateArgs): Promise<void> {
  if (!a.id) throw new Error('entry_id required:  jovida update <entry_id> [--title ...] ...')
  if (a.priority && !PRIORITIES.includes(a.priority as Priority)) {
    throw new Error(`--priority must be one of: ${PRIORITIES.join(', ')}`)
  }
  const entry = await fetchEntry(ctx, a.id) // 含 ensureSession + pull(追平版本)

  const changes: ChangesInput = {}
  if (a.title !== undefined) changes.title = a.title
  if (a.when !== undefined) changes.when = a.when
  if (a.priority !== undefined) changes.priority = a.priority as Priority
  if (a.category !== undefined) changes.category = a.category
  if (a.desc !== undefined) changes.description = a.desc
  if (a.remind !== undefined) changes.remind_at = a.remind
  if (a.subtask !== undefined) changes.subtasks = a.subtask.map((s) => ({ title: s }))
  if (a.hint !== undefined) changes.hint = a.hint

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
}
