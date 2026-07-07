// jovida due — 到期雷达:逾期 + 窗口内临期(含提醒触发)。为 statusline / agent hook 高频轮询而生:
// 快照走本地 TTL 缓存(默认 60s,写路径成功即失效);--brief 单行输出、任何错误静默退 0(状态栏不容脏字)。
import { computeDue, type DueItem } from '../core/due'
import { toListItem, secToIso, secToBelongDate } from '../core/convert'
import { readSnapshotCache, writeSnapshotCache } from '../state'
import type { Ctx } from '../ctx'
import type { Snapshot } from '../sync'

const DAY = 86400
const DEFAULT_TTL = 60
const BRIEF_TITLE_COLS = 24 // 标题截断上限,按**显示列宽**(CJK 每字 2 列),不是字符数
const LIST_CAP = 20 // json/human 列表上限(计数仍为全量)

export interface DueArgs {
  within?: string // 窗口:90m | 2h | 1d | 纯数字=小时;默认 24h
  ttl?: number // 缓存 TTL 秒;默认 60
  fresh?: boolean // 跳过缓存强制拉取
  brief?: boolean // 单行输出(statusline/hook);无事输出空、出错静默
  ansi?: boolean // 仅配合 --brief:自带分层配色(overdue 红/时间黄/标题 dim),给 statusline 用
  link?: string | boolean // 仅配合 --brief:OSC 8 超链接包裹整行(true=jovida.ai;或给自定义 URL)
  json?: boolean
}

function parseWithin(s: string | undefined): number {
  if (s === undefined) return 24 * 3600
  const m = /^(\d+)\s*([mhd])?$/i.exec(s.trim())
  if (!m || Number(m[1]) <= 0) throw new Error('--within must be like 90m, 2h, 1d, or a number of hours')
  const n = Number(m[1])
  const unit = (m[2] ?? 'h').toLowerCase()
  return n * (unit === 'm' ? 60 : unit === 'h' ? 3600 : DAY)
}

function startOfTodaySec(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return Math.floor(d.getTime() / 1000)
}

// ---- 展示 ----
function sameLocalDay(sec: number, refSec: number): boolean {
  const a = new Date(sec * 1000)
  const b = new Date(refSec * 1000)
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
function fmtClock(sec: number, nowSec: number): string {
  const d = new Date(sec * 1000)
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  return sameLocalDay(sec, nowSec) ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}
/** 到期/提醒时刻的短格式。纯日期待办(锚=归属日结束)显示成「哪天内」而非午夜时刻。 */
function fmtNext(it: DueItem, nowSec: number): string {
  if (it.nextIsReminder || it.entry.dueAt > 0) return fmtClock(it.nextAt, nowSec)
  const belongSec = it.anchorAt - DAY // 锚 = belong+1天
  if (sameLocalDay(belongSec, nowSec)) return 'today'
  const d = new Date(belongSec * 1000)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
// 按终端显示宽度截断:CJK/全角(≥U+2E80)占 2 列,否则 1 列。按字符数截会让中文标题铺满状态栏。
function truncateCols(s: string, cols: number): string {
  let w = 0
  let out = ''
  for (const ch of s) {
    const cw = (ch.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1
    if (w + cw > cols - 1) return `${out}…`
    out += ch
    w += cw
  }
  return s
}

// --ansi 时给 statusline 分层上色;纯 --brief(hook 注入上下文)保持素文本。
const paint = (ansi: boolean | undefined, code: string, s: string): string =>
  ansi ? `\u001b[${code}m${s}\u001b[0m` : s

// --link:OSC 8 超链接(终端标准;iTerm2/WezTerm/Kitty/Ghostty 等支持 Cmd+点击,
// Claude Code statusline 实测透传)。不支持的终端按未知序列忽略,只是不可点。
const DEFAULT_LINK = 'https://jovida.ai'
const OSC = '\u001b]8;;'
const ST = '\u001b\\'
const hyperlink = (url: string, s: string): string => `${OSC}${url}${ST}${s}${OSC}${ST}`

function itemJson(it: DueItem): Record<string, unknown> {
  return {
    ...toListItem(it.entry),
    due_at: it.entry.dueAt > 0 ? secToIso(it.entry.dueAt) : secToBelongDate(it.anchorAt - DAY), // 纯日期待办给归属日
    next_at: secToIso(it.nextAt),
    next_is_reminder: it.nextIsReminder || undefined
  }
}

async function loadSnapshot(ctx: Ctx, ttlSecs: number, fresh: boolean): Promise<{ snap: Snapshot; ageSecs: number }> {
  const cached = fresh ? null : readSnapshotCache<Snapshot>()
  if (cached && cached.ageSecs <= ttlSecs) return { snap: cached.payload, ageSecs: cached.ageSecs }
  await ctx.session.ensureSession()
  if (cached) {
    // 缓存过期:先花一个 get_todo_version(极小请求)探测,版本没变就原地续期——
    // 绝大多数轮次数据没动,把「全量快照」降成「一个版本号」。
    try {
      if ((await ctx.sync.getServerVersion()) === cached.payload.serverVersion) {
        writeSnapshotCache(cached.payload) // 重盖时间戳
        return { snap: cached.payload, ageSecs: 0 }
      }
    } catch {
      /* 探测失败(网络抖动等)→ 落回全量拉取,该抛的错由它抛 */
    }
  }
  return { snap: await ctx.sync.pull(), ageSecs: 0 } // pull 内部会刷新缓存
}

async function run(ctx: Ctx, a: DueArgs): Promise<void> {
  const withinSecs = parseWithin(a.within)
  const ttl = a.ttl !== undefined && a.ttl >= 0 ? a.ttl : DEFAULT_TTL
  const { snap, ageSecs } = await loadSnapshot(ctx, ttl, a.fresh === true)
  const nowSec = Math.floor(Date.now() / 1000)
  const r = computeDue({
    entries: snap.entries,
    recurrings: snap.recurrings,
    nowSec,
    withinSecs,
    todayStart: startOfTodaySec()
  })

  if (a.brief) {
    // 单行:`🐰 N overdue · HH:MM 标题 +M`;无事输出空(statusline/hook 均以空为「不显示/不注入」)。
    // 配色策略(--ansi):红=overdue(唯一的警报色),黄=时间(扫一眼抓的重点),dim=标题/计数(弱化)。
    const parts: string[] = []
    if (r.overdue.length) parts.push(paint(a.ansi, '31', `${r.overdue.length} overdue`))
    if (r.upcoming.length) {
      const first = r.upcoming[0]
      const more = r.upcoming.length - 1
      const bell = first.nextIsReminder ? '🔔 ' : ''
      const title = truncateCols(first.entry.title, BRIEF_TITLE_COLS) + (more > 0 ? ` +${more}` : '')
      parts.push(`${paint(a.ansi, '33', fmtNext(first, nowSec))} ${bell}${paint(a.ansi, '2', title)}`)
    }
    if (parts.length) {
      let line = `🐰 ${parts.join(' · ')}` // 🐰 = Jovida 的兔子,statusline 里的品牌记号
      if (a.link) line = hyperlink(typeof a.link === 'string' ? a.link : DEFAULT_LINK, line)
      console.log(line)
    }
    return
  }

  if (a.json) {
    console.log(
      JSON.stringify(
        {
          overdue: r.overdue.slice(0, LIST_CAP).map(itemJson),
          upcoming: r.upcoming.slice(0, LIST_CAP).map(itemJson),
          counts: { overdue: r.overdue.length, upcoming: r.upcoming.length },
          within_secs: withinSecs,
          cache_age_secs: ageSecs
        },
        null,
        2
      )
    )
    return
  }

  if (!r.overdue.length && !r.upcoming.length) {
    console.log(`(nothing due within ${a.within ?? '24h'})`)
    return
  }
  if (r.overdue.length) {
    console.log(`Overdue (${r.overdue.length}):`)
    for (const it of r.overdue.slice(0, LIST_CAP)) {
      console.log(`  ⚠ ${it.entry.title}  · ${fmtClock(it.anchorAt, nowSec)}  (${it.entry.entryId})`)
    }
    if (r.overdue.length > LIST_CAP) console.log(`  … ${r.overdue.length - LIST_CAP} more`)
  }
  if (r.upcoming.length) {
    console.log(`Due within ${a.within ?? '24h'} (${r.upcoming.length}):`)
    for (const it of r.upcoming.slice(0, LIST_CAP)) {
      const bell = it.nextIsReminder ? ' 🔔' : ''
      console.log(`  ⏰ ${fmtNext(it, nowSec)}${bell} ${it.entry.title}  (${it.entry.entryId})`)
    }
    if (r.upcoming.length > LIST_CAP) console.log(`  … ${r.upcoming.length - LIST_CAP} more`)
  }
}

export async function cmdDue(ctx: Ctx, a: DueArgs): Promise<void> {
  if (a.brief) {
    // statusline/hook 场景:未登录/断网/超时一律静默退 0——宁可这回合不显示,也不把错误字符串糊进状态栏。
    try {
      await run(ctx, a)
    } catch {
      /* 静默 */
    }
    return
  }
  await run(ctx, a)
}
