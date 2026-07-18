// 通用 msghub SSE 订阅(只读)。连上后端 /jov/msghub/v1/sse 通用入口,声明只订自己的
// todo 同步频道 `#<uid>:module_update:todo`(服务端订阅,顺 SSE 流下发),收到 publication
// 即回调。纯读:不回传任何命令——后端 SSE 已设 PongTimeout=0,不因缺 pong 断开;连接仅在
// token 过期宽限后断,由本文件的重连循环补上(重连后调用方做一次全量对账拉取,补回漏掉的变更)。
import type { Ctx } from './ctx'
import { getToken } from './state'
import { NotSignedInError } from './session'

const SSE_PATH = '/jov/msghub/v1/sse'
const WATCH_CLIENT_NAME = 'jovida-cli-watch'
const MAX_BACKOFF_MS = 30_000

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function todoSyncChannel(userId: string): string {
  return `#${userId}:module_update:todo`
}

/** cf_connect = URL 编码的 centrifuge Connect 命令,声明只订同步频道 + 标记为 watch 客户端。 */
function buildConnectParam(channel: string): string {
  const command = { id: 1, connect: { name: WATCH_CLIENT_NAME, subs: { [channel]: {} } } }
  return encodeURIComponent(JSON.stringify(command))
}

export interface WatchHandlers {
  signal: AbortSignal
  onConnect: () => void | Promise<void> // 每次连上都调(首连=基线,重连=对账补拉)
  onSignal: (data: unknown) => void | Promise<void> // 收到一条同步 publication
  log?: (msg: string) => void // 重连等状态提示(走 stderr,由调用方决定)
}

/** 一次 SSE 连接:连上即 onConnect();解析 `data: <reply>` 帧,同步频道的 publication → onSignal()。流结束/出错即返回。 */
async function connectOnce(ctx: Ctx, channel: string, h: WatchHandlers): Promise<void> {
  const res = await ctx.api.openStream(`${SSE_PATH}?cf_connect=${buildConnectParam(channel)}`, h.signal)
  if (!res.ok || !res.body) throw new Error(`SSE connect failed: HTTP ${res.status}`)
  await h.onConnect()

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buf += decoder.decode(value, { stream: true })
    // SSE 帧以空行(\n\n)分隔;帧内取 `data:` 行(centrifuge 每帧一个 JSON Reply)。
    let sep: number
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue
        const json = line.slice(5).trim()
        if (!json || json === '{}') continue // 空帧 = 服务端 keepalive ping,忽略
        let reply: { push?: { channel?: string; pub?: { data?: unknown } } }
        try {
          reply = JSON.parse(json)
        } catch {
          continue
        }
        const pub = reply.push?.pub
        if (pub && reply.push?.channel === channel) await h.onSignal(pub.data)
      }
    }
  }
}

/**
 * 持续订阅 todo 同步频道:断线自动重连(指数退避,连上即重置)。每次连上调 onConnect
 * (首连=建立基线,重连=对账补拉漏掉的变更),每条 publication 调 onSignal。abort 即优雅退出。
 * 每次(重)连前 ensureSession,保证 header 里的会话 token 新鲜。
 */
export async function watchTodoSync(ctx: Ctx, h: WatchHandlers): Promise<void> {
  const userId = getToken()?.vitaId
  if (!userId) throw new NotSignedInError()
  const channel = todoSyncChannel(userId)

  let backoff = 1000
  while (!h.signal.aborted) {
    try {
      await ctx.session.ensureSession()
      await connectOnce(ctx, channel, { ...h, onConnect: async () => {
        backoff = 1000 // 连上成功 → 退避复位
        await h.onConnect()
      } })
    } catch (e) {
      if (h.signal.aborted) return
      h.log?.(`disconnected, reconnecting… (${e instanceof Error ? e.message : String(e)})`)
    }
    if (h.signal.aborted) return
    await sleep(backoff)
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
  }
}
