// task/worker(#8)——事件派发的「任务」+ 本地常驻 agent worker 的持久层。纯:类型、任务队列读写、worker 配置、
// 从 dispatch 动作构造任务。真正的常驻串行执行在 ../worker.ts。
//
// 任务经文件队列(tasks/<id>.json)流转:规则 dispatch 写入(queued)→ worker 串行取(running)→ 跑 agent 命令
// → 落状态(done/failed)。worker 完成后回吐 task.done/failed 信封进事件 spool,可再喂规则(闭环)。
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, renameSync } from 'node:fs'
import { ulid } from 'ulid'
import { renderTemplate, type Envelope, type DispatchSpec } from './rules'

export type TaskStatus = 'queued' | 'running' | 'done' | 'failed'
export interface Task {
  id: string
  prompt: string
  cwd?: string
  agent?: string // 覆盖 worker 的 agent 命令
  todo_id?: string
  source?: string // 来源:规则 id / "manual"
  created_at: number
  status: TaskStatus
  started_at?: number
  finished_at?: number
  exit_code?: number
}

// worker 配置:agent 命令(sh -c 模板;prompt 走 $JOVIDA_TASK_PROMPT + stdin,**不插值**,同 exec 安全模型)+ 缺省工作目录。
export interface WorkerConfig {
  agent_cmd?: string
  cwd?: string
  timeout_sec?: number // 单个任务最长跑多久(默认 1800=30min);超时杀掉判 failed
}

const DIR = process.env['JOVIDA_HOME'] ?? join(homedir(), '.jovida', 'cli')
export const TASKS_DIR = join(DIR, 'tasks')
export const WORKER_CONFIG_FILE = join(DIR, 'worker.json')
export const WORKSPACE_DIR = join(DIR, 'workspace') // agent 缺省工作目录(未配 cwd 时)

export const newTaskId = (): string => `tsk_${ulid()}`

function ensureDir(d: string): void {
  if (!existsSync(d)) mkdirSync(d, { recursive: true, mode: 0o700 })
}
export function ensureTasksDir(): void {
  ensureDir(TASKS_DIR)
}

// ── 任务队列读写(原子写:tmp+rename,防 worker 读到半截) ──
export function writeTask(task: Task): string {
  ensureTasksDir()
  const dst = join(TASKS_DIR, `${task.id}.json`)
  const tmp = join(TASKS_DIR, `.${task.id}.json.tmp`)
  writeFileSync(tmp, JSON.stringify(task, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, dst)
  return dst
}
export function readTasks(): Task[] {
  let files: string[]
  try {
    files = readdirSync(TASKS_DIR)
      .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
      .sort() // ulid 文件名 ≈ 时间序
  } catch {
    return []
  }
  const out: Task[] = []
  for (const f of files) {
    try {
      const t = JSON.parse(readFileSync(join(TASKS_DIR, f), 'utf8')) as Task
      if (t && typeof t.id === 'string' && typeof t.prompt === 'string') out.push(t)
    } catch {
      /* 坏文件:跳过 */
    }
  }
  return out
}
export function readTask(id: string): Task | null {
  const t = readTasks().find((x) => x.id === id || x.id.endsWith(id))
  return t ?? null
}
export function updateTask(id: string, patch: Partial<Task>): Task | null {
  const t = readTask(id)
  if (!t) return null
  const next = { ...t, ...patch }
  writeTask(next)
  return next
}
export function removeTask(id: string): void {
  try {
    rmSync(join(TASKS_DIR, `${id}.json`))
  } catch {
    /* 不存在即忽略 */
  }
}
/** 清掉已结束(done/failed)的任务文件,返回清掉数。 */
export function clearFinishedTasks(): number {
  let n = 0
  for (const t of readTasks()) {
    if (t.status === 'done' || t.status === 'failed') {
      removeTask(t.id)
      n++
    }
  }
  return n
}

// ── worker 配置读写 ──
export function loadWorkerConfig(): WorkerConfig {
  try {
    const o = JSON.parse(readFileSync(WORKER_CONFIG_FILE, 'utf8'))
    return o && typeof o === 'object' ? (o as WorkerConfig) : {}
  } catch {
    return {}
  }
}
export function saveWorkerConfig(cfg: WorkerConfig): void {
  ensureDir(DIR)
  writeFileSync(WORKER_CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 })
}

/** 校验 dispatch 动作规格(agent 撰写整条 rule 时也过 normalizeAction,这里给 task add / 显式构造用)。 */
export function validateDispatchSpec(input: string | object): DispatchSpec {
  let obj: unknown = input
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input)
    } catch {
      throw new Error('dispatch spec must be valid JSON')
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('dispatch spec must be a JSON object')
  const o = obj as Partial<DispatchSpec>
  if (typeof o.prompt !== 'string' || !o.prompt) throw new Error('dispatch needs "prompt" (the instruction for the agent)')
  return {
    prompt: o.prompt,
    cwd: typeof o.cwd === 'string' ? o.cwd : undefined,
    todo_id: typeof o.todo_id === 'string' ? o.todo_id : undefined,
    agent: typeof o.agent === 'string' ? o.agent : undefined
  }
}

/** 从 dispatch 动作 + 信封构造一个 queued 任务(字段模板渲染;prompt 空则抛)。source=规则 id。 */
export function buildTaskFromDispatch(spec: DispatchSpec, env: Envelope, source: string, now: number): Task {
  const prompt = renderTemplate(spec.prompt, env)
  if (!prompt.trim()) throw new Error('dispatch prompt rendered empty')
  return {
    id: newTaskId(),
    prompt,
    cwd: spec.cwd ? renderTemplate(spec.cwd, env) : undefined,
    agent: spec.agent ? renderTemplate(spec.agent, env) : undefined,
    todo_id: spec.todo_id ? renderTemplate(spec.todo_id, env) : undefined,
    source,
    created_at: now,
    status: 'queued'
  }
}
