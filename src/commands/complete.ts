import type { TodoEntry } from '../core/types'
import type { Ctx } from '../ctx'
import { occurrenceToEntry, parseOccurrenceId, seriesOccursOn, ymdFromSec } from '../core/recurrence'
import { loadForWrite } from '../snapshot'
import { nowSec, NotFoundError } from './shared'

/**
 * 完成一个或多个 entry。一次 pull 解析全部 id → 批量 put;任一 id 不存在则整体失败(不改任何条目)。
 * 若 id 是重复待办的某次「发生」(`recurring:…`)且尚未材料化,则就地 fork 成真实 entry 再完成
 * (确定性 id → 跨端 upsert 合并、不重复)。
 */
export async function cmdComplete(ctx: Ctx, a: { ids: string[]; json?: boolean }): Promise<void> {
  if (!a.ids || a.ids.length === 0) {
    throw new Error('entry_id(s) required:  jovida complete <entry_id> [<entry_id> ...]')
  }
  const snap = await loadForWrite(ctx) // 读那半走本地(免全量 pull);写仍落服务端
  const t = nowSec()
  const done: TodoEntry[] = []
  const missing: string[] = []
  for (const id of a.ids) {
    const e = snap.entries.find((x) => x.entryId === id)
    if (e) {
      done.push({ ...e, completedAt: t, updatedAt: t })
      continue
    }
    // 未材料化的循环发生:按确定性 id fork 成真实 entry。
    const occ = parseOccurrenceId(id)
    const series = occ && snap.recurrings.find((s) => s.recurringId === occ.recurringId)
    if (occ && series && seriesOccursOn(series, ymdFromSec(occ.occurrenceSec))) {
      const forked = occurrenceToEntry(series, ymdFromSec(occ.occurrenceSec))
      done.push({ ...forked, completedAt: t, updatedAt: t })
      continue
    }
    missing.push(id)
  }
  if (missing.length) throw new NotFoundError(missing.join(', '))
  await ctx.sync.putEntries(done)

  if (a.json) {
    console.log(JSON.stringify({ entry_ids: done.map((e) => e.entryId), status: 'completed' }))
    return
  }
  for (const e of done) console.log(`✓ completed  ${e.title}  (${e.entryId})`)
}
