import type { Ctx } from '../ctx'

export interface WhoamiArgs {
  json?: boolean
}

/** 在线查当前身份（get_user_info）。无凭证 → NotSignedIn(exit 2)。 */
export async function cmdWhoami(ctx: Ctx, a: WhoamiArgs): Promise<void> {
  const info = await ctx.session.whoami()
  if (a.json) {
    console.log(JSON.stringify({ ...info, baseUrl: ctx.baseUrl }))
    return
  }
  console.log(`vitaHao:     ${info.vitaHao || '(none)'}`)
  console.log(`vitaId:      ${info.vitaId || '(none)'}`)
  console.log(`entitlement: ${info.entitlement || '(none)'}`)
  console.log(`baseUrl:     ${ctx.baseUrl}`)
}
