// poll 源——「定时检查一个条件,成立就发一条信封」。是触发器协议里的一种**源**(不是动作):
// 引擎不懂天气/CI/文件,poll 只把「检查命令 exit 0 = 条件成立」翻成 `<source>.<type>` 信封喂给引擎,
// 规则再用 `when: weather.rain` 去消费。故一个 poll 源可驱动多条规则,组合自由(像快捷指令的「自动化触发」)。
//
// 关键语义:**边沿触发**——只在「上次不成立 → 这次成立」那一下发信封(false→true),持续成立不重复发;
// true→false 只复位状态,下次再成立会再发。状态落盘(poll-state.json),故守护重启不会把「当前正下雨」误当成新边沿。
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { ulid } from 'ulid'
import type { Envelope } from './rules'

// ── 源定义 ──
export interface PollSource {
  id: string
  name?: string
  source: string // 信封 source,如 weather
  type: string // 信封 type,如 rain
  check: string // sh -c 命令;exit 0 = 条件成立,非 0 = 不成立
  interval_sec: number // 检查间隔(秒)
  title?: string // 信封 title(缺省用 check 首行 stdout / 源名)
  enabled: boolean
}
export interface PollsFile {
  polls: PollSource[]
}

// ── 运行时状态(守护持有并落盘,重启后据此判边沿) ──
export interface PollState {
  state: boolean // 上次观测:条件是否成立
  checkedAt?: number // 上次检查时刻(unix 秒)
  firedAt?: number // 上次发信封(上升沿)时刻
  lastOutput?: string // 上次 check 的 stdout(截断)
}
export type PollStateMap = Record<string, PollState>

const DIR = process.env['JOVIDA_HOME'] ?? join(homedir(), '.jovida', 'cli')
export const POLLS_FILE = join(DIR, 'polls.json')
export const POLL_STATE_FILE = join(DIR, 'poll-state.json')

export const newPollId = (): string => `pol_${ulid()}`

function ensureDir(): void {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true, mode: 0o700 })
}

/** 间隔解析:30s / 5m / 1h,纯数字=秒(poll 是短检查,默认单位秒,和 due 的「默认小时」不同)。 */
export function parseInterval(s: string): number {
  const m = /^(\d+)\s*([smh])?$/i.exec(s.trim())
  if (!m || Number(m[1]) <= 0) throw new Error('--interval must be like 30s, 5m, 1h, or a plain number of seconds')
  const n = Number(m[1])
  const unit = (m[2] ?? 's').toLowerCase()
  return n * (unit === 's' ? 1 : unit === 'm' ? 60 : 3600)
}

// ── 读写 polls.json（容错:坏结构/坏项跳过,绝不抛,避免拖垮守护）──
function normalizePoll(p: unknown): PollSource | null {
  const o = p as Partial<PollSource>
  if (!o || typeof o.id !== 'string') return null
  if (typeof o.source !== 'string' || !o.source) return null
  if (typeof o.type !== 'string' || !o.type) return null
  if (typeof o.check !== 'string' || !o.check) return null
  if (typeof o.interval_sec !== 'number' || o.interval_sec <= 0) return null
  return {
    id: o.id,
    name: typeof o.name === 'string' ? o.name : undefined,
    source: o.source,
    type: o.type,
    check: o.check,
    interval_sec: o.interval_sec,
    title: typeof o.title === 'string' ? o.title : undefined,
    enabled: o.enabled !== false
  }
}
export function parsePolls(text: string): PollSource[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return []
  }
  const raw = (data as { polls?: unknown })?.polls
  if (!Array.isArray(raw)) return []
  return raw.map(normalizePoll).filter((x): x is PollSource => x !== null)
}
export function loadPolls(): PollSource[] {
  try {
    return parsePolls(readFileSync(POLLS_FILE, 'utf8'))
  } catch {
    return []
  }
}
export function savePolls(polls: PollSource[]): void {
  ensureDir()
  writeFileSync(POLLS_FILE, JSON.stringify({ polls } satisfies PollsFile, null, 2) + '\n', { mode: 0o600 })
}

// ── poll 状态落盘(守护独占写;坏文件当空) ──
export function loadPollState(): PollStateMap {
  try {
    const o = JSON.parse(readFileSync(POLL_STATE_FILE, 'utf8'))
    return o && typeof o === 'object' ? (o as PollStateMap) : {}
  } catch {
    return {}
  }
}
export function savePollState(state: PollStateMap): void {
  try {
    ensureDir()
    writeFileSync(POLL_STATE_FILE, JSON.stringify(state), { mode: 0o600 })
  } catch {
    /* 尽力而为:丢了大不了下次重判一次边沿 */
  }
}

/**
 * 校验+规范化「一条」poll 源(agent 产整条 JSON 走这里,而非拼 flag)。缺 id 自动补、enabled 缺省 true。
 * interval 接受 interval_sec(数字)或 interval(字符串如 "5m")。校验不过即抛清晰错误。
 */
export function validatePollSpec(input: string | object): PollSource {
  let obj: unknown = input
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input)
    } catch {
      throw new Error('poll spec must be valid JSON')
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('poll spec must be a JSON object')
  const o = obj as Partial<PollSource> & { interval?: unknown }
  if (typeof o.source !== 'string' || !o.source) throw new Error('poll needs "source" (envelope namespace, e.g. "weather")')
  if (typeof o.type !== 'string' || !o.type) throw new Error('poll needs "type" (event kind, e.g. "rain")')
  if (typeof o.check !== 'string' || !o.check) throw new Error('poll needs "check" (sh -c command; exit 0 = condition true)')
  let interval_sec: number
  if (typeof o.interval_sec === 'number') interval_sec = o.interval_sec
  else if (typeof o.interval === 'string') interval_sec = parseInterval(o.interval)
  else if (typeof o.interval === 'number') interval_sec = o.interval
  else throw new Error('poll needs "interval_sec" (number) or "interval" ("30s"/"5m"/"1h")')
  if (!(interval_sec > 0)) throw new Error('poll interval must be > 0')
  return {
    id: typeof o.id === 'string' && o.id ? o.id : newPollId(),
    name: typeof o.name === 'string' ? o.name : undefined,
    source: o.source,
    type: o.type,
    check: o.check,
    interval_sec,
    title: typeof o.title === 'string' ? o.title : undefined,
    enabled: o.enabled !== false
  }
}

/** 上升沿判定:上次不成立(或从未观测)+ 这次成立 = 该发信封。纯函数,便于测。 */
export function isRisingEdge(prev: boolean | undefined, condition: boolean): boolean {
  return condition && !prev
}

/** poll 命中(上升沿)→ 信封。check 的 stdout 进 data.output,供规则 where 过滤 / notify 模板用。 */
export function buildPollEnvelope(p: PollSource, output: string, at: number): Envelope {
  const firstLine = output.split('\n')[0]?.trim() || undefined
  return {
    source: p.source,
    type: p.type,
    title: p.title ?? firstLine ?? p.name ?? `${p.source}.${p.type}`,
    id: p.id,
    at,
    data: { output: output.trim(), poll_id: p.id, ...(p.name ? { poll: p.name } : {}) }
  }
}
