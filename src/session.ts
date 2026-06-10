// 鉴权 session。**正式 CLI 不支持匿名态**(后端 todo 端点强制登录,匿名→403 NEED_SIGN_IN;
// 且 CLI storeless 无本地兜底)——必须先 `jovida login`。
//
// 凭证两层:长效 `jvd_` apiKey + 短效 SIGN token。**自愈(set-and-forget)**:
//   access 临过期 → refresh_token;refresh 也死(401) → 用存的 apiKey 再 exchange → 新 token;
//   仅 apiKey 被吊销(exchange 401/403) → NotSignedIn,要求重新 login。
// 最终登录 = 粘 web 出的 `jvd_` key → api_key_exchange。过渡期 `loginWithToken` 直接粘登录态 token。
import { ApiClient, ApiError } from './api'
import { getToken, setToken, getApiKey, setApiKey, clearCredentials, type TokenRecord } from './state'

interface PassportResponse {
  register?: { vitaId?: string }
  token?: { raw?: string; accessDur?: number | string; refreshDur?: number | string; mode?: string | number }
}

const SKEW = 60
const EXCHANGE = '/uc/v1/passport/api_key_exchange'
const nowSec = (): number => Math.floor(Date.now() / 1000)

/** 未登录 / 会话失效 / apiKey 被吊销。CLI 不回退匿名。 */
export class NotSignedInError extends Error {
  constructor(msg = 'Not signed in. Run `jovida login` first.') {
    super(msg)
    this.name = 'NotSignedInError'
  }
}

export class Session {
  private refreshing: Promise<void> | null = null

  constructor(private api: ApiClient) {
    api.setAuthHooks({
      beforeRequest: async () => {
        const t = getToken()
        if (t && t.accessDur > 0 && nowSec() > t.receivedAt + t.accessDur - SKEW) await this.refresh()
      },
      onUnauthorized: async () => {
        await this.refresh()
        return true
      }
    })
    const t = getToken()
    if (t) api.setToken(t.raw)
  }

  /** 业务命令前:确保有效登录态;无效则自愈(refresh→apiKey re-exchange),都不行 → NotSignedIn。 */
  async ensureSession(): Promise<void> {
    const t = getToken()
    if (!t) {
      const key = getApiKey()
      if (key) return this.exchange(key)
      throw new NotSignedInError()
    }
    if (t.refreshDur > 0 && nowSec() >= t.receivedAt + t.refreshDur - SKEW) return this.reauth()
    if (t.accessDur > 0 && nowSec() > t.receivedAt + t.accessDur - SKEW) await this.refresh()
  }

  /** token 全死:有 apiKey 则 re-exchange,否则清凭证 + NotSignedIn。 */
  private async reauth(): Promise<void> {
    const key = getApiKey()
    if (key) return this.exchange(key)
    clearCredentials()
    throw new NotSignedInError('Session expired. Run `jovida login` again.')
  }

  /** 用 apiKey 换 SIGN token(api_key_exchange 返回与 register/oauth 同形)。 */
  async exchange(apiKey: string): Promise<void> {
    this.api.setToken('')
    let resp: PassportResponse
    try {
      resp = await this.api.rawPost<PassportResponse>(EXCHANGE, { apiKey })
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        clearCredentials()
        throw new NotSignedInError('API key was rejected (revoked?). Run `jovida login` again.')
      }
      throw e
    }
    this.applyToken(resp)
    setApiKey(apiKey)
  }

  /** 最终登录:粘 web 出的 jvd_ apiKey。 */
  async loginWithApiKey(apiKey: string): Promise<TokenRecord> {
    const key = apiKey.trim()
    if (!key) throw new Error('empty key')
    await this.exchange(key)
    const t = getToken()
    if (!t) throw new Error('exchange returned no token')
    return t
  }

  /** 过渡登录:直接粘一枚登录态 Vita-Token,refresh 归一化、校验 SIGN。 */
  async loginWithToken(pastedToken: string): Promise<TokenRecord> {
    const raw = pastedToken.trim()
    if (!raw) throw new Error('empty token')
    setToken({ raw, vitaId: '', mode: '', accessDur: 0, refreshDur: 0, receivedAt: nowSec() })
    this.api.setToken(raw)
    await this.refresh()
    const t = getToken()
    if (!t || t.mode !== 'MODE_SIGN') {
      clearCredentials()
      throw new Error('That token is not a signed-in account — the CLI requires a logged-in API key.')
    }
    return t
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing
    this.refreshing = (async () => {
      try {
        const resp = await this.api.rawPost<PassportResponse>('/uc/v1/passport/refresh_token', {})
        this.applyToken(resp)
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          await this.reauth() // 死会话 → apiKey re-exchange 或 NotSignedIn(不回退匿名)
        } else throw e
      } finally {
        this.refreshing = null
      }
    })()
    return this.refreshing
  }

  private applyToken(resp: PassportResponse): void {
    const tk = resp.token
    if (!tk?.raw) throw new Error('passport response missing token')
    const rec: TokenRecord = {
      raw: tk.raw,
      vitaId: resp.register?.vitaId ?? getToken()?.vitaId ?? '',
      mode: String(tk.mode ?? ''),
      accessDur: Number(tk.accessDur ?? 0),
      refreshDur: Number(tk.refreshDur ?? 0),
      receivedAt: nowSec()
    }
    setToken(rec)
    this.api.setToken(rec.raw)
  }

  current(): TokenRecord | null {
    return getToken()
  }
}
