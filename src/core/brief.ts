// 「到期雷达」的单行渲染 + 时间短格式。抽出来给 `jovida due --brief` 与守护(daemon)复用,
// 保证 statusline 那行字**逐字节一致**(不管谁写进缓存)。纯展示,不触网不读状态。
import type { DueItem, DueReport } from './due'

export const DAY = 86400
const BRIEF_TITLE_COLS = 24 // 标题截断上限,按**显示列宽**(CJK 每字 2 列),不是字符数

function sameLocalDay(sec: number, refSec: number): boolean {
  const a = new Date(sec * 1000)
  const b = new Date(refSec * 1000)
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function fmtClock(sec: number, nowSec: number): string {
  const d = new Date(sec * 1000)
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  return sameLocalDay(sec, nowSec) ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

/** 到期/提醒时刻的短格式。纯日期待办(锚=归属日结束)显示成「哪天内」而非午夜时刻。 */
export function fmtNext(it: DueItem, nowSec: number): string {
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

// ansi 时给 statusline 分层上色;纯文本(hook 注入上下文)保持素文本。
const paint = (ansi: boolean | undefined, code: string, s: string): string =>
  ansi ? `\u001b[${code}m${s}\u001b[0m` : s

// link:OSC 8 超链接(终端标准;iTerm2/WezTerm/Kitty/Ghostty 等支持 Cmd+点击,
// Claude Code statusline 实测透传)。不支持的终端按未知序列忽略,只是不可点。
const DEFAULT_LINK = 'https://jovida.ai'
const OSC = '\u001b]8;;'
const ST = '\u001b\\'
const hyperlink = (url: string, s: string): string => `${OSC}${url}${ST}${s}${OSC}${ST}`

export interface BriefOpts {
  ansi?: boolean // 分层配色(overdue 红/时间黄/标题 dim),给 statusline 用
  link?: string | boolean // OSC 8 超链接包裹整行(true=jovida.ai;或自定义 URL)
}

/**
 * 单行到期雷达:`🐰 N overdue · HH:MM 标题 +M`。无事返回空串(statusline/hook 均以空为「不显示」)。
 * 配色策略(ansi):红=overdue(唯一警报色),黄=时间(扫一眼抓的重点),dim=标题/计数(弱化)。
 */
export function renderBrief(r: DueReport, nowSec: number, opts: BriefOpts = {}): string {
  const { ansi, link } = opts
  const parts: string[] = []
  if (r.overdue.length) parts.push(paint(ansi, '31', `${r.overdue.length} overdue`))
  if (r.upcoming.length) {
    const first = r.upcoming[0]
    const more = r.upcoming.length - 1
    const bell = first.nextIsReminder ? '🔔 ' : ''
    const title = truncateCols(first.entry.title, BRIEF_TITLE_COLS) + (more > 0 ? ` +${more}` : '')
    parts.push(`${paint(ansi, '33', fmtNext(first, nowSec))} ${bell}${paint(ansi, '2', title)}`)
  }
  if (!parts.length) return ''
  let line = `🐰 ${parts.join(' · ')}` // 🐰 = Jovida 的兔子,statusline 里的品牌记号
  if (link) line = hyperlink(typeof link === 'string' ? link : DEFAULT_LINK, line)
  return line
}
