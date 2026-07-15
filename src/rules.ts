// 规则引擎（有状态）——嵌入守护：每个变更事件 / 本地时刻都过一遍规则，命中就执行动作。
// 全程 best-effort：任何单条规则/动作失败绝不影响守护主循环。动作两种（MVP）：
//   exec   —— sh -c 跑用户命令，事件 JSON 走 stdin + JOVIDA_* 环境变量，带超时；
//   notify —— 复用 notify.ts 的品牌化桌面通知，title/message/subtitle 支持 {占位} 模板。
import { statSync } from 'node:fs'
import { spawn } from 'node:child_process'
import {
  RULES_FILE,
  loadRules,
  matchRule,
  eventContext,
  renderTemplate,
  type Rule,
  type RuleEvent
} from './core/rules'
import { notify } from './notify'

const EXEC_TIMEOUT_MS = 30_000 // 单条 exec 动作最长跑 30s，超时杀掉（防卡死守护级联）

// ---- rules.json mtime 缓存：守护里高频事件不必每次读盘,文件变了才重载 ----
let cached: Rule[] = []
let cachedMtimeMs = -1
function getRules(): Rule[] {
  try {
    const mtime = statSync(RULES_FILE).mtimeMs
    if (mtime !== cachedMtimeMs) {
      cached = loadRules()
      cachedMtimeMs = mtime
    }
  } catch {
    // 文件不存在/读不到 → 视为空表(并让下次文件出现时能重载)
    cached = []
    cachedMtimeMs = -1
  }
  return cached
}

// ---- 每规则冷却:上次触发的秒时间戳 ----
const lastFired = new Map<string, number>()
const nowSec = (): number => Math.floor(Date.now() / 1000)

/** exec 动作:sh -c 跑,事件 JSON 喂 stdin,JOVIDA_* 注入环境;超时杀掉;输出记日志。 */
function runExec(rule: Rule, ev: RuleEvent, log: (m: string) => void): void {
  const ctx = eventContext(ev)
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const [k, v] of Object.entries(ctx)) env[`JOVIDA_${k.toUpperCase()}`] = v
  let child
  try {
    child = spawn('sh', ['-c', rule.exec as string], { env, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (e) {
    log(`rule ${rule.id} exec spawn failed: ${(e as Error).message}`)
    return
  }
  const killer = setTimeout(() => {
    try {
      child.kill('SIGKILL')
    } catch {
      /* 已退出 */
    }
    log(`rule ${rule.id} exec timed out (${EXEC_TIMEOUT_MS}ms), killed`)
  }, EXEC_TIMEOUT_MS)
  if (killer.unref) killer.unref()

  let out = ''
  child.stdout?.on('data', (d) => (out += String(d)))
  child.stderr?.on('data', (d) => (out += String(d)))
  child.on('error', (e) => {
    clearTimeout(killer)
    log(`rule ${rule.id} exec error: ${e.message}`)
  })
  child.on('close', (code) => {
    clearTimeout(killer)
    const tail = out.trim().slice(0, 500)
    log(`rule ${rule.id} exec done (exit ${code ?? '?'})${tail ? ': ' + tail : ''}`)
  })
  try {
    child.stdin?.end(JSON.stringify({ event: ev.kind, ...ev.todo }) + '\n')
  } catch {
    /* stdin 关了也无妨 */
  }
}

/** notify 动作:模板渲染后弹品牌化桌面通知(缺省 title=事件、message=待办标题)。 */
function runNotify(rule: Rule, ev: RuleEvent): void {
  const ctx = eventContext(ev)
  const n = rule.notify as NonNullable<Rule['notify']>
  const title = n.title ? renderTemplate(n.title, ctx) : `Jovida · ${ctx.event}`
  const message = n.message ? renderTemplate(n.message, ctx) : ctx.title
  const subtitle = n.subtitle ? renderTemplate(n.subtitle, ctx) : undefined
  notify({ title, message, ...(subtitle ? { subtitle } : {}) })
}

/** 执行一条命中的规则(两种动作都配则都跑)。best-effort,吞一切异常。 */
function fireRule(rule: Rule, ev: RuleEvent, log: (m: string) => void): void {
  try {
    if (rule.notify) runNotify(rule, ev)
    if (rule.exec) runExec(rule, ev, log)
  } catch (e) {
    log(`rule ${rule.id} fire failed: ${(e as Error).message}`)
  }
}

/**
 * 守护对每个事件调用:载入(缓存)规则,逐条匹配 + 冷却把关,命中即触发。
 * 纯 best-effort——绝不抛(整段包 try/catch),不阻塞主循环。
 */
export function runRules(ev: RuleEvent, log: (m: string) => void): void {
  try {
    const rules = getRules()
    if (rules.length === 0) return
    const now = nowSec()
    for (const rule of rules) {
      if (!matchRule(ev, rule)) continue
      if (rule.cooldown_sec && rule.cooldown_sec > 0) {
        const last = lastFired.get(rule.id) ?? 0
        if (now - last < rule.cooldown_sec) continue
      }
      lastFired.set(rule.id, now)
      log(`rule ${rule.id}${rule.name ? ' (' + rule.name + ')' : ''} matched ${ev.kind}: ${String(ev.todo.title ?? '')}`)
      fireRule(rule, ev, log)
    }
  } catch (e) {
    log(`runRules failed: ${(e as Error).message}`)
  }
}

/** 守护 status 用:当前启用中的规则条数(读缓存)。 */
export function activeRuleCount(): number {
  return getRules().filter((r) => r.enabled).length
}
