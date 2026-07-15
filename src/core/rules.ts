// 触发器协议（rules）——「当 X 发生就做 Y」的声明式自动化。纯模块:信封类型、读写 rules.json、
// 匹配(when/where)、模板渲染、以及推送事件的 spool 读写。执行(exec/notify)+冷却在 ../rules.ts,
// 实际触发在守护里(嵌入式引擎)。
//
// 协议内核:引擎只认一个统一的「事件信封」(Envelope)+两条约定——源怎么产出信封、动作怎么消费信封。
// 源与动作都只是「会说这套信封的命令」,故谁都能加(像快捷指令的积木,只不过积木是命令)。
//   - 内置 `todo` 源:守护把待办变更/时刻直接合成信封(source:todo)。
//   - 推送源:任何东西(Claude Code hook / cron / 脚本)`jovida emit <源> <类型>` 把信封写进 spool,守护取走。
//   - (poll / stream 源:后续步骤。)
// 规则 = when(源.类型) [where(信封字段过滤)] → do(动作列表)。引擎不懂 todo/天气,只做信封路由。
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, renameSync } from 'node:fs'
import { ulid } from 'ulid'

// ── 事件信封:协议的心脏 ──
export interface Envelope {
  source: string // 命名空间,如 todo / claude / weather
  type: string // 该源内的事件种类,如 completed / commit / rain
  title?: string // 人读标签
  id?: string // 主体 id(可选)
  at?: number // Unix 秒;缺省由引擎补
  data?: Record<string, unknown> // 源自定义载荷,引擎不解析
}

// ── 动作:消费信封的东西 ──
export interface NotifySpec {
  title?: string
  message?: string
  subtitle?: string
}
export type Action = { exec: string } | { notify: NotifySpec }

// ── 规则:绑定 ──
export interface Rule {
  id: string
  name?: string
  when: string // "源.类型" | "源.*" | "源"(任意类型)
  where?: Record<string, string> // 信封字段路径 → 匹配式(~正则 / =精确 / 缺省子串)
  do: Action[] // 动作列表(命中即依次执行)
  enabled: boolean
  cooldown_sec?: number // 同一规则两次触发的最短间隔(秒)
}

export interface RulesFile {
  rules: Rule[]
}

const DIR = process.env['JOVIDA_HOME'] ?? join(homedir(), '.jovida', 'cli')
export const RULES_FILE = join(DIR, 'rules.json')
export const EVENTS_DIR = join(DIR, 'events') // 推送事件 spool(emit 写、守护取)

export const newRuleId = (): string => `rul_${ulid()}`

function ensureDir(): void {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true, mode: 0o700 })
}
export function ensureEventsDir(): void {
  if (!existsSync(EVENTS_DIR)) mkdirSync(EVENTS_DIR, { recursive: true, mode: 0o700 })
}

// ── when 解析:字符串"源.类型"或对象 ──
export function parseWhen(when: string | { source: string; type?: string }): { source: string; type?: string } {
  if (typeof when !== 'string') return { source: when.source, type: when.type }
  const i = when.indexOf('.')
  if (i < 0) return { source: when.trim() }
  return { source: when.slice(0, i).trim(), type: when.slice(i + 1).trim() }
}
function whenToString(when: unknown): string {
  if (typeof when === 'string') return when.trim()
  const w = when as { source?: string; type?: string }
  if (w && typeof w.source === 'string') return w.type ? `${w.source}.${w.type}` : w.source
  return ''
}

// ── 读写 rules.json（容错:坏结构/坏项一律跳过,绝不抛,避免拖垮守护）──
function normalizeAction(a: unknown): Action | null {
  const act = a as { exec?: unknown; notify?: unknown }
  if (act && typeof act.exec === 'string') return { exec: act.exec }
  if (act && act.notify && typeof act.notify === 'object') return { notify: act.notify as NotifySpec }
  return null
}
export function parseRules(text: string): Rule[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return []
  }
  const raw = (data as { rules?: unknown })?.rules
  if (!Array.isArray(raw)) return []
  const out: Rule[] = []
  for (const r of raw) {
    const rule = r as Partial<Rule>
    if (!rule || typeof rule.id !== 'string') continue
    const when = whenToString(rule.when)
    if (!when) continue
    const actions = Array.isArray(rule.do) ? rule.do.map(normalizeAction).filter((x): x is Action => x !== null) : []
    if (actions.length === 0) continue // 无动作的规则无意义
    out.push({
      id: rule.id,
      name: typeof rule.name === 'string' ? rule.name : undefined,
      when,
      where: rule.where && typeof rule.where === 'object' ? (rule.where as Record<string, string>) : undefined,
      do: actions,
      enabled: rule.enabled !== false, // 缺省启用
      cooldown_sec: typeof rule.cooldown_sec === 'number' ? rule.cooldown_sec : undefined
    })
  }
  return out
}
export function loadRules(): Rule[] {
  try {
    return parseRules(readFileSync(RULES_FILE, 'utf8'))
  } catch {
    return []
  }
}
export function saveRules(rules: Rule[]): void {
  ensureDir()
  writeFileSync(RULES_FILE, JSON.stringify({ rules } satisfies RulesFile, null, 2) + '\n', { mode: 0o600 })
}

// ── 字段解析:单段路径先查顶层再落 data(故 category/priority 等 data 字段可裸写);多段按路径走 ──
const pad = (n: number): string => String(n).padStart(2, '0')
const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export function fieldByPath(env: Envelope, path: string): unknown {
  if (path === 'today') return ymd(new Date())
  if (path === 'tomorrow') {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return ymd(d)
  }
  const parts = path.split('.')
  if (parts.length === 1) {
    const top = (env as unknown as Record<string, unknown>)[parts[0]]
    if (top !== undefined && top !== null) return top
    return env.data?.[parts[0]]
  }
  let cur: unknown = env
  for (const p of parts) {
    if (cur == null) return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

/** 匹配式:~开头=正则(不区分大小写);=开头=精确;否则子串(不区分大小写)。 */
export function matchExpr(value: string, expr: string): boolean {
  if (expr.startsWith('~')) {
    try {
      return new RegExp(expr.slice(1), 'i').test(value)
    } catch {
      return false
    }
  }
  if (expr.startsWith('=')) return value === expr.slice(1)
  return value.toLowerCase().includes(expr.toLowerCase())
}

/** 信封是否命中规则:启用 + when(源.类型)对上 + where 全过(AND)。 */
export function matchRule(env: Envelope, rule: Rule): boolean {
  if (!rule.enabled) return false
  const { source, type } = parseWhen(rule.when)
  if (env.source !== source) return false
  if (type && type !== '*' && env.type !== type) return false
  for (const [path, expr] of Object.entries(rule.where ?? {})) {
    const v = fieldByPath(env, path)
    if (!matchExpr(v == null ? '' : String(v), expr)) return false
  }
  return true
}

/** `{field}` / `{data.x}` / `{today}` / `{tomorrow}` 占位替换(未知→空串)。用于 notify + exec 命令串。 */
export function renderTemplate(tpl: string, env: Envelope): string {
  return tpl.replace(/\{([\w.]+)\}/g, (_, k: string) => {
    const v = fieldByPath(env, k)
    return v == null ? '' : String(v)
  })
}

/** 信封 → exec 的环境变量:顶层 JOVIDA_SOURCE/TYPE/TITLE/ID/AT + data 各键 JOVIDA_<KEY> + JOVIDA_DATA(整块 JSON)。 */
export function envToEnvVars(env: Envelope): Record<string, string> {
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const out: Record<string, string> = {
    JOVIDA_SOURCE: env.source,
    JOVIDA_TYPE: env.type,
    JOVIDA_TITLE: env.title ?? '',
    JOVIDA_ID: env.id ?? '',
    JOVIDA_AT: env.at ? String(env.at) : '',
    JOVIDA_TODAY: ymd(now), // 便利:安全地在 exec 里用 --when "$JOVIDA_TODAY"
    JOVIDA_TOMORROW: ymd(tomorrow)
  }
  for (const [k, v] of Object.entries(env.data ?? {})) {
    if (v == null) continue
    out[`JOVIDA_${k.toUpperCase()}`] = typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
  out.JOVIDA_DATA = JSON.stringify(env.data ?? {})
  return out
}

// ── 推送事件 spool:emit 原子写(tmp+rename,防守护读到半截),守护取走即删(FIFO) ──
export function writeEvent(env: Envelope): string {
  ensureEventsDir()
  const e: Envelope = { at: Math.floor(Date.now() / 1000), ...env } // 缺 at 则补;显式 at 覆盖
  const id = ulid()
  const tmp = join(EVENTS_DIR, `.${id}.json.tmp`)
  const dst = join(EVENTS_DIR, `${id}.json`)
  writeFileSync(tmp, JSON.stringify(e), { mode: 0o600 })
  renameSync(tmp, dst) // 同目录原子改名
  return dst
}
/** 取走并删除所有已落盘的推送事件(按文件名≈时间序 FIFO)。坏文件跳过。 */
export function drainEvents(): Envelope[] {
  let files: string[]
  try {
    files = readdirSync(EVENTS_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
  } catch {
    return []
  }
  const out: Envelope[] = []
  for (const f of files) {
    const p = join(EVENTS_DIR, f)
    try {
      const env = JSON.parse(readFileSync(p, 'utf8')) as Envelope
      if (env && typeof env.source === 'string' && typeof env.type === 'string') out.push(env)
    } catch {
      /* 坏文件:跳过 */
    }
    try {
      rmSync(p)
    } catch {
      /* 删不掉也无妨 */
    }
  }
  return out
}
