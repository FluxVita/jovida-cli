import { toListItem, toFullTodo, belongDateToSec } from '../core/convert'
import type { Priority, TodoEntry } from '../core/types'
import type { Ctx } from '../ctx'

const PRIORITIES: Priority[] = ['none', 'low', 'medium', 'high']

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
  query?: string // 标题+描述子串(不区分大小写)
  category?: string // 精确匹配分组标签
  priority?: string // none|low|medium|high
  full?: boolean // JSON 输出带全字段(description/subtasks/remind_at…),省去 list→view 第二次 pull
  json?: boolean
}

export async function cmdList(ctx: Ctx, a: ListArgs): Promise<void> {
  if (a.priority && !PRIORITIES.includes(a.priority as Priority)) {
    throw new Error(`--priority must be one of: ${PRIORITIES.join(', ')}`)
  }
  // 带 query/category/priority 过滤时,默认放开 scope/status 到 all——「找」应跨全部,而非默认局限今天/pending。
  const hasFilter = !!(a.query || a.category || a.priority)
  const scope = a.scope ?? (hasFilter ? 'all' : 'today')
  const status = a.status ?? (hasFilter ? 'all' : 'pending')
  const limit = a.limit ?? 20

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

  // 内容过滤(query/category/priority)
  if (a.query) {
    const q = a.query.toLowerCase()
    items = items.filter((e) => e.title.toLowerCase().includes(q) || e.description.toLowerCase().includes(q))
  }
  if (a.category) items = items.filter((e) => e.category === a.category)
  if (a.priority) items = items.filter((e) => e.priority === (a.priority as Priority))

  // 排序
  if (scope === 'recent') items.sort((x, y) => y.updatedAt - x.updatedAt)
  else items.sort((x, y) => (anchorSec(x) || Number.POSITIVE_INFINITY) - (anchorSec(y) || Number.POSITIVE_INFINITY))

  const total = items.length // 过滤后、截断前的总数
  const shown = items.slice(0, limit)
  const hasMore = total > shown.length

  if (a.json) {
    const todos = a.full ? shown.map((e) => toFullTodo(e)) : shown.map(toListItem)
    console.log(JSON.stringify({ todos, total, has_more: hasMore }, null, 2))
    return
  }
  if (!shown.length) {
    console.log('(no todos)')
    return
  }
  for (const e of shown) console.log(fmtLine(e))
  if (hasMore) console.log(`… ${total - shown.length} more (showing ${shown.length}/${total}; use --limit N, narrow with --query/--category/--scope)`)
}
