import type { TodoEntry } from '../core/types'
import type { Ctx } from '../ctx'
import { nowSec, NotFoundError } from './shared'

/**
 * 重新打开一个或多个已完成 entry(清 completedAt)——complete 的逆操作。
 * 一次 pull 解析全部 id → 批量 put;任一 id 不存在则整体失败(不改任何条目)。
 */
export async function cmdReopen(ctx: Ctx, a: { ids: string[]; json?: boolean }): Promise<void> {
  if (!a.ids || a.ids.length === 0) {
    throw new Error('entry_id(s) required:  jovida reopen <entry_id> [<entry_id> ...]')
  }
  await ctx.session.ensureSession()
  const snap = await ctx.sync.pull()
  const t = nowSec()
  const reopened: TodoEntry[] = []
  const missing: string[] = []
  for (const id of a.ids) {
    const e = snap.entries.find((x) => x.entryId === id)
    if (e) reopened.push({ ...e, completedAt: 0, updatedAt: t })
    else missing.push(id)
  }
  if (missing.length) throw new NotFoundError(missing.join(', '))
  await ctx.sync.putEntries(reopened)

  if (a.json) {
    console.log(JSON.stringify({ entry_ids: reopened.map((e) => e.entryId), status: 'reopened' }))
    return
  }
  for (const e of reopened) console.log(`✓ reopened  ${e.title}  (${e.entryId})`)
}
