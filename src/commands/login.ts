import type { Ctx } from '../ctx'
import type { DeviceAuth } from '../session'
import type { TokenRecord } from '../state'
import { tryOpenBrowser } from '../lib/open-url'

export interface LoginArgs {
  token?: string // 过渡流（开发期）：直接粘 Sign 态 vita token
  noWait?: boolean // 非阻塞:发起设备流并立即返回(给 AI agent;之后用 --check 轮询)
  check?: boolean // 轮询上次 --no-wait 发起的登录是否已批准
  json?: boolean
}

/** 设备流发起后，向用户展示 URL + 短码（并尽力开浏览器）。走 stderr，不污染 --json stdout。 */
function present(d: DeviceAuth, waiting: boolean): void {
  const opened = tryOpenBrowser(d.verificationUriComplete)
  process.stderr.write('\nTo sign in, open this URL in a browser:\n')
  process.stderr.write(`  ${d.verificationUri}\n`)
  process.stderr.write('and enter the code:\n')
  process.stderr.write(`  ${d.userCode}\n\n`)
  if (opened) process.stderr.write('(opened your browser automatically)\n')
  if (waiting) process.stderr.write('Waiting for approval…\n')
}

function reportSignedIn(ctx: Ctx, rec: TokenRecord, json?: boolean): void {
  if (json) console.log(JSON.stringify({ status: 'signed_in', vitaId: rec.vitaId, baseUrl: ctx.baseUrl }))
  else console.log(`\n✓ signed in  vitaId=${rec.vitaId || '(unknown)'}  (${ctx.baseUrl})`)
}

/**
 * 登录。
 * - 默认 = 设备授权流(阻塞,人手用):authorize → 展示 URL+短码 → 轮询 → 落盘。
 * - `--no-wait` = 发起后立即返回(给 AI agent),配 `--check` 轮询批准状态。
 * - `--check` = 轮询上次 --no-wait 发起的登录;批准则落盘并报告 signed in。
 * - `--token` = 过渡流(开发期):直接粘一枚 Sign 态 vita token。
 */
export async function cmdLogin(ctx: Ctx, a: LoginArgs): Promise<void> {
  if (a.check) {
    const r = await ctx.session.checkDeviceFlow()
    if (r.signedIn) reportSignedIn(ctx, r.rec, a.json)
    else if (a.json)
      console.log(
        JSON.stringify({
          status: 'authorization_pending',
          userCode: r.pending.userCode,
          verificationUri: r.pending.verificationUri
        })
      )
    else console.log('Still waiting for approval. Approve in the browser, then run `jovida login --check` again.')
    return
  }

  if (a.token) {
    reportSignedIn(ctx, await ctx.session.loginWithToken(a.token), a.json)
    return
  }

  if (a.noWait) {
    const d = await ctx.session.beginDeviceFlow((dev) => present(dev, false))
    if (a.json)
      console.log(
        JSON.stringify({
          status: 'authorization_pending',
          userCode: d.userCode,
          verificationUri: d.verificationUri,
          expiresIn: d.expiresIn
        })
      )
    else console.log('\nApprove in the browser, then poll `jovida login --check` until it reports signed in.')
    return
  }

  reportSignedIn(ctx, await ctx.session.loginWithDeviceFlow((dev) => present(dev, true)), a.json)
}
