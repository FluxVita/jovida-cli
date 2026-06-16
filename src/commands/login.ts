import type { Ctx } from '../ctx'
import type { DeviceAuth } from '../session'
import type { TokenRecord } from '../state'
import { tryOpenBrowser } from '../lib/open-url'

export interface LoginArgs {
  token?: string // 过渡流（开发期）：直接粘 Sign 态 vita token
  json?: boolean
}

/** 设备流发起后，向用户展示 URL + 短码（并尽力开浏览器）。走 stderr，不污染 --json stdout。 */
function present(d: DeviceAuth): void {
  const opened = tryOpenBrowser(d.verificationUriComplete)
  process.stderr.write('\nTo sign in, open this URL in a browser:\n')
  process.stderr.write(`  ${d.verificationUri}\n`)
  process.stderr.write('and enter the code:\n')
  process.stderr.write(`  ${d.userCode}\n\n`)
  if (opened) process.stderr.write('(opened your browser automatically)\n')
  process.stderr.write('Waiting for approval…\n')
}

function reportSignedIn(ctx: Ctx, rec: TokenRecord, json?: boolean): void {
  if (json) console.log(JSON.stringify({ status: 'signed_in', vitaId: rec.vitaId, baseUrl: ctx.baseUrl }))
  else console.log(`\n✓ signed in  vitaId=${rec.vitaId || '(unknown)'}  (${ctx.baseUrl})`)
}

/**
 * 登录。
 * - 默认 = 设备授权流：authorize → 展示 URL+短码(并尽力开浏览器) → **自动轮询** device_token 到批准 → 落盘。
 * - `--token` = 过渡流(开发期):直接粘一枚 Sign 态 vita token。
 */
export async function cmdLogin(ctx: Ctx, a: LoginArgs): Promise<void> {
  if (a.token) {
    reportSignedIn(ctx, await ctx.session.loginWithToken(a.token), a.json)
    return
  }
  reportSignedIn(ctx, await ctx.session.loginWithDeviceFlow(present), a.json)
}
