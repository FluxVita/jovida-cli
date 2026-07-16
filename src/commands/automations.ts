// jovida automations — 触发系统的「主屏」:一眼看全部源(内置 todo / emit 推送 / poll / stream)+ 规则 + pack + 守护态。
// 纯读:把散在 rules/poll/stream/pack 四个 list 里的东西聚合成一屏,便于纵览与排查。
import { loadRules, type Rule, type Action } from '../core/rules'
import { loadPolls } from '../core/poll'
import { loadStreams } from '../core/stream'
import { listPacks, readPack } from '../core/pack'
import { statusDaemon } from '../daemon'

export interface AutomationsArgs {
  json?: boolean
}

function fmtInterval(sec: number): string {
  if (sec % 3600 === 0) return `${sec / 3600}h`
  if (sec % 60 === 0) return `${sec / 60}m`
  return `${sec}s`
}

function actionLabel(act: Action): string {
  if ('exec' in act) return `exec ${act.exec}`
  if ('create' in act) return `create "${act.create.title}"`
  if ('complete' in act) return `complete ${act.complete.id}`
  return `notify ${act.notify.title ?? '(default)'}`
}
function ruleLine(r: Rule): string {
  const flag = r.enabled ? '●' : '○'
  const where = r.where
    ? ' [' +
      Object.entries(r.where)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ') +
      ']'
    : ''
  const acts = r.do.map(actionLabel).join(', ')
  return `  ${flag} ${r.when}${where} → ${acts}${r.name ? `   (${r.name})` : ''}`
}

export function cmdAutomations(a: AutomationsArgs): void {
  const rules = loadRules()
  const polls = loadPolls()
  const streams = loadStreams()
  const packNames = listPacks()
  const { running, status } = statusDaemon()

  if (a.json === true) {
    console.log(
      JSON.stringify({
        daemon: { running, connected: status?.connected ?? false, pid: status?.pid },
        sources: { todo: 'built-in', push: "via 'jovida emit'", polls, streams },
        rules,
        packs: packNames
      })
    )
    return
  }

  const d = running && status ? `● ${status.connected ? 'running, connected' : 'running, disconnected'} · pid ${status.pid}` : '○ off (start: jovida daemon start)'
  console.log(`Automations · daemon ${d}\n`)

  console.log('Sources')
  console.log("  todo     built-in (todo.added/completed/reopened/deleted/reminder/overdue)")
  console.log("  push     via 'jovida emit <source> <type>'")
  if (polls.length === 0) console.log('  poll     (none — jovida poll add …)')
  else for (const p of polls) console.log(`  poll   ${p.enabled ? '●' : '○'} ${p.source}.${p.type}  every ${fmtInterval(p.interval_sec)}${p.name ? `   (${p.name})` : ''}`)
  if (streams.length === 0) console.log('  stream   (none — jovida stream add …)')
  else for (const s of streams) console.log(`  stream ${s.enabled ? '●' : '○'} ${s.source ?? '*'}.${s.type ?? '*'}${s.name ? `   (${s.name})` : ''}`)

  console.log(`\nRules (${rules.length})`)
  if (rules.length === 0) console.log('  (none — jovida rules add …)')
  else for (const r of rules) console.log(ruleLine(r))

  console.log(`\nPacks (${packNames.length})`)
  if (packNames.length === 0) console.log('  (none — jovida pack save --name … --all)')
  else
    for (const n of packNames) {
      try {
        const b = readPack(n)
        const c = { r: b.rules?.length ?? 0, p: b.polls?.length ?? 0, s: b.streams?.length ?? 0 }
        console.log(`  ${n} — ${c.r} rule(s), ${c.p} poll(s), ${c.s} stream(s)${b.description ? '  · ' + b.description : ''}`)
      } catch {
        console.log(`  ${n} (unreadable)`)
      }
    }
}
