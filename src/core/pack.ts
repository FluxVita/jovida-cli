// pack(注册表/快捷指令库)——把「一套连贯的自动化」打包成一个可分享的 bundle 文件,import 即装成实时定义。
// bundle = { name, description?, rules[], polls[], streams[] }:触发源(poll/stream)+ 反应规则(rules)一起走。
// 关键:规则按 `source.type` 字符串引用源,**不按 id**——故 import 时给每条重发新 id 完全安全(bundle 是模板,
// 每次 import 实例化一份;不会和现有定义撞 id、也不影响规则→源的绑定)。库 = ~/.jovida/cli/packs/ 下的一堆 bundle 文件。
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { validateRuleSpec, newRuleId, type Rule } from './rules'
import { validatePollSpec, newPollId, type PollSource } from './poll'
import { validateStreamSpec, newStreamId, type StreamSource } from './stream'

export interface Bundle {
  name: string
  description?: string
  rules?: Rule[]
  polls?: PollSource[]
  streams?: StreamSource[]
}

const DIR = process.env['JOVIDA_HOME'] ?? join(homedir(), '.jovida', 'cli')
export const PACKS_DIR = join(DIR, 'packs')

const NAME_RE = /^[a-zA-Z0-9._-]+$/ // pack 名当文件名用,收紧字符集

function ensurePacksDir(): void {
  if (!existsSync(PACKS_DIR)) mkdirSync(PACKS_DIR, { recursive: true, mode: 0o700 })
}
export function isValidPackName(name: string): boolean {
  return NAME_RE.test(name) && name !== '.' && name !== '..'
}

/** 组装 bundle(export 用):给定名字/描述 + 已选定义。空数组不写进去。 */
export function buildBundle(name: string, description: string | undefined, sel: { rules?: Rule[]; polls?: PollSource[]; streams?: StreamSource[] }): Bundle {
  const b: Bundle = { name }
  if (description) b.description = description
  if (sel.rules && sel.rules.length) b.rules = sel.rules
  if (sel.polls && sel.polls.length) b.polls = sel.polls
  if (sel.streams && sel.streams.length) b.streams = sel.streams
  return b
}

/**
 * 校验 bundle(import 用):逐条过对应 validator,任一坏就抛清晰错误(指明是哪类第几条)。
 * 返回规范化后的三类定义(id 已由各 validator 补齐;是否重发新 id 由调用方决定)。
 */
export function validateBundle(input: string | object): Bundle {
  let obj: unknown = input
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input)
    } catch {
      throw new Error('bundle must be valid JSON')
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('bundle must be a JSON object')
  const o = obj as Partial<Bundle>
  const name = typeof o.name === 'string' && o.name ? o.name : 'imported'
  const each = <T>(arr: unknown, kind: string, fn: (x: object) => T): T[] => {
    if (arr === undefined) return []
    if (!Array.isArray(arr)) throw new Error(`bundle "${kind}" must be an array`)
    return arr.map((x, i) => {
      try {
        return fn(x as object) // 各 validator 自会挡住非对象项并报清晰错
      } catch (e) {
        throw new Error(`bundle ${kind}[${i}]: ${(e as Error).message}`)
      }
    })
  }
  return {
    name,
    description: typeof o.description === 'string' ? o.description : undefined,
    rules: each(o.rules, 'rules', validateRuleSpec),
    polls: each(o.polls, 'polls', validatePollSpec),
    streams: each(o.streams, 'streams', validateStreamSpec)
  }
}

/** 给 bundle 内所有定义重发新 id(import 实例化用)。规则→源按 source.type 绑定,故换 id 不影响绑定。 */
export function reidBundle(b: Bundle): Bundle {
  return {
    ...b,
    rules: b.rules?.map((r) => ({ ...r, id: newRuleId() })),
    polls: b.polls?.map((p) => ({ ...p, id: newPollId() })),
    streams: b.streams?.map((s) => ({ ...s, id: newStreamId() }))
  }
}

export function bundleCounts(b: Bundle): { rules: number; polls: number; streams: number } {
  return { rules: b.rules?.length ?? 0, polls: b.polls?.length ?? 0, streams: b.streams?.length ?? 0 }
}

// ── 本地库:~/.jovida/cli/packs/<name>.json ──
export function packPath(name: string): string {
  return join(PACKS_DIR, `${name}.json`)
}
export function listPacks(): string[] {
  try {
    return readdirSync(PACKS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length))
      .sort()
  } catch {
    return []
  }
}
export function readPack(name: string): Bundle {
  if (!isValidPackName(name)) throw new Error(`invalid pack name: ${name}`)
  let text: string
  try {
    text = readFileSync(packPath(name), 'utf8')
  } catch {
    throw new Error(`no pack named "${name}" (see: jovida pack list)`)
  }
  return validateBundle(text)
}
export function writePack(name: string, bundle: Bundle): void {
  if (!isValidPackName(name)) throw new Error(`invalid pack name: ${name} (use letters, digits, . _ -)`)
  ensurePacksDir()
  writeFileSync(packPath(name), JSON.stringify(bundle, null, 2) + '\n', { mode: 0o600 })
}
export function removePack(name: string): void {
  if (!isValidPackName(name)) throw new Error(`invalid pack name: ${name}`)
  try {
    rmSync(packPath(name))
  } catch {
    throw new Error(`no pack named "${name}"`)
  }
}
