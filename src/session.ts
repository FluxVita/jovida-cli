// 鉴权 session。**正式 CLI 不支持匿名态**——必须先 `jovida login`。
//
// 登录 = OAuth 设备授权流（RFC 8628 语义，vita 线格式）：
//   device_authorize（匿名）拿 deviceCode(密)+userCode(短码) → 用户在浏览器登录批准
//   → 轮询 device_token，reason=="" 即批准、返回 Sign 态 vita token → 落盘 token.raw。
// 凭证 = 单枚 vita token（raw 内含 access/refresh 双窗）；access 临期用 refresh_token 续；
// refresh 死 → NotSignedIn，重跑 login。**不走 apikey/Bearer。**
// 过渡：`loginWithToken` 直粘一枚 Sign token（开发期，无 durs 故不自动 refresh）。
import { ApiClient, ApiError } from './api'
import { getToken, setToken, clearCredentials, type TokenRecord } from './state'

const AUTHORIZE = '/uc/v1/passport/device_authorize'
const DEVICE_TOKEN = '/uc/v1/passport/device_token'
const REFRESH = '/uc/v1/passport/refresh_token'
const USER_INFO = '/uc/v1/user/get_user_info'
const SKEW = 60

const nowSec = (): number => Math.floor(Date.now() / 1000)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** device_authorize 响应（展示给用户的发起信息）。 */
export interface DeviceAuth {
  deviceCode: string // 机密：仅内存持有，绝不打印/落盘
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  expiresIn: number
  interval: number
}

export interface UserInfo {
  vitaId: string
  vitaHao: string
  entitlement: string
}

interface PassportResponse {
  reason?: string
  register?: { vitaId?: string | number }
  token?: { raw?: string; accessDur?: number | string; refreshDur?: number | string; mode?: string }
}
interface UserInfoResponse {
  user?: { vitaId?: string | number; vitaHao?: string }
  subscription?: { entitlement?: string }
}

/** 未登录 / 会话失效。CLI 不回退匿名。 */
export class NotSignedInError extends Error {
  constructor(msg = 'Not signed in. Run `jovida login` first.') {
    super(msg)
    this.name = 'NotSignedInError'
  }
}

export class Session {
  private refreshing: Promise<void> | null = null

  constructor(private api: ApiClient) {
    const t = getToken()
    if (t) api.setToken(t.raw)
  }

  /** 业务命令前：无 token → NotSignedIn；refresh 窗口已死 → 提前要求重登；access 临期 → 续期。 */
  async ensureSession(): Promise<void> {
    const t = getToken()
    if (!t) throw new NotSignedInError()
    this.api.setToken(t.raw)
    // refresh 窗口已过：续期必然失败,直接清凭证要求重登(省一次注定 401 的请求)。
    if (t.refreshDur > 0 && nowSec() > t.receivedAt + t.refreshDur - SKEW) {
      clearCredentials()
      throw new NotSignedInError('Session expired. Run `jovida login` again.')
    }
    if (t.accessDur > 0 && nowSec() > t.receivedAt + t.accessDur - SKEW) await this.refresh()
  }

  // ── 设备授权流 ────────────────────────────────────────────────

  /** 第 1 步：发起。device endpoints 匿名（清掉可能的旧 token）。 */
  async deviceAuthorize(): Promise<DeviceAuth> {
    this.api.setToken('')
    return this.api.post<DeviceAuth>(AUTHORIZE, {})
  }

  /**
   * 第 2 步：按 interval 轮询直到批准 / 拒绝 / 过期 / 超时。
   * reason: ""=已批准(带 token)、AUTHORIZATION_PENDING=继续、SLOW_DOWN=加间隔、ACCESS_DENIED/EXPIRED_TOKEN=终止。
   */
  async pollForToken(d: DeviceAuth): Promise<TokenRecord> {
    let interval = Math.max(1, d.interval || 5)
    const deadline = nowSec() + (d.expiresIn || 600)
    for (;;) {
      if (nowSec() >= deadline) throw new Error('Login timed out before approval. Run `jovida login` again.')
      await sleep(interval * 1000)
      const resp = await this.api.post<PassportResponse>(DEVICE_TOKEN, { deviceCode: d.deviceCode })
      if (resp.token?.raw) return this.applyToken(resp) // reason=="" 已批准
      switch (resp.reason ?? '') {
        case 'AUTHORIZATION_PENDING':
        case '':
          continue
        case 'SLOW_DOWN':
          interval += 5
          continue
        case 'ACCESS_DENIED':
          throw new Error('Login was denied.')
        case 'EXPIRED_TOKEN':
          throw new Error('The login request expired. Run `jovida login` again.')
        default:
          throw new Error(`Unexpected device_token reason: ${resp.reason}`)
      }
    }
  }

  /** 设备流登录：authorize → present(展示 URL+短码 + 开浏览器) → 轮询落盘。 */
  async loginWithDeviceFlow(present: (d: DeviceAuth) => void): Promise<TokenRecord> {
    const d = await this.deviceAuthorize()
    present(d)
    return this.pollForToken(d)
  }

  // ── 过渡 / 续期 / 身份 ─────────────────────────────────────────

  /** 过渡登录（开发期）：直粘 Sign 态 vita token，get_user_info 验活后落盘（durs=0，不自动 refresh）。 */
  async loginWithToken(rawToken: string): Promise<TokenRecord> {
    const raw = rawToken.trim()
    if (!raw) throw new Error('empty token')
    this.api.setToken(raw)
    const info = await this.fetchUserInfo('That token is not a valid signed-in session.')
    const rec: TokenRecord = { raw, vitaId: info.vitaId, accessDur: 0, refreshDur: 0, receivedAt: nowSec() }
    setToken(rec)
    return rec
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing
    this.refreshing = (async () => {
      try {
        const resp = await this.api.post<PassportResponse>(REFRESH, {})
        this.applyToken(resp)
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          clearCredentials()
          throw new NotSignedInError('Session expired. Run `jovida login` again.')
        }
        throw e
      } finally {
        this.refreshing = null
      }
    })()
    return this.refreshing
  }

  /** 当前身份（在线查；无凭证 → NotSignedIn）。 */
  async whoami(): Promise<UserInfo> {
    await this.ensureSession()
    return this.fetchUserInfo('Session is no longer valid.')
  }

  private async fetchUserInfo(rejectMsg: string): Promise<UserInfo> {
    let resp: UserInfoResponse
    try {
      resp = await this.api.get<UserInfoResponse>(USER_INFO)
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        clearCredentials()
        throw new NotSignedInError(`${rejectMsg} Run \`jovida login\` again.`)
      }
      throw e
    }
    return {
      vitaId: String(resp.user?.vitaId ?? ''),
      vitaHao: resp.user?.vitaHao ?? '',
      entitlement: resp.subscription?.entitlement ?? ''
    }
  }

  private applyToken(resp: PassportResponse): TokenRecord {
    const tk = resp.token
    if (!tk?.raw) throw new Error('passport response missing token')
    const rec: TokenRecord = {
      raw: tk.raw,
      vitaId: String(resp.register?.vitaId ?? getToken()?.vitaId ?? ''),
      accessDur: Number(tk.accessDur ?? 0),
      refreshDur: Number(tk.refreshDur ?? 0),
      receivedAt: nowSec()
    }
    setToken(rec)
    this.api.setToken(rec.raw)
    return rec
  }
}
