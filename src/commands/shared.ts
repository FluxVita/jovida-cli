import { newEntryId, newRecurringId } from '../core/ids'
import type { TodoDraft, TodoEntry, TodoRecurring } from '../core/types'

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

/** 带 repeat 的 TodoDraft → 完整 TodoRecurring「类」（补 id/时间戳/默认值）。dueAt/belongAt = 首次发生(种子)。 */
export function draftToRecurring(d: TodoDraft): TodoRecurring {
  if (!d.repeat) throw new Error('internal: draftToRecurring requires a repeat rule')
  const t = nowSec()
  return {
    recurringId: newRecurringId(),
    title: d.title,
    description: d.description ?? '',
    category: d.category ?? '',
    priority: d.priority ?? 'none',
    dueAt: d.dueAt ?? 0,
    belongAt: d.belongAt ?? 0,
    subtasks: d.subtasks ?? [],
    reminder: d.reminder ?? null,
    repeat: d.repeat,
    createdAt: t,
    updatedAt: t
  }
}
