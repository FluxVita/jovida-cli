import type { Ctx } from '../ctx'
import { parseOccurrenceId } from '../core/recurrence'

export async function cmdDelete(ctx: Ctx, a: { ids: string[]; json?: boolean }): Promise<void> {
  if (!a.ids || a.ids.length === 0) {
    throw new Error('entry_id(s) required:  jovida delete <entry_id> [<entry_id> ...]')
  }
  await ctx.session.ensureSession()
  // 发生形 id 里,**未材料化**的纯虚拟发生不是真实条目(硬删幂等会"成功"误导)→ 拒并指引;
  // 已 fork 成真实条目的发生(id 同形但存在于快照)放行。仅当出现发生形 id 时才多拉一次校验。
  const occIds = a.ids.filter((id) => parseOccurrenceId(id))
  if (occIds.length) {
    const snap = await ctx.sync.pull()
    const real = new Set(snap.entries.map((e) => e.entryId))
    const virtual = occIds.filter((id) => !real.has(id))
    if (virtual.length) {
      throw new Error(
        `Cannot delete an un-materialized occurrence of a repeating todo (${virtual.join(', ')}). ` +
          `To stop the routine, delete its recurring_id (see jovida view).`
      )
    }
  }
  await ctx.sync.deleteObjects(a.ids) // 硬删、幂等;不需先 fetch

  if (a.json) console.log(JSON.stringify({ entry_ids: a.ids, status: 'deleted' }))
  else console.log(`✓ deleted  ${a.ids.join(', ')}`)
}
