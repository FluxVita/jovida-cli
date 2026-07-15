// jovida watch — 实时订阅待办变更(push,非轮询)。通过后端通用 SSE 入口订阅自己的 todo
// 同步频道:数据变更 → 收到轻量信号 → 版本门控拉取 → 与上一快照对账 → 输出变更事件流。
// 输出:非 TTY / --json = JSONL 变更事件(每行一个);TTY = 人读变更行。Ctrl-C 优雅退出。
import type { Ctx } from '../ctx'
import type { Snapshot } from '../sync'
import type { TodoEntry, TodoRecurring } from '../core/types'
import { toListItem } from '../core/convert'
import { loadSnapshot } from '../snapshot'
import { watchTodoSync } from '../watch'

export interface WatchArgs {
  json?: boolean
}

type ChangeKind = 'added' | 'updated' | 'completed' | 'reopened' | 'deleted'

interface ChangeEvent {
  event: ChangeKind
  todo: Record<string, unknown>
}

/** 两份快照按 entryId / recurringId 对账,产出变更事件(基线首连通常为空)。 */
function diffSnapshots(prev: Snapshot, next: Snapshot): ChangeEvent[] {
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

const ICON: Record<ChangeKind, string> = {
  added: '＋',
  updated: '~',
  completed: '✓',
  reopened: '↺',
  deleted: '－'
}

export async function cmdWatch(ctx: Ctx, a: WatchArgs): Promise<void> {
  await ctx.session.ensureSession()

  // 基线:当前完整快照(不作为变更输出)。之后每次信号拉取后与之对账。
  let prev = (await loadSnapshot(ctx, { fresh: true })).snap

  const emit = (ev: ChangeEvent): void => {
    if (a.json) {
      console.log(JSON.stringify({ event: ev.event, ...ev.todo }))
    } else {
      const t = ev.todo
      console.log(`${ICON[ev.event]} ${ev.event}  ${t.title ?? ''}  (${t.entry_id ?? t.recurring_id ?? ''})`)
    }
  }

  const controller = new AbortController()
  const onSigint = (): void => controller.abort()
  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigint)

  // 拉取+对账串行化:信号高频到来时合并(有在跑就标记待跑,跑完再补一次),避免并发全量拉。
  let running = false
  let pending = false
  const reconcile = async (): Promise<void> => {
    if (running) {
      pending = true
      return
    }
    running = true
    try {
      do {
        pending = false
        const next = (await loadSnapshot(ctx, { fresh: true })).snap
        for (const ev of diffSnapshots(prev, next)) emit(ev)
        prev = next
      } while (pending && !controller.signal.aborted)
    } finally {
      running = false
    }
  }

  if (!a.json) process.stderr.write('watching for todo changes… (Ctrl-C to stop)\n')

  try {
    await watchTodoSync(ctx, {
      signal: controller.signal,
      onConnect: reconcile, // 首连=基线对账(通常空);重连=补拉断连期间漏掉的变更
      onSignal: reconcile,
      log: (msg) => {
        if (!a.json) process.stderr.write(`${msg}\n`)
      }
    })
  } finally {
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigint)
  }
}
