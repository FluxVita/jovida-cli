// jovida emit <source> <type> — 把一条事件信封推进引擎(spool 目录),守护取走后匹配规则。
// 这是「任何东西都能当源」的通用入口:Claude Code hook / cron / 任意脚本调它即成为一个事件源。
// 幂等·零耦合:守护不在也不报错,信封在 spool 里排队,守护起来后一并处理(原子落盘,不会读到半截)。
import { writeEvent, type Envelope } from '../core/rules'

export interface EmitArgs {
  source?: string
  type?: string
  title?: string
  id?: string
  data?: string // JSON 载荷
  json?: boolean
}

export function cmdEmit(a: EmitArgs): void {
  if (!a.source || !a.type)
    throw new Error('usage: jovida emit <source> <type> [--title <s>] [--id <s>] [--data <json>]')
  let data: Record<string, unknown> | undefined
  if (a.data) {
    try {
      data = JSON.parse(a.data) as Record<string, unknown>
    } catch {
      throw new Error(`--data must be valid JSON: ${a.data}`)
    }
  }
  const env: Envelope = { source: a.source, type: a.type, title: a.title, id: a.id, data }
  const file = writeEvent(env)
  if (a.json) console.log(JSON.stringify({ status: 'emitted', envelope: env, file }))
  else console.log(`✓ emitted ${a.source}.${a.type}${a.title ? ' — ' + a.title : ''}`)
}
