import type { Ctx } from '../ctx'
import { parseOccurrenceId } from '../core/recurrence'
import { NotFoundError } from './shared'

export async function cmdDelete(ctx: Ctx, a: { ids: string[]; json?: boolean }): Promise<void> {
  if (!a.ids || a.ids.length === 0) {
    throw new Error('entry_id(s) required:  jovida delete <entry_id> [<entry_id> ...]')
  }
  await ctx.session.ensureSession()
  // 发生形 id:已 fork 成真实条目(存在于快照)→ 放行删除;否则按其归属循环是否存在分类——
  // 属现存循环的未材料化发生 → 拒并指引(删除幂等会"成功"误导);否则纯属未知 id → not found。
  // 仅当出现发生形 id 时才多拉一次校验,普通删除免拉。
  const occIds = a.ids.filter((id) => parseOccurrenceId(id))
  if (occIds.length) {
    const snap = await ctx.sync.pull()
    const real = new Set(snap.entries.map((e) => e.entryId))
    const notReal = occIds.filter((id) => !real.has(id))
    const hasSeries = (id: string): boolean => {
      const o = parseOccurrenceId(id)
      return !!o && snap.recurrings.some((s) => s.recurringId === o.recurringId)
    }
    const unmaterialized = notReal.filter(hasSeries)
    const unknown = notReal.filter((id) => !hasSeries(id))
    if (unmaterialized.length) {
      throw new Error(
        `Cannot delete an un-materialized occurrence of a repeating todo (${unmaterialized.join(', ')}). ` +
          `To stop the routine, delete its recurring_id (see jovida view).`
      )
    }
    if (unknown.length) throw new NotFoundError(unknown.join(', '))
  }
  await ctx.sync.deleteObjects(a.ids) // 删除(服务端软删,对客户端透明)、幂等;不需先 fetch

  if (a.json) console.log(JSON.stringify({ entry_ids: a.ids, status: 'deleted' }))
  else console.log(`✓ deleted  ${a.ids.join(', ')}`)
}
