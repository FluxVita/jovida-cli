// poll 运行体(有状态)——嵌入守护:按各 poll 的间隔跑 check 命令,只在上升沿(false→true)把信封路由给引擎。
// 单个「最近到期」定时器统一驱动所有 poll(不为每个 poll 各起一个),便于热重载:每次调度都重读 polls.json(mtime 缓存)。
// 全程 best-effort:任何 check 失败/超时绝不拖垮守护;check exit≠0 只当「条件不成立」,不算错误。
import { statSync } from 'node:fs'
import { spawn } from 'node:child_process'
import {
  POLLS_FILE,
  loadPolls,
  loadPollState,
  savePollState,
  isRisingEdge,
  buildPollEnvelope,
  type PollSource,
  type PollStateMap
} from './core/poll'
import type { Envelope } from './core/rules'

const CHECK_TIMEOUT_MS = 30_000 // 单次 check 最长 30s
const IDLE_RECHECK_MS = 60_000 // 无启用 poll 时,隔一会儿再看有没有新增(热添加)
const OUTPUT_CAP = 2000 // 记进状态的 stdout 上限

// ── polls.json mtime 缓存(高频调度不必每次读盘) ──
let cached: PollSource[] = []
let cachedMtimeMs = -1
function getPolls(): PollSource[] {
  try {
    const mtime = statSync(POLLS_FILE).mtimeMs
    if (mtime !== cachedMtimeMs) {
      cached = loadPolls()
      cachedMtimeMs = mtime
    }
  } catch {
    cached = []
    cachedMtimeMs = -1
  }
  return cached
}

/** 守护 status 用:当前启用中的 poll 源条数(读缓存)。 */
export function activePollCount(): number {
  return getPolls().filter((p) => p.enabled).length
}

const nowSec = (): number => Math.floor(Date.now() / 1000)

/**
 * 启动 poll 运行体。route=把信封交给规则引擎(runRules),log=写守护日志。返回停止函数。
 * 状态(各 poll 上次成立与否)在内存持有并每次落盘,故重启后据 poll-state.json 续判边沿——
 * 「守护重启时正下雨」不会被误当成新上升沿。
 */
export function startPolling(route: (env: Envelope) => void, log: (m: string) => void): () => void {
  let stopped = false
  let timer: NodeJS.Timeout | null = null
  const state: PollStateMap = loadPollState() // 内存为运行时真相,变更后落盘供重启续用
  const nextRun = new Map<string, number>() // pollId → 下次跑的 epoch ms

  const runCheck = (p: PollSource): void => {
    let child
    try {
      child = spawn('sh', ['-c', p.check], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      log(`poll ${p.id} check spawn failed: ${(e as Error).message}`)
      return
    }
    let out = ''
    const killer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* 已退出 */
      }
      log(`poll ${p.id} check timed out (${CHECK_TIMEOUT_MS}ms), killed`)
    }, CHECK_TIMEOUT_MS)
    if (killer.unref) killer.unref()
    child.stdout?.on('data', (d) => (out += String(d)))
    child.stderr?.on('data', (d) => (out += String(d)))
    child.on('error', (e) => {
      clearTimeout(killer)
      log(`poll ${p.id} check error: ${e.message}`)
    })
    child.on('close', (code) => {
      clearTimeout(killer)
      if (stopped) return
      const condition = code === 0 // exit 0 = 条件成立
      const prev = state[p.id]?.state
      const now = nowSec()
      const output = out.slice(0, OUTPUT_CAP)
      const edge = isRisingEdge(prev, condition)
      state[p.id] = {
        state: condition,
        checkedAt: now,
        firedAt: edge ? now : state[p.id]?.firedAt,
        lastOutput: output.trim() || undefined
      }
      savePollState(state)
      if (edge) {
        log(`poll ${p.id}${p.name ? ' (' + p.name + ')' : ''} rising edge → emit ${p.source}.${p.type}`)
        try {
          route(buildPollEnvelope(p, output, now))
        } catch (e) {
          log(`poll ${p.id} route failed: ${(e as Error).message}`)
        }
      }
    })
  }

  const tick = (): void => {
    if (stopped) return
    const polls = getPolls().filter((p) => p.enabled)
    const now = Date.now()
    for (const p of polls) {
      if ((nextRun.get(p.id) ?? 0) <= now) {
        nextRun.set(p.id, now + p.interval_sec * 1000) // 先排下次,再跑(check 异步,别叠跑)
        runCheck(p)
      }
    }
    schedule()
  }

  const schedule = (): void => {
    if (stopped) return
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    const polls = getPolls().filter((p) => p.enabled)
    const ids = new Set(polls.map((p) => p.id))
    for (const id of [...nextRun.keys()]) if (!ids.has(id)) nextRun.delete(id) // 删/停用的 poll:清排程
    const now = Date.now()
    let nearest = Infinity
    for (const p of polls) {
      if (!nextRun.has(p.id)) nextRun.set(p.id, now) // 新 poll:尽快跑首次(首检据落盘状态判边沿,不会误发)
      nearest = Math.min(nearest, nextRun.get(p.id) as number)
    }
    const delay = Number.isFinite(nearest) ? Math.max(0, nearest - now) : IDLE_RECHECK_MS
    timer = setTimeout(tick, delay)
    if (timer.unref) timer.unref() // 不靠这个定时器吊住进程(SSE 连接才是)
  }

  schedule()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
