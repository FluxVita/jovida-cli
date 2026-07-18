// stream 源——「一个长驻命令,stdout 每行吐一条 JSONL 信封」。触发器协议的第四种源(继内置 todo、emit 推送、poll)。
// 是 emit 的「持续版」:emit 写一条信封,stream 是一个不停产信封的进程。引擎监督它——退出即按退避重启、逐行解析路由。
// 适合「有一个能持续吐事件的程序/管道」的场景(tail 日志、订阅某个流、桥接别的 CLI 的实时输出)。
//
// 行 = 一条信封 JSON `{source,type,title?,id?,at?,data?}`。stream 定义可给 source/type 缺省值:
// 行里没带就用缺省(故一个只知道自己 payload 的生成器,print `{"title":"…"}` 每行,配 --source/--type 即可)。
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { ulid } from 'ulid'
import type { Envelope } from './rules'

export interface StreamSource {
  id: string
  name?: string
  cmd: string // 长驻 sh -c 命令,stdout 每行一条信封 JSON
  source?: string // 缺省 source(行里没带 source 时用)
  type?: string // 缺省 type(行里没带 type 时用)
  enabled: boolean
  restart_sec?: number // 退出后重启退避基数(秒);默认 3
}
export interface StreamsFile {
  streams: StreamSource[]
}

const DIR = process.env['JOVIDA_HOME'] ?? join(homedir(), '.jovida', 'cli')
export const STREAMS_FILE = join(DIR, 'streams.json')

export const DEFAULT_RESTART_SEC = 3

export const newStreamId = (): string => `str_${ulid()}`

function ensureDir(): void {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true, mode: 0o700 })
}

// ── 读写 streams.json（容错:坏结构/坏项跳过,绝不抛)──
function normalizeStream(s: unknown): StreamSource | null {
  const o = s as Partial<StreamSource>
  if (!o || typeof o.id !== 'string') return null
  if (typeof o.cmd !== 'string' || !o.cmd) return null
  return {
    id: o.id,
    name: typeof o.name === 'string' ? o.name : undefined,
    cmd: o.cmd,
    source: typeof o.source === 'string' ? o.source : undefined,
    type: typeof o.type === 'string' ? o.type : undefined,
    enabled: o.enabled !== false,
    restart_sec: typeof o.restart_sec === 'number' && o.restart_sec > 0 ? o.restart_sec : undefined
  }
}
export function parseStreams(text: string): StreamSource[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return []
  }
  const raw = (data as { streams?: unknown })?.streams
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeStream).filter((x): x is StreamSource => x !== null)
}
export function loadStreams(): StreamSource[] {
  try {
    return parseStreams(readFileSync(STREAMS_FILE, 'utf8'))
  } catch {
    return []
  }
}
export function saveStreams(streams: StreamSource[]): void {
  ensureDir()
  writeFileSync(STREAMS_FILE, JSON.stringify({ streams } satisfies StreamsFile, null, 2) + '\n', { mode: 0o600 })
}

/**
 * 校验+规范化「一条」stream 源(agent 产整条 JSON 走这里)。缺 id 自动补、enabled 缺省 true。
 * 只强制要 cmd;source/type 是给「行里不带」时的缺省,可省。
 */
export function validateStreamSpec(input: string | object): StreamSource {
  let obj: unknown = input
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input)
    } catch {
      throw new Error('stream spec must be valid JSON')
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('stream spec must be a JSON object')
  const o = obj as Partial<StreamSource>
  if (typeof o.cmd !== 'string' || !o.cmd) throw new Error('stream needs "cmd" (a long-lived command that prints one envelope JSON per line)')
  if (o.restart_sec !== undefined && !(typeof o.restart_sec === 'number' && o.restart_sec > 0)) throw new Error('"restart_sec" must be a positive number')
  return {
    id: typeof o.id === 'string' && o.id ? o.id : newStreamId(),
    name: typeof o.name === 'string' ? o.name : undefined,
    cmd: o.cmd,
    source: typeof o.source === 'string' ? o.source : undefined,
    type: typeof o.type === 'string' ? o.type : undefined,
    enabled: o.enabled !== false,
    restart_sec: typeof o.restart_sec === 'number' ? o.restart_sec : undefined
  }
}

/**
 * 解析 stream 的一行 → 信封。行须是一个 JSON 对象;source/type 行里没带则用 stream 缺省。
 * 解析不了 / 补不齐 source+type → null(该行跳过,不抛)。纯函数,便于测。
 */
export function parseStreamLine(line: string, def: { source?: string; type?: string }): Envelope | null {
  const t = line.trim()
  if (!t) return null
  let o: unknown
  try {
    o = JSON.parse(t)
  } catch {
    return null
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  const e = o as Record<string, unknown>
  const source = typeof e.source === 'string' && e.source ? e.source : def.source
  const type = typeof e.type === 'string' && e.type ? e.type : def.type
  if (!source || !type) return null
  return {
    source,
    type,
    title: typeof e.title === 'string' ? e.title : undefined,
    id: typeof e.id === 'string' ? e.id : undefined,
    at: typeof e.at === 'number' ? e.at : undefined,
    data: e.data && typeof e.data === 'object' && !Array.isArray(e.data) ? (e.data as Record<string, unknown>) : undefined
  }
}
