// jovida daemon — 常驻订阅 SSE 推送,把「拉」升级成「盯」。每次变更:
//   ① 刷新本地快照,并把渲染好的到期雷达那行(ansi/plain 两版)写进 statusline.json,
//      供 statusline 脚本直接 cat——零 node 启动、始终最新;
//   ② 对「值得打扰」的变更弹 macOS 原生通知(osascript,零依赖)。
// 提醒到点 / 逾期跨越不是数据变更(无推送),但守护手里握着整份快照,故本地起定时器自己响。
//
// 生命周期自托管:start(自我 detach 到后台+写 pid)/ stop / status / run(前台工作体)。
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, openSync } from 'node:fs'
import { spawn } from 'node:child_process'
import type { Ctx } from './ctx'
import type { StoredSnapshot } from './store'
import { loadSnapshot } from './snapshot'
import { watchTodoSync } from './watch'
import { computeDue, reminderFires } from './core/due'
import { renderBrief } from './core/brief'
import { diffSnapshots, type ChangeKind } from './core/diff'
import { notify } from './notify'

const DIR = process.env['JOVIDA_HOME'] ?? join(homedir(), '.jovida', 'cli')
const PID_FILE = join(DIR, 'daemon.pid')
const STATUS_FILE = join(DIR, 'daemon.json')
const STATUSLINE_FILE = join(DIR, 'statusline.json')
const LOG_FILE = join(DIR, 'daemon.log')

const DUE_WINDOW = 24 * 3600 // statusline 到期窗口(与 `jovida due` 默认一致)
const MOMENT_HORIZON = 48 * 3600 // 定时器排程视野:提醒/到期时刻在此窗内才排下一个
const RESCAN_MS = 30 * 60 * 1000 // 周期重扫:把新进入视野的时刻纳入排程(纯本地,不触网)
const FIRED_TTL = 3600 // 已触发时刻键的保留期(秒),之上清掉防无限增长

// 弹通知的变更种类:push 对账里的 added/completed/deleted(completed/deleted 即「其他端完成/删除」),
// 加上本地定时器的 reminder(提醒到点)/ overdue(逾期跨越)。updated/reopened 只刷状态栏、不打扰。
const PUSH_NOTIFY = new Set<ChangeKind>(['added', 'completed', 'deleted'])

const nowSec = (): number => Math.floor(Date.now() / 1000)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function startOfTodaySec(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return Math.floor(d.getTime() / 1000)
}

function ensureDir(): void {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true, mode: 0o700 })
}

// ---- 进程存活 / pidfile ----
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM' // 存在但非本用户:仍算活
  }
}
function readPid(): number | null {
  try {
    const n = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}
function writePid(pid: number): void {
  ensureDir()
  writeFileSync(PID_FILE, String(pid), { mode: 0o600 })
}
function removePid(): void {
  try {
    rmSync(PID_FILE)
  } catch {
    /* 不存在即忽略 */
  }
}

// ---- 状态文件(status 命令读) ----
interface DaemonStatus {
  pid: number
  startedAt: number
  connected: boolean
  lastSignalAt: number
  storeVersion: number
  overdue: number
  upcoming: number
  updatedAt: number
}
function writeStatus(s: DaemonStatus): void {
  try {
    ensureDir()
    writeFileSync(STATUS_FILE, JSON.stringify(s), { mode: 0o600 })
  } catch {
    /* 尽力而为 */
  }
}
export function readStatus(): DaemonStatus | null {
  try {
    return JSON.parse(readFileSync(STATUS_FILE, 'utf8')) as DaemonStatus
  } catch {
    return null
  }
}

// ---- 到期雷达 → statusline 缓存 + 计数 ----
function computeCounts(snap: StoredSnapshot): { overdue: number; upcoming: number } {
  const now = nowSec()
  const r = computeDue({
    entries: snap.entries,
    recurrings: snap.recurrings,
    nowSec: now,
    withinSecs: DUE_WINDOW,
    todayStart: startOfTodaySec()
  })
  const ansi = renderBrief(r, now, { ansi: true, link: true })
  const plain = renderBrief(r, now, {})
  try {
    ensureDir()
    writeFileSync(
      STATUSLINE_FILE,
      JSON.stringify({ updatedAt: now, ansi, plain, overdue: r.overdue.length, upcoming: r.upcoming.length }),
      { mode: 0o600 }
    )
  } catch {
    /* 尽力而为:statusline 脚本会回退到直接跑 jovida due */
  }
  return { overdue: r.overdue.length, upcoming: r.upcoming.length }
}

// ---- 提醒/到期定时器(时刻,不是数据变更) ----
type MomentKind = 'reminder' | 'overdue'
interface Moment {
  at: number
  kind: MomentKind
  entryId: string
  title: string
}
const momentKey = (m: Moment): string => `${m.entryId}:${m.kind}:${m.at}`

function collectMoments(snap: StoredSnapshot): Moment[] {
  const now = nowSec()
  const r = computeDue({
    entries: snap.entries,
    recurrings: snap.recurrings,
    nowSec: now,
    withinSecs: MOMENT_HORIZON,
    todayStart: startOfTodaySec()
  })
  const out: Moment[] = []
  for (const it of [...r.overdue, ...r.upcoming]) {
    out.push({ at: it.anchorAt, kind: 'overdue', entryId: it.entry.entryId, title: it.entry.title })
    for (const t of reminderFires(it.entry, it.anchorAt)) {
      out.push({ at: t, kind: 'reminder', entryId: it.entry.entryId, title: it.entry.title })
    }
  }
  return out
}

/** 守护工作体:前台运行,阻塞到收到信号退出。已被别的活守护占用则直接抛错。 */
export async function runDaemon(ctx: Ctx): Promise<void> {
  const existing = readPid()
  if (existing && existing !== process.pid && isAlive(existing)) {
    throw new Error(`daemon already running (pid ${existing}) — run 'jovida daemon stop' first`)
  }
  writePid(process.pid)

  const controller = new AbortController()
  let prev: StoredSnapshot | null = null
  const fired = new Set<string>() // 已触发/已略过的时刻键
  let momentTimer: NodeJS.Timeout | null = null
  let rescanTimer: NodeJS.Timeout | null = null

  const status: DaemonStatus = {
    pid: process.pid,
    startedAt: nowSec(),
    connected: false,
    lastSignalAt: 0,
    storeVersion: 0,
    overdue: 0,
    upcoming: 0,
    updatedAt: nowSec()
  }
  const flushStatus = (): void => {
    status.updatedAt = nowSec()
    writeStatus(status)
  }

  const refreshStatusline = (snap: StoredSnapshot): void => {
    const c = computeCounts(snap)
    status.overdue = c.overdue
    status.upcoming = c.upcoming
    status.storeVersion = snap.serverVersion
    flushStatus()
  }

  const scheduleNextMoment = (): void => {
    if (momentTimer) {
      clearTimeout(momentTimer)
      momentTimer = null
    }
    if (!prev || controller.signal.aborted) return
    const now = nowSec()
    let nearest: Moment | null = null
    for (const m of collectMoments(prev)) {
      const k = momentKey(m)
      if (m.at <= now) {
        fired.add(k) // 已过的时刻:静默标记,永不补弹(守护启动前发生的提醒不该炸醒你)
        continue
      }
      if (fired.has(k)) continue
      if (!nearest || m.at < nearest.at) nearest = m
    }
    // 清掉太旧的键,防集合无限增长
    for (const k of fired) {
      const at = Number(k.slice(k.lastIndexOf(':') + 1))
      if (Number.isFinite(at) && at < now - FIRED_TTL) fired.delete(k)
    }
    if (!nearest) return
    const target = nearest
    const delay = Math.max(0, target.at * 1000 - Date.now())
    momentTimer = setTimeout(() => fireMoment(target), delay)
    if (momentTimer.unref) momentTimer.unref() // 不靠这个定时器吊住进程(watch 连接才是)
  }

  const fireMoment = (m: Moment): void => {
    fired.add(momentKey(m))
    if (m.kind === 'reminder') notify({ title: '🔔 Jovida 提醒', message: m.title })
    else notify({ title: '⏰ 待办到期', message: m.title })
    if (prev) refreshStatusline(prev) // 该待办刚跨进逾期/提醒时刻,雷达那行变了
    scheduleNextMoment()
  }

  const notifyPushBatch = (events: ReturnType<typeof diffSnapshots>): void => {
    const byKind = new Map<ChangeKind, number>()
    const firstTitle = new Map<ChangeKind, string>()
    for (const ev of events) {
      if (!PUSH_NOTIFY.has(ev.event)) continue
      byKind.set(ev.event, (byKind.get(ev.event) ?? 0) + 1)
      if (!firstTitle.has(ev.event)) firstTitle.set(ev.event, String(ev.todo.title ?? ''))
    }
    const label: Record<string, [string, string]> = {
      // [单条标题, 多条量词]
      added: ['＋ 新待办', '条新待办'],
      completed: ['✓ 已完成', '条已完成'],
      deleted: ['－ 已删除', '条已删除']
    }
    for (const [kind, n] of byKind) {
      const [title, noun] = label[kind]
      if (n === 1) notify({ title, message: firstTitle.get(kind) || '' })
      else notify({ title: 'Jovida', message: `${title.slice(0, 1)} ${n} ${noun}` }) // 批量:合并成一条,不刷屏
    }
  }

  // 拉取+对账串行化(合并高频信号):有在跑就标记待跑,跑完补一次。
  let running = false
  let pending = false
  const reconcile = async (): Promise<void> => {
    if (running) {
      pending = true
      return
    }
    running = true
    try {
      do {
        pending = false
        const next = (await loadSnapshot(ctx, { fresh: true })).snap
        if (prev) notifyPushBatch(diffSnapshots(prev, next))
        prev = next
        status.lastSignalAt = nowSec()
        refreshStatusline(next) // 计数 + statusline 缓存
        scheduleNextMoment() // 数据变了,提醒/到期时刻重排
      } while (pending && !controller.signal.aborted)
    } catch {
      /* 拉取失败:保留上一份,等下个信号/重连再对账 */
    } finally {
      running = false
    }
  }

  const shutdown = (): void => {
    controller.abort()
    if (momentTimer) clearTimeout(momentTimer)
    if (rescanTimer) clearInterval(rescanTimer)
    removePid()
  }
  const onSignal = (): void => {
    shutdown()
    process.exit(0)
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  // 周期重扫:把「刚进入 48h 视野」的提醒/到期时刻纳入排程(纯本地,不触网)。
  rescanTimer = setInterval(() => {
    if (prev) scheduleNextMoment()
  }, RESCAN_MS)
  if (rescanTimer.unref) rescanTimer.unref()

  flushStatus()
  try {
    await watchTodoSync(ctx, {
      signal: controller.signal,
      onConnect: async () => {
        status.connected = true
        flushStatus()
        await reconcile() // 首连=基线(无通知);重连=补拉断连期漏掉的变更
      },
      onSignal: reconcile,
      log: (msg) => {
        status.connected = false
        flushStatus()
        try {
          // 断连/重连提示写日志(start 已把 stdout/stderr 重定向到 daemon.log)
          process.stderr.write(`[${new Date().toISOString()}] ${msg}\n`)
        } catch {
          /* 忽略 */
        }
      }
    })
  } finally {
    shutdown()
  }
}

/** start:已活则报;否则自我 detach 到后台跑 `daemon run`,轮询确认起来。 */
export async function startDaemon(): Promise<{ ok: boolean; pid?: number; message: string }> {
  const existing = readPid()
  if (existing && isAlive(existing)) return { ok: true, pid: existing, message: `daemon already running (pid ${existing})` }
  if (existing) removePid() // 陈旧 pidfile

  ensureDir()
  const logfd = openSync(LOG_FILE, 'a')
  const child = spawn(process.execPath, [join(__dirname, 'cli.js'), 'daemon', 'run'], {
    detached: true,
    stdio: ['ignore', logfd, logfd],
    env: process.env
  })
  child.unref()

  // 子进程一起手就写 pidfile;轮询确认(网络/登录问题会让它很快退出并留不下活 pid)。
  for (let i = 0; i < 20; i++) {
    await sleep(100)
    const pid = readPid()
    if (pid && isAlive(pid)) return { ok: true, pid, message: `daemon up (pid ${pid})` }
  }
  return { ok: false, message: `daemon failed to start — see log: ${LOG_FILE}` }
}

/** stop:SIGTERM 并轮询退出。 */
export async function stopDaemon(): Promise<{ ok: boolean; message: string }> {
  const pid = readPid()
  if (!pid || !isAlive(pid)) {
    removePid()
    return { ok: false, message: 'daemon not running' }
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    /* 已退出 */
  }
  for (let i = 0; i < 30; i++) {
    if (!isAlive(pid)) {
      removePid()
      return { ok: true, message: 'daemon stopped' }
    }
    await sleep(100)
  }
  return { ok: false, message: `daemon still running (pid ${pid}) after SIGTERM` }
}

/** status:进程存活 + 状态文件汇总。 */
export function statusDaemon(): { running: boolean; status: DaemonStatus | null } {
  const pid = readPid()
  const running = !!(pid && isAlive(pid))
  return { running, status: running ? readStatus() : null }
}

export const DAEMON_LOG_FILE = LOG_FILE
