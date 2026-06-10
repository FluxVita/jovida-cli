import { createInterface } from 'node:readline'
import type { Ctx } from '../ctx'
import type { TokenRecord } from '../state'

function prompt(q: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  return new Promise((resolve) => rl.question(q, (ans) => {
    rl.close()
    resolve(ans)
  }))
}

export interface LoginArgs {
  apiKey?: string // 最终流:web 出的 jvd_ key
  token?: string // 过渡流:直接粘登录态 Vita-Token
  json?: boolean
}

/**
 * 登录。
 * - 默认 = apikey 流:粘 web 出的 `jvd_` key → api_key_exchange 换 SIGN token(凭证自愈)。
 * - `--token` = 过渡流:直接粘一枚登录态 Vita-Token。
 */
export async function cmdLogin(ctx: Ctx, a: LoginArgs): Promise<void> {
  let rec: TokenRecord
  if (a.token) {
    rec = await ctx.session.loginWithToken(a.token)
  } else {
    let key = a.apiKey
    if (!key) {
      process.stderr.write('Open the key page in your browser, sign in, and generate a CLI key.\n')
      key = await prompt('Paste your Jovida key (jvd_…): ')
    }
    rec = await ctx.session.loginWithApiKey(key)
  }
  if (a.json) console.log(JSON.stringify({ vitaId: rec.vitaId, mode: rec.mode, baseUrl: ctx.baseUrl }))
  else console.log(`✓ signed in  vitaId=${rec.vitaId || '(unknown)'}  (${ctx.baseUrl})`)
}
