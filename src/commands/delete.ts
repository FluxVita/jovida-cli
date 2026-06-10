import type { Ctx } from '../ctx'

export async function cmdDelete(ctx: Ctx, a: { ids: string[]; json?: boolean }): Promise<void> {
  if (!a.ids || a.ids.length === 0) {
    throw new Error('entry_id(s) required:  jovida delete <entry_id> [<entry_id> ...]')
  }
  await ctx.session.ensureSession()
  await ctx.sync.deleteObjects(a.ids) // 硬删、幂等;不需先 fetch

  if (a.json) console.log(JSON.stringify({ entry_ids: a.ids, status: 'deleted' }))
  else console.log(`✓ deleted  ${a.ids.join(', ')}`)
}
