// Jovida 后端 HTTP 客户端（node）。
// body = proto3-JSON（camelCase）；鉴权 = Sign 态 vita token 走 `Vita-Token` header。
// 设备授权流的 device_authorize/device_token 是匿名端点（登录时尚无 token，不带 Vita-Token）。
import { release } from 'node:os'
import { APP_VERSION } from './config'

export interface ApiClientConfig {
  baseUrl: string
  appId: string // Vita-Aid
  deviceId: string // Vita-Did
  platform: string // Vita-Platform
  timeoutMs?: number // 单请求超时;0/缺省 = 不限(statusline/hook 场景经 JOVIDA_TIMEOUT_MS 收紧)
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
  private token = '' // Sign 态 vita token（Vita-Token）

  constructor(private cfg: ApiClientConfig) {}

  setToken(token: string): void {
    this.token = token
  }

  async post<T = unknown>(path: string, body: unknown = {}): Promise<T> {
    return this.fetchJson<T>(path, 'POST', body)
  }
  async get<T = unknown>(path: string): Promise<T> {
    return this.fetchJson<T>(path, 'GET')
  }

  /**
   * 打开一条**原始**响应流(不 .json()),用于 SSE(text/event-stream)。带 Vita-* 会话头,
   * 交由调用方读 res.body。不设超时(长连)——由传入的 AbortSignal 控制生命周期。
   */
  async openStream(path: string, signal?: AbortSignal): Promise<Response> {
    return fetch(`${this.cfg.baseUrl}${path}`, {
      method: 'GET',
      headers: { ...this.headers(), Accept: 'text/event-stream' },
      signal
    })
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
    if (this.token) h['Vita-Token'] = this.token
    return h
  }

  private async fetchJson<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${this.cfg.baseUrl}${path}`, {
        method,
        headers: this.headers(),
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
        signal: this.cfg.timeoutMs && this.cfg.timeoutMs > 0 ? AbortSignal.timeout(this.cfg.timeoutMs) : undefined
      })
    } catch (e) {
      // fetch 本身抛错(DNS/连接拒绝/超时)→ 网络故障,归 ApiError(status 0) → exit 3,
      // 别落到通用 exit 1(usage),否则 agent 会误判为命令写错而乱改重试。
      const msg = e instanceof Error ? e.message : String(e)
      throw new ApiError(0, 'NETWORK', `network error reaching ${path}: ${msg}`)
    }
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
