// 规则引擎（有状态）——嵌入守护:每个信封(内置 todo 变更/时刻,或 emit 推送来的)都过一遍规则,
// 命中就依次执行 do 里的动作。全程 best-effort:任何单条规则/动作失败绝不影响守护主循环。
// 动作两种(MVP):exec(sh -c,信封 JSON 走 stdin + JOVIDA_* 环境变量,30s 超时)、notify(品牌化桌面通知,
// title/message/subtitle 支持 {占位} 模板)。
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, execFile, type ExecFileException } from 'node:child_process'
import {
  RULES_FILE,
  loadRules,
  matchRule,
  renderTemplate,
  envToEnvVars,
  buildCreateArgv,
  buildCompleteArgv,
  type Rule,
  type Envelope,
  type NotifySpec
} from './core/rules'
import { notify } from './notify'

// 本 CLI 自身的入口(dist/cli.js,与 dist/rules.js 同级)。create/complete 动作即跑它,复用登录/建待办/缓存失效全套。
const CLI_PATH = join(__dirname, 'cli.js')

const EXEC_TIMEOUT_MS = 30_000 // 单条 exec 动作最长 30s,超时杀掉(防卡死级联)
const START_RETRIES = 2 // 动作**启动失败**(进程压根没跑起来,无副作用)才重试;非 0 退出/超时不重试(可能已产生副作用,重试会重复建待办等)
const RETRY_BACKOFF_MS = 1000

// ── rules.json mtime 缓存:高频事件不必每次读盘,文件变了才重载 ──
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
    cached = []
    cachedMtimeMs = -1
  }
  return cached
}

// ── 每规则冷却 ──
const lastFired = new Map<string, number>()
const nowSec = (): number => Math.floor(Date.now() / 1000)

/**
 * exec 动作:sh -c 跑命令,信封 JSON 喂 stdin,JOVIDA_* 注入环境;超时杀掉;输出记日志。
 * 刻意**不**把 {占位} 插进命令串——待办标题/提交信息等可含引号或 `;`,插值即 shell 注入。
 * 数据一律走环境变量($JOVIDA_TITLE 等)+ stdin(整条信封 JSON)。{占位} 模板只给 notify(不碰 shell)。
 */
function runExec(rule: Rule, cmd: string, env: Envelope, log: (m: string) => void, attempt = 0): void {
  const retryStart = (why: string): void => {
    if (attempt < START_RETRIES) {
      const t = setTimeout(() => runExec(rule, cmd, env, log, attempt + 1), RETRY_BACKOFF_MS * (attempt + 1))
      if (t.unref) t.unref()
      log(`rule ${rule.id} exec start failed (${why}); retrying (${attempt + 1}/${START_RETRIES})`)
    } else {
      log(`rule ${rule.id} exec start failed (${why}); gave up after ${START_RETRIES} retries`)
    }
  }
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...envToEnvVars(env) }
  let child
  try {
    child = spawn('sh', ['-c', cmd], { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (e) {
    retryStart((e as Error).message) // 同步抛=没跑起来,可安全重试
    return
  }
  let settled = false // 'error' 与 'close' 去重(启动失败时可能都触发)
  const killer = setTimeout(() => {
    try {
      child.kill('SIGKILL')
    } catch {
      /* 已退出 */
    }
    log(`rule ${rule.id} exec timed out (${EXEC_TIMEOUT_MS}ms), killed`) // 超时**不**重试(可能已有副作用)
  }, EXEC_TIMEOUT_MS)
  if (killer.unref) killer.unref()

  let out = ''
  child.stdout?.on('data', (d) => (out += String(d)))
  child.stderr?.on('data', (d) => (out += String(d)))
  child.on('error', (e) => {
    if (settled) return
    settled = true
    clearTimeout(killer)
    retryStart(e.message) // 异步启动失败(ENOENT/EAGAIN 等):进程没跑,可安全重试
  })
  child.on('close', (code) => {
    if (settled) return
    settled = true
    clearTimeout(killer)
    const tail = out.trim().slice(0, 500)
    log(`rule ${rule.id} exec done (exit ${code ?? '?'})${tail ? ': ' + tail : ''}`) // 跑完(哪怕非 0)=不重试
  })
  try {
    child.stdin?.end(JSON.stringify(env) + '\n')
  } catch {
    /* stdin 关了也无妨 */
  }
}

/**
 * create/complete 动作:跑本 CLI(`node cli.js <argv…>`)。**execFile 数组传参、非 shell**,故渲染后的
 * 标题/分类含引号或 `;` 也安全(不像 exec 那样是注入面)。子进程继承 JOVIDA_HOME+token,复用建待办/完成全套。
 */
function runCli(rule: Rule, argv: string[], log: (m: string) => void, attempt = 0): void {
  execFile(process.execPath, [CLI_PATH, ...argv], { env: process.env, timeout: EXEC_TIMEOUT_MS }, (err, stdout, stderr) => {
    const tail = ((stdout || '') + (stderr || '')).trim().slice(0, 300)
    if (!err) {
      log(`rule ${rule.id} ${argv[0]} ok${tail ? ': ' + tail : ''}`)
      return
    }
    const e = err as ExecFileException
    // 只重试**启动失败**(code 是字符串 errno 如 ENOENT/EAGAIN,且非超时 kill);非 0 退出(code 是数字)/超时=可能已写入,不重试(免重复建待办)。
    const startFailed = typeof e.code === 'string' && !e.killed
    if (startFailed && attempt < START_RETRIES) {
      const t = setTimeout(() => runCli(rule, argv, log, attempt + 1), RETRY_BACKOFF_MS * (attempt + 1))
      if (t.unref) t.unref()
      log(`rule ${rule.id} ${argv[0]} start failed (${e.code}); retrying (${attempt + 1}/${START_RETRIES})`)
      return
    }
    log(`rule ${rule.id} ${argv[0]} failed: ${err.message}${tail ? ' — ' + tail : ''}`)
  })
}

/** notify 动作:模板渲染后弹品牌化桌面通知(缺省 title="源 · 类型"、message=标题)。 */
function runNotify(spec: NotifySpec, env: Envelope): void {
  const title = spec.title ? renderTemplate(spec.title, env) : `Jovida · ${env.source}.${env.type}`
  const message = spec.message ? renderTemplate(spec.message, env) : env.title ?? ''
  const subtitle = spec.subtitle ? renderTemplate(spec.subtitle, env) : undefined
  notify({ title, message, ...(subtitle ? { subtitle } : {}) })
}

/** 执行一条命中规则的所有动作。best-effort,吞一切异常。 */
function fireRule(rule: Rule, env: Envelope, log: (m: string) => void): void {
  for (const a of rule.do) {
    try {
      if ('exec' in a) runExec(rule, a.exec, env, log)
      else if ('notify' in a) runNotify(a.notify, env)
      else if ('create' in a) runCli(rule, buildCreateArgv(a.create, env), log)
      else if ('complete' in a) runCli(rule, buildCompleteArgv(a.complete, env), log)
    } catch (e) {
      log(`rule ${rule.id} action failed: ${(e as Error).message}`)
    }
  }
}

/**
 * 守护对每个信封调用:载入(缓存)规则,逐条 when/where 匹配 + 冷却把关,命中即触发。
 * 纯 best-effort——绝不抛(整段包 try/catch),不阻塞主循环。
 */
export function runRules(env: Envelope, log: (m: string) => void): void {
  try {
    const rules = getRules()
    if (rules.length === 0) return
    const now = nowSec()
    for (const rule of rules) {
      if (!matchRule(env, rule)) continue
      if (rule.cooldown_sec && rule.cooldown_sec > 0) {
        const last = lastFired.get(rule.id) ?? 0
        if (now - last < rule.cooldown_sec) continue
      }
      lastFired.set(rule.id, now)
      log(`rule ${rule.id}${rule.name ? ' (' + rule.name + ')' : ''} matched ${env.source}.${env.type}: ${env.title ?? ''}`)
      fireRule(rule, env, log)
    }
  } catch (e) {
    log(`runRules failed: ${(e as Error).message}`)
  }
}

/** 守护 status 用:当前启用中的规则条数(读缓存)。 */
export function activeRuleCount(): number {
  return getRules().filter((r) => r.enabled).length
}
