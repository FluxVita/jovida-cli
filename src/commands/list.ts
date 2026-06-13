import { toListItem, toFullTodo, belongDateToSec } from '../core/convert'
import type { TodoEntry } from '../core/types'
import type { Ctx } from '../ctx'

const DAY = 86400
function startOfTodaySec(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return Math.floor(d.getTime() / 1000)
}
/** scope/排序锚:有 due 用 due,否则 belong。 */
function anchorSec(e: TodoEntry): number {
  return e.dueAt > 0 ? e.dueAt : e.belongAt
}

function fmtWhen(e: TodoEntry): string {
  if (e.dueAt > 0) return new Date(e.dueAt * 1000).toLocaleString()
  if (e.belongAt > 0) return new Date(e.belongAt * 1000).toLocaleDateString()
  return ''
}
function fmtLine(e: TodoEntry): string {
  const box = e.completedAt > 0 ? '[x]' : '[ ]'
  const when = fmtWhen(e)
  const bell = e.reminder && e.reminder.offsetSecs.length ? ' 🔔' : ''
  const pr = e.priority !== 'none' ? `  !${e.priority}` : ''
  return `${box} ${e.title}${when ? `  · ${when}` : ''}${bell}${pr}  (${e.entryId})`
}

export interface ListArgs {
  scope?: string // today | upcoming | recent | range | all
  status?: string // pending | completed | all
  from?: string
  to?: string
  limit?: number
  full?: boolean // JSON 输出带全字段(description/subtasks/remind_at…),省去 list→view 第二次 pull
  json?: boolean
}

export async function cmdList(ctx: Ctx, a: ListArgs): Promise<void> {
  const scope = a.scope ?? 'today'
  const status = a.status ?? 'pending'
  await ctx.session.ensureSession()
  const snap = await ctx.sync.pull()
  let items = snap.entries

  // status 过滤
  items = items.filter((e) =>
    status === 'all' ? true : status === 'completed' ? e.completedAt > 0 : e.completedAt === 0
  )

  // scope 过滤（客户端,后端无 scoped 查询）
  const todayStart = startOfTodaySec()
  const tomorrowStart = todayStart + DAY
  if (scope === 'today') {
    items = items.filter((e) => anchorSec(e) > 0 && anchorSec(e) < tomorrowStart) // 今天及更早(含逾期)
  } else if (scope === 'upcoming') {
    items = items.filter((e) => anchorSec(e) >= tomorrowStart)
  } else if (scope === 'range') {
    const f = a.from ? belongDateToSec(a.from) : 0
    const t = a.to ? belongDateToSec(a.to) + DAY : Number.POSITIVE_INFINITY
    items = items.filter((e) => anchorSec(e) >= f && anchorSec(e) < t)
  } // 'all' / 'recent' 不按日期过滤

  // 排序
  if (scope === 'recent') items.sort((x, y) => y.updatedAt - x.updatedAt)
  else items.sort((x, y) => (anchorSec(x) || Number.POSITIVE_INFINITY) - (anchorSec(y) || Number.POSITIVE_INFINITY))

  items = items.slice(0, a.limit ?? 20)

  if (a.json) {
    const todos = a.full ? items.map((e) => toFullTodo(e)) : items.map(toListItem)
    console.log(JSON.stringify({ todos }, null, 2))
    return
  }
  if (!items.length) {
    console.log('(no todos)')
    return
  }
  for (const e of items) console.log(fmtLine(e))
}
