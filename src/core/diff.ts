// 两份快照对账 → 变更事件。给 `jovida watch`(打印事件流)与守护(据此弹通知)共用一套。
// 契约是全量替换,故「上一份」与「这一份」直接按 id 比对即可,无需 delta。
import type { TodoEntry, TodoRecurring } from './types'
import { toListItem } from './convert'

export type ChangeKind = 'added' | 'updated' | 'completed' | 'reopened' | 'deleted'

export interface ChangeEvent {
  event: ChangeKind
  todo: Record<string, unknown>
}

export interface SnapshotLike {
  entries: TodoEntry[]
  recurrings: TodoRecurring[]
}

/** 两份快照按 entryId / recurringId 对账,产出变更事件(基线首连通常为空)。 */
export function diffSnapshots(prev: SnapshotLike, next: SnapshotLike): ChangeEvent[] {
  const out: ChangeEvent[] = []

  const prevE = new Map<string, TodoEntry>(prev.entries.map((e) => [e.entryId, e]))
  const nextE = new Map<string, TodoEntry>(next.entries.map((e) => [e.entryId, e]))
  for (const [id, e] of nextE) {
    const old = prevE.get(id)
    if (!old) {
      out.push({ event: 'added', todo: toListItem(e) })
    } else if (old.completedAt === 0 && e.completedAt > 0) {
      out.push({ event: 'completed', todo: toListItem(e) })
    } else if (old.completedAt > 0 && e.completedAt === 0) {
      out.push({ event: 'reopened', todo: toListItem(e) })
    } else if (old.updatedAt !== e.updatedAt) {
      out.push({ event: 'updated', todo: toListItem(e) })
    }
  }
  for (const [id, e] of prevE) {
    if (!nextE.has(id)) out.push({ event: 'deleted', todo: toListItem(e) })
  }

  // 循环「类」(recurringId):增/改/删。虚拟发生不入账(它们随规则派生,靠上面的 entries 覆盖已材料化的)。
  const prevR = new Map<string, TodoRecurring>(prev.recurrings.map((s) => [s.recurringId, s]))
  const nextR = new Map<string, TodoRecurring>(next.recurrings.map((s) => [s.recurringId, s]))
  for (const [id, s] of nextR) {
    const old = prevR.get(id)
    const todo = { recurring_id: s.recurringId, title: s.title, type: 'repeating' as const }
    if (!old) out.push({ event: 'added', todo })
    else if (old.updatedAt !== s.updatedAt) out.push({ event: 'updated', todo })
  }
  for (const [id, s] of prevR) {
    if (!nextR.has(id)) out.push({ event: 'deleted', todo: { recurring_id: s.recurringId, title: s.title, type: 'repeating' } })
  }

  return out
}
