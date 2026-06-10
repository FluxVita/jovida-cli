import { toDraft, type DraftInput } from '../core/convert'
import type { Priority } from '../core/types'
import type { Ctx } from '../ctx'
import { draftToEntry } from './shared'

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
  json?: boolean
}

export async function cmdCreate(ctx: Ctx, a: CreateArgs): Promise<void> {
  if (!a.title) throw new Error('title is required:  jovida create "<title>" [--when <ISO>] ...')
  if (a.priority && !PRIORITIES.includes(a.priority as Priority)) {
    throw new Error(`--priority must be one of: ${PRIORITIES.join(', ')}`)
  }
  const input: DraftInput = {
    title: a.title,
    when: a.when,
    priority: a.priority as Priority | undefined,
    category: a.category,
    description: a.desc,
    remind_at: a.remind && a.remind.length ? a.remind : undefined,
    subtasks: a.subtask && a.subtask.length ? a.subtask.map((s) => ({ title: s })) : undefined,
    hint: a.hint
  }
  const entry = draftToEntry(toDraft(input)) // toDraft 内含 when→belong/due、提醒锚、归属兜底
  await ctx.session.ensureSession()
  await ctx.sync.putEntries([entry])

  if (a.json) console.log(JSON.stringify({ entry_id: entry.entryId, status: 'created' }))
  else console.log(`✓ created  ${entry.title}  (${entry.entryId})`)
}
