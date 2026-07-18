// jovida due — 到期雷达:逾期 + 窗口内临期(含提醒触发)。为 statusline / agent hook 高频轮询而生:
// 快照走本地 TTL 缓存(默认 60s,写路径成功即失效);--brief 单行输出、任何错误静默退 0(状态栏不容脏字)。
import { computeDue, type DueItem } from '../core/due'
import { renderBrief, fmtClock, fmtNext, DAY } from '../core/brief'
import { toListItem, secToIso, secToBelongDate } from '../core/convert'
import { loadSnapshot } from '../snapshot'
import type { Ctx } from '../ctx'

const DEFAULT_TTL = 60
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

// ---- 展示 ----(单行渲染与时间短格式在 ../core/brief,与守护共用一套)
function itemJson(it: DueItem): Record<string, unknown> {
  return {
    ...toListItem(it.entry),
    due_at: it.entry.dueAt > 0 ? secToIso(it.entry.dueAt) : secToBelongDate(it.anchorAt - DAY), // 纯日期待办给归属日
    next_at: secToIso(it.nextAt),
    next_is_reminder: it.nextIsReminder || undefined
  }
}

async function run(ctx: Ctx, a: DueArgs): Promise<void> {
  const withinSecs = parseWithin(a.within)
  // due 走更短的默认 TTL(60s):statusline/hook 高频轮询要更接近实时;读命令默认 300s。
  const ttl = a.ttl !== undefined && a.ttl >= 0 ? a.ttl : DEFAULT_TTL
  const { snap, ageSecs } = await loadSnapshot(ctx, { ttlSecs: ttl, fresh: a.fresh === true })
  const nowSec = Math.floor(Date.now() / 1000)
  const r = computeDue({
    entries: snap.entries,
    recurrings: snap.recurrings,
    nowSec,
    withinSecs,
    todayStart: startOfTodaySec()
  })

  if (a.brief) {
    // 单行(statusline/hook):无事输出空。渲染在 core/brief.renderBrief,与守护写进缓存的那行同源。
    const line = renderBrief(r, nowSec, { ansi: a.ansi, link: a.link })
    if (line) console.log(line)
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
