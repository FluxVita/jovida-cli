import type { Ctx } from '../ctx'
import type { DeviceAuth } from '../session'
import { ensureWritable, type TokenRecord } from '../state'
import { clearStore } from '../store'
import { tryOpenBrowser } from '../lib/open-url'

export interface LoginArgs {
  token?: string // 过渡流（开发期）：直接粘 Sign 态 vita token
  json?: boolean
}

/** 设备流发起后，向用户展示 URL + 短码（并尽力开浏览器）。走 stderr，不污染 --json stdout。 */
function present(d: DeviceAuth): void {
  const opened = tryOpenBrowser(d.verificationUriComplete)
  // 首选展示「带授权码的完整 URL」——用户只需复制这一条打开即可,页面自动带上短码。
  process.stderr.write('\nTo sign in, open this URL in a browser (the code is built in):\n')
  process.stderr.write(`  ${d.verificationUriComplete}\n\n`)
  process.stderr.write(`(if the page asks for a code, enter: ${d.userCode})\n`)
  if (opened) process.stderr.write('(opened your browser automatically)\n')
  process.stderr.write('Waiting for approval…\n')
}

function reportSignedIn(ctx: Ctx, rec: TokenRecord, json?: boolean): void {
  clearStore() // 本地库不分账号:换号登录后不能再喂旧账号的数据给读命令 / `due`
  // rec.vitaId 是存储字段名(credentials.json 兼容);对外叫 userId(产品术语,同 whoami)。
  if (json) console.log(JSON.stringify({ status: 'signed_in', userId: rec.vitaId, baseUrl: ctx.baseUrl }))
  else console.log(`\n✓ signed in  userId=${rec.vitaId || '(unknown)'}  (${ctx.baseUrl})`)
}

/**
 * 登录。
 * - 默认 = 设备授权流：authorize → 展示 URL+短码(并尽力开浏览器) → **自动轮询** device_token 到批准 → 落盘。
 * - `--token` = 过渡流(开发期):直接粘一枚 Sign 态 vita token。
 */
export async function cmdLogin(ctx: Ctx, a: LoginArgs): Promise<void> {
  // 先确认能落盘:沙箱 home 不可写时提前报错(带 JOVIDA_HOME 指引),不让用户白批准一轮。
  ensureWritable()
  if (a.token) {
    reportSignedIn(ctx, await ctx.session.loginWithToken(a.token), a.json)
    return
  }
  reportSignedIn(ctx, await ctx.session.loginWithDeviceFlow(present), a.json)
}
