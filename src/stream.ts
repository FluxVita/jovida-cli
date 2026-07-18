// stream 运行体(有状态)——嵌入守护:为每个启用的 stream 源起一个长驻子进程,逐行解析 stdout 为信封路由;
// 进程退出即监督重启(按退避,防崩溃热循环);streams.json 变更热重载(改/停用→杀旧,新增/启用→拉起)。
// 全程 best-effort:子进程崩溃/坏行绝不拖垮守护。
import { statSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import { STREAMS_FILE, loadStreams, parseStreamLine, DEFAULT_RESTART_SEC, type StreamSource } from './core/stream'
import type { Envelope } from './core/rules'

const RECONCILE_MS = 5000 // 隔多久对账一次 streams.json(热重载)
const MIN_UPTIME_MS = 10_000 // 子进程活够这么久 = 健康,重置退避;活不到 = 快速崩溃,退避加倍
const BACKOFF_CAP_MS = 60_000 // 退避上限

// ── streams.json mtime 缓存 ──
let cached: StreamSource[] = []
let cachedMtimeMs = -1
function getStreams(): StreamSource[] {
  try {
    const mtime = statSync(STREAMS_FILE).mtimeMs
    if (mtime !== cachedMtimeMs) {
      cached = loadStreams()
      cachedMtimeMs = mtime
    }
  } catch {
    cached = []
    cachedMtimeMs = -1
  }
  return cached
}

/** 守护 status 用:当前启用中的 stream 源条数(读缓存)。 */
export function activeStreamCount(): number {
  return getStreams().filter((s) => s.enabled).length
}

interface Running {
  def: StreamSource
  child: ChildProcess
  rl: Interface | null
  startedAt: number
  failures: number
  restartTimer: NodeJS.Timeout | null
}

/**
 * 启动 stream 运行体。route=把信封交给规则引擎(runRules),log=写守护日志。返回停止函数。
 * 每个启用的 stream 一个长驻子进程;退出即按退避重启,streams.json 变更(改 cmd/停用/删除/新增)热重载。
 */
export function startStreaming(route: (env: Envelope) => void, log: (m: string) => void): () => void {
  let stopped = false
  const running = new Map<string, Running>()
  let reconcileTimer: NodeJS.Timeout | null = null

  const cleanup = (id: string): void => {
    const r = running.get(id)
    if (!r) return
    if (r.restartTimer) clearTimeout(r.restartTimer)
    try {
      r.rl?.close()
    } catch {
      /* 忽略 */
    }
    running.delete(id)
  }

  const kill = (id: string): void => {
    const r = running.get(id)
    if (!r) return
    if (r.restartTimer) clearTimeout(r.restartTimer)
    try {
      r.child.kill('SIGTERM')
    } catch {
      /* 已退出 */
    }
    cleanup(id)
  }

  const spawnStream = (def: StreamSource, failures: number): void => {
    if (stopped) return
    let child: ChildProcess
    try {
      child = spawn('sh', ['-c', def.cmd], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      log(`stream ${def.id} spawn failed: ${(e as Error).message}`)
      scheduleRestart(def, failures + 1)
      return
    }
    const rl = child.stdout ? createInterface({ input: child.stdout }) : null
    const rec: Running = { def, child, rl, startedAt: Date.now(), failures, restartTimer: null }
    running.set(def.id, rec)
    log(`stream ${def.id}${def.name ? ' (' + def.name + ')' : ''} started`)

    rl?.on('line', (line) => {
      const env = parseStreamLine(line, { source: def.source, type: def.type })
      if (!env) return // 坏行/补不齐 source+type:静默跳过
      try {
        route(env)
      } catch (e) {
        log(`stream ${def.id} route failed: ${(e as Error).message}`)
      }
    })
    let stderrTail = ''
    child.stderr?.on('data', (d) => {
      stderrTail = (stderrTail + String(d)).slice(-500)
    })
    child.on('error', (e) => log(`stream ${def.id} error: ${e.message}`))
    child.on('close', (code) => {
      const ranMs = Date.now() - rec.startedAt
      cleanup(def.id)
      if (stopped) return
      const nextFailures = ranMs < MIN_UPTIME_MS ? failures + 1 : 0 // 活够久=健康,重置退避
      log(`stream ${def.id} exited (code ${code ?? '?'}, ran ${Math.round(ranMs / 1000)}s)${stderrTail.trim() ? ': ' + stderrTail.trim() : ''}`)
      scheduleRestart(def, nextFailures)
    })
  }

  const scheduleRestart = (def: StreamSource, failures: number): void => {
    if (stopped) return
    const base = (def.restart_sec ?? DEFAULT_RESTART_SEC) * 1000
    const backoff = Math.min(base * Math.pow(2, Math.max(0, failures - 1)), BACKOFF_CAP_MS)
    const t = setTimeout(() => {
      // 重启前再确认它还在「想要」集合里(可能这期间被停用/删除/改了 cmd)
      const cur = getStreams().find((s) => s.id === def.id && s.enabled)
      if (cur && cur.cmd === def.cmd) spawnStream(cur, failures)
    }, backoff)
    if (t.unref) t.unref()
    // 把退避计时挂在一个占位 Running 上,便于停用/关停时清掉
    running.set(def.id, { def, child: null as unknown as ChildProcess, rl: null, startedAt: 0, failures, restartTimer: t })
  }

  const reconcile = (): void => {
    if (stopped) return
    const desired = getStreams().filter((s) => s.enabled)
    const byId = new Map(desired.map((s) => [s.id, s]))
    // 停用/删除/改了 cmd 的:杀掉(改 cmd 后由下面重新拉起)
    for (const [id, r] of running) {
      const want = byId.get(id)
      if (!want || want.cmd !== r.def.cmd) kill(id)
    }
    // 想要但没跑(且没在等重启)的:拉起
    for (const s of desired) if (!running.has(s.id)) spawnStream(s, 0)
  }

  reconcile()
  reconcileTimer = setInterval(reconcile, RECONCILE_MS)
  if (reconcileTimer.unref) reconcileTimer.unref()

  return () => {
    stopped = true
    if (reconcileTimer) clearInterval(reconcileTimer)
    for (const id of [...running.keys()]) kill(id)
  }
}
