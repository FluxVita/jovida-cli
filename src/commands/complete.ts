import type { TodoEntry } from '../core/types'
import type { Ctx } from '../ctx'
import { nowSec, NotFoundError } from './shared'

/** 完成一个或多个 entry。一次 pull 解析全部 id → 批量 put;任一 id 不存在则整体失败(不改任何条目)。 */
export async function cmdComplete(ctx: Ctx, a: { ids: string[]; json?: boolean }): Promise<void> {
  if (!a.ids || a.ids.length === 0) {
    throw new Error('entry_id(s) required:  jovida complete <entry_id> [<entry_id> ...]')
  }
  await ctx.session.ensureSession()
  const snap = await ctx.sync.pull()
  const t = nowSec()
  const done: TodoEntry[] = []
  const missing: string[] = []
  for (const id of a.ids) {
    const e = snap.entries.find((x) => x.entryId === id)
    if (e) done.push({ ...e, completedAt: t, updatedAt: t })
    else missing.push(id)
  }
  if (missing.length) throw new NotFoundError(missing.join(', '))
  await ctx.sync.putEntries(done)

  if (a.json) {
    console.log(JSON.stringify({ entry_ids: done.map((e) => e.entryId), status: 'completed' }))
    return
  }
  for (const e of done) console.log(`✓ completed  ${e.title}  (${e.entryId})`)
}
