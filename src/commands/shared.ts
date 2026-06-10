import { newEntryId } from '../core/ids'
import type { TodoDraft, TodoEntry } from '../core/types'
import type { Ctx } from '../ctx'

export const nowSec = (): number => Math.floor(Date.now() / 1000)

/** 目标 entry 不存在(exit code 4)。 */
export class NotFoundError extends Error {
  constructor(id: string) {
    super(`todo not found: ${id}`)
    this.name = 'NotFoundError'
  }
}

/** TodoDraft（部分字段）→ 完整 TodoEntry（补 id/时间戳/默认值）。 */
export function draftToEntry(d: TodoDraft): TodoEntry {
  const t = nowSec()
  return {
    entryId: newEntryId(),
    title: d.title,
    description: d.description ?? '',
    category: d.category ?? '',
    priority: d.priority ?? 'none',
    dueAt: d.dueAt ?? 0,
    belongAt: d.belongAt ?? 0,
    recurringId: '',
    occurrenceAt: 0,
    subtasks: d.subtasks ?? [],
    reminder: d.reminder ?? null,
    completedAt: 0,
    createdAt: t,
    updatedAt: t,
    hint: d.hint ?? ''
  }
}

/** 确保登录 + 拉快照找 entry;未找到 → NotFoundError。 */
export async function fetchEntry(ctx: Ctx, id: string): Promise<TodoEntry> {
  await ctx.session.ensureSession()
  const snap = await ctx.sync.pull()
  const e = snap.entries.find((x) => x.entryId === id)
  if (!e) throw new NotFoundError(id)
  return e
}
