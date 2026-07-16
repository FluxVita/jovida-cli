// jovida worker — 常驻串行 agent worker(#8)。从任务队列(tasks/ spool)**一次一个**地取 queued 任务,
// 跑配置的 agent 命令(sh -c;prompt 走 $JOVIDA_TASK_PROMPT + stdin,**不插值**,同 exec 安全模型),
// 落状态(running→done/failed)+ 日志(tasks/<id>.log),完成后回吐 task.done/failed 信封进事件 spool(可再喂规则,闭环)。
// 独立进程、自己的生命周期(不连 SSE)。安全:未配置 agent_cmd 就拒跑(不猜、不擅自放 agent 干活)。
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, openSync, closeSync, watch as fsWatch, type FSWatcher } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import {
  TASKS_DIR,
  WORKSPACE_DIR,
  ensureTasksDir,
  readTasks,
  updateTask,
  loadWorkerConfig,
  type Task
} from './core/task'
import { writeEvent } from './core/rules'

const DIR = process.env['JOVIDA_HOME'] ?? join(homedir(), '.jovida', 'cli')
const PID_FILE = join(DIR, 'worker.pid')
const STATUS_FILE = join(DIR, 'worker-status.json')
const LOG_FILE = join(DIR, 'worker.log')

const DEFAULT_TIMEOUT_SEC = 1800 // 单任务默认 30min
const RESCAN_MS = 60_000 // 兜底重扫队列(watch 漏了也能捡起)

const nowSec = (): number => Math.floor(Date.now() / 1000)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function ensureDir(d: string): void {
  if (!existsSync(d)) mkdirSync(d, { recursive: true, mode: 0o700 })
}

// ---- pidfile / 存活 ----
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
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
  ensureDir(DIR)
  writeFileSync(PID_FILE, String(pid), { mode: 0o600 })
}
function removePid(): void {
  try {
    rmSync(PID_FILE)
  } catch {
    /* 忽略 */
  }
}

interface WorkerStatus {
  pid: number
  startedAt: number
  agentConfigured: boolean
  queued: number
  running: number
  done: number
  failed: number
  updatedAt: number
}
function writeStatus(s: WorkerStatus): void {
  try {
    ensureDir(DIR)
    writeFileSync(STATUS_FILE, JSON.stringify(s), { mode: 0o600 })
  } catch {
    /* 尽力而为 */
  }
}
export function readWorkerStatus(): WorkerStatus | null {
  try {
    return JSON.parse(readFileSync(STATUS_FILE, 'utf8')) as WorkerStatus
  } catch {
    return null
  }
}

const firstLine = (s: string): string => (s.split('\n')[0] ?? '').trim().slice(0, 80)

/** worker 工作体:前台阻塞直到 SIGINT/SIGTERM。串行处理队列。 */
export async function runWorker(): Promise<void> {
  const existing = readPid()
  if (existing && existing !== process.pid && isAlive(existing)) {
    throw new Error(`worker already running (pid ${existing}) — run 'jovida worker stop' first`)
  }
  writePid(process.pid)
  ensureTasksDir()

  let stopped = false
  let busy = false
  let current: ChildProcess | null = null
  let watcher: FSWatcher | null = null
  let rescan: NodeJS.Timeout | null = null

  const logLine = (msg: string): void => {
    try {
      process.stderr.write(`[${new Date().toISOString()}] ${msg}\n`)
    } catch {
      /* 忽略 */
    }
  }

  const flushStatus = (): void => {
    const tasks = readTasks()
    const by = (s: Task['status']): number => tasks.filter((t) => t.status === s).length
    writeStatus({
      pid: process.pid,
      startedAt: startedAt,
      agentConfigured: !!loadWorkerConfig().agent_cmd,
      queued: by('queued'),
      running: by('running'),
      done: by('done'),
      failed: by('failed'),
      updatedAt: nowSec()
    })
  }
  const startedAt = nowSec()

  // 跑一个任务:mark running → sh -c agent_cmd(cwd + env + prompt via stdin)→ mark done/failed + 回吐信封。
  const runTask = (task: Task): void => {
    const cfg = loadWorkerConfig()
    const agentCmd = task.agent || cfg.agent_cmd
    if (!agentCmd) {
      // 未配置 agent 命令:不猜、不跑。标 failed 并提示,避免任务永远卡 queued。
      updateTask(task.id, { status: 'failed', finished_at: nowSec(), exit_code: -1 })
      logLine(`task ${task.id} failed: no agent_cmd configured (jovida worker config --agent-cmd '…')`)
      writeEvent({ source: 'task', type: 'failed', id: task.id, title: firstLine(task.prompt), data: { task_id: task.id, todo_id: task.todo_id, reason: 'no agent_cmd', source: task.source } })
      busy = false
      tick()
      return
    }
    const cwd = task.cwd || cfg.cwd || WORKSPACE_DIR
    ensureDir(cwd)
    const timeoutMs = (cfg.timeout_sec && cfg.timeout_sec > 0 ? cfg.timeout_sec : DEFAULT_TIMEOUT_SEC) * 1000
    const logPath = join(TASKS_DIR, `${task.id}.log`)
    let logfd: number
    try {
      logfd = openSync(logPath, 'a')
    } catch {
      logfd = openSync('/dev/null', 'a')
    }

    updateTask(task.id, { status: 'running', started_at: nowSec() })
    flushStatus()
    logLine(`task ${task.id} running (cwd ${cwd}): ${firstLine(task.prompt)}`)

    let child: ChildProcess
    try {
      child = spawn('sh', ['-c', agentCmd], {
        cwd,
        env: { ...process.env, JOVIDA_TASK_PROMPT: task.prompt, JOVIDA_TASK_ID: task.id, JOVIDA_TODO_ID: task.todo_id ?? '', JOVIDA_TASK_CWD: cwd },
        stdio: ['pipe', logfd, logfd]
      })
    } catch (e) {
      closeSync(logfd)
      updateTask(task.id, { status: 'failed', finished_at: nowSec(), exit_code: -1 })
      logLine(`task ${task.id} spawn failed: ${(e as Error).message}`)
      writeEvent({ source: 'task', type: 'failed', id: task.id, title: firstLine(task.prompt), data: { task_id: task.id, todo_id: task.todo_id, source: task.source } })
      busy = false
      tick()
      return
    }
    current = child
    const killer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* 已退出 */
      }
      logLine(`task ${task.id} timed out (${timeoutMs}ms), killed`)
    }, timeoutMs)
    if (killer.unref) killer.unref()

    try {
      child.stdin?.end(task.prompt + '\n') // prompt 也喂 stdin(有的 agent 从 stdin 读)
    } catch {
      /* 忽略 */
    }
    child.on('close', (code) => {
      clearTimeout(killer)
      closeSync(logfd)
      current = null
      const ok = code === 0
      updateTask(task.id, { status: ok ? 'done' : 'failed', finished_at: nowSec(), exit_code: code ?? -1 })
      logLine(`task ${task.id} ${ok ? 'done' : 'failed'} (exit ${code ?? '?'})`)
      // 回吐信封进事件 spool:守护(若在)会派发,规则可反应(如 task.done → complete {data.todo_id})
      writeEvent({ source: 'task', type: ok ? 'done' : 'failed', id: task.id, title: firstLine(task.prompt), data: { task_id: task.id, todo_id: task.todo_id, exit_code: code ?? -1, source: task.source } })
      flushStatus()
      busy = false
      tick()
    })
  }

  // 串行调度:不忙就取最老的 queued 任务跑;跑完再 tick 取下一个。
  const tick = (): void => {
    if (stopped || busy) return
    const next = readTasks().find((t) => t.status === 'queued')
    if (!next) return
    busy = true
    runTask(next)
  }

  const shutdown = (): void => {
    stopped = true
    if (watcher) watcher.close()
    if (rescan) clearInterval(rescan)
    if (current) {
      try {
        current.kill('SIGTERM')
      } catch {
        /* 已退出 */
      }
    }
    removePid()
  }
  const onSignal = (): void => {
    shutdown()
    process.exit(0)
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  // 起手把上次残留的 running(worker 崩溃时卡住的)重置回 queued,便于重跑
  for (const t of readTasks()) if (t.status === 'running') updateTask(t.id, { status: 'queued' })

  try {
    watcher = fsWatch(TASKS_DIR, () => tick())
  } catch (e) {
    logLine(`tasks watch unavailable (${(e as Error).message}); relying on periodic rescan`)
  }
  rescan = setInterval(() => tick(), RESCAN_MS)
  if (rescan.unref) rescan.unref()

  flushStatus()
  logLine(`worker up (pid ${process.pid})${loadWorkerConfig().agent_cmd ? '' : ' — no agent_cmd configured yet'}`)
  tick() // 处理起手已排队的

  // 阻塞直到收到信号(worker 本身靠 watcher/rescan 定时器维持事件循环;这里挂一个长睡保活)
  while (!stopped) await sleep(3600_000)
}

/** start:已活则报;否则自我 detach 到后台跑 `worker run`,轮询确认。 */
export async function startWorker(): Promise<{ ok: boolean; pid?: number; message: string }> {
  const existing = readPid()
  if (existing && isAlive(existing)) return { ok: true, pid: existing, message: `worker already running (pid ${existing})` }
  if (existing) removePid()

  ensureDir(DIR)
  const logfd = openSync(LOG_FILE, 'a')
  const child = spawn(process.execPath, [join(__dirname, 'cli.js'), 'worker', 'run'], {
    detached: true,
    stdio: ['ignore', logfd, logfd],
    env: process.env
  })
  child.unref()

  for (let i = 0; i < 20; i++) {
    await sleep(100)
    const pid = readPid()
    if (pid && isAlive(pid)) return { ok: true, pid, message: `worker up (pid ${pid})` }
  }
  return { ok: false, message: `worker failed to start — see log: ${LOG_FILE}` }
}

/** stop:SIGTERM 并轮询退出。 */
export async function stopWorker(): Promise<{ ok: boolean; message: string }> {
  const pid = readPid()
  if (!pid || !isAlive(pid)) {
    removePid()
    return { ok: false, message: 'worker not running' }
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    /* 已退出 */
  }
  for (let i = 0; i < 30; i++) {
    if (!isAlive(pid)) {
      removePid()
      return { ok: true, message: 'worker stopped' }
    }
    await sleep(100)
  }
  return { ok: false, message: `worker still running (pid ${pid}) after SIGTERM` }
}

export function statusWorker(): { running: boolean; status: WorkerStatus | null } {
  const pid = readPid()
  const running = !!(pid && isAlive(pid))
  return { running, status: running ? readWorkerStatus() : null }
}

export const WORKER_LOG_FILE = LOG_FILE
