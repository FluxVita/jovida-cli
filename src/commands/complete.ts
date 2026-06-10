import type { TodoEntry } from '../core/types'
import type { Ctx } from '../ctx'
import { fetchEntry, nowSec } from './shared'

export async function cmdComplete(ctx: Ctx, a: { id: string; json?: boolean }): Promise<void> {
  if (!a.id) throw new Error('entry_id required:  jovida complete <entry_id>')
  const entry = await fetchEntry(ctx, a.id)
  const t = nowSec()
  const done: TodoEntry = { ...entry, completedAt: t, updatedAt: t }
  await ctx.sync.putEntries([done])

  if (a.json) console.log(JSON.stringify({ entry_id: entry.entryId, status: 'completed' }))
  else console.log(`✓ completed  ${entry.title}  (${entry.entryId})`)
}
