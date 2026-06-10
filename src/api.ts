// Jovida 后端 HTTP 客户端（node）。
// body = proto3-JSON（camelCase）；鉴权走 Vita-* header；后端本地验签,无请求签名。
import { release } from 'node:os'
import { APP_VERSION } from './config'

export interface ApiClientConfig {
  baseUrl: string
  appId: string // Vita-Aid
  deviceId: string // Vita-Did
  platform: string // Vita-Platform
}

/** token 生命周期钩子,由 Session 注入；rawPost 不触发（避免刷新递归）。 */
export interface AuthHooks {
  beforeRequest?: () => Promise<void>
  onUnauthorized?: () => Promise<boolean>
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public reason: string,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class ApiClient {
  private token = ''
  private hooks: AuthHooks = {}

  constructor(private cfg: ApiClientConfig) {}

  setToken(token: string): void {
    this.token = token
  }
  setAuthHooks(hooks: AuthHooks): void {
    this.hooks = hooks
  }

  /** 鉴权端点（register/refresh）用：带当前 token,不触发刷新钩子。 */
  async rawPost<T = unknown>(path: string, body: unknown = {}): Promise<T> {
    return this.fetchJson<T>(path, 'POST', body)
  }
  /** 业务端点用：请求前续期 + 401 刷新重试一次。 */
  async post<T = unknown>(path: string, body: unknown = {}): Promise<T> {
    return this.authed<T>(() => this.fetchJson<T>(path, 'POST', body))
  }
  async get<T = unknown>(path: string): Promise<T> {
    return this.authed<T>(() => this.fetchJson<T>(path, 'GET'))
  }

  private async authed<T>(send: () => Promise<T>): Promise<T> {
    await this.hooks.beforeRequest?.()
    try {
      return await send()
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && this.hooks.onUnauthorized) {
        const retry = await this.hooks.onUnauthorized()
        if (retry) return await send()
      }
      throw e
    }
  }

  private headers(): Record<string, string> {
    const utcOffsetSec = -new Date().getTimezoneOffset() * 60
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Vita-Aid': this.cfg.appId,
      'Vita-Did': this.cfg.deviceId,
      'Vita-Platform': this.cfg.platform,
      'Vita-App-Version': APP_VERSION,
      'Vita-Os-Name': process.platform,
      'Vita-Os-Version': release(),
      'Vita-Time-Zone': Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
      'Vita-UTC-Offset': String(utcOffsetSec),
      'Vita-Language': 'en'
    }
    // 空 token 省略 Vita-Token 头（与匿名 register「纯 did、无 token」语义一致）。
    if (this.token) h['Vita-Token'] = this.token
    return h
  }

  private async fetchJson<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {})
    })
    if (!res.ok) {
      let reason = ''
      try {
        reason = (JSON.parse(await res.text()) as { reason?: string }).reason ?? ''
      } catch {
        /* 非 JSON 错误体 */
      }
      throw new ApiError(res.status, reason, `HTTP ${res.status} on ${path}${reason ? ` (${reason})` : ''}`)
    }
    return (await res.json()) as T
  }
}
