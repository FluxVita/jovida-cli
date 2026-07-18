// jovida poll — poll 源的管理面(list/add/rm/enable/disable/test)。
// poll 是触发器协议里的一种**源**:定时跑 check 命令,exit 0=条件成立,在 false→true 上升沿发一条 <source>.<type> 信封。
// 真正的定时跑 + 边沿判定在守护里(嵌入运行体,见 ../poll.ts);这里只增删查改 polls.json + 单次 check 预览。
import { spawnSync } from 'node:child_process'
import {
  loadPolls,
  savePolls,
  newPollId,
  parseInterval,
  validatePollSpec,
  buildPollEnvelope,
  POLLS_FILE,
  type PollSource
} from '../core/poll'

export interface PollArgs {
  action?: string // list | add | rm | enable | disable | test | spec
  positionals: string[] // poll id(rm/enable/disable/test)
  spec?: string // add: 整条 poll JSON(agent 友好)
  dryRun?: boolean // add: 只校验+预览,不落盘
  name?: string
  source?: string
  type?: string
  check?: string
  interval?: string // 30s | 5m | 1h | 纯数字=秒
  title?: string
  disabled?: boolean
  json?: boolean
}

function fmtInterval(sec: number): string {
  if (sec % 3600 === 0) return `${sec / 3600}h`
  if (sec % 60 === 0) return `${sec / 60}m`
  return `${sec}s`
}

function pollSummary(p: PollSource): string {
  const flag = p.enabled ? '●' : '○'
  return `${flag} ${p.id}${p.name ? '  ' + p.name : ''}\n    emit ${p.source}.${p.type} every ${fmtInterval(p.interval_sec)} on rising edge of:\n    check: ${p.check}`
}

function findPoll(polls: PollSource[], id: string): PollSource {
  const p = polls.find((x) => x.id === id || x.id.endsWith(id))
  if (!p) throw new Error(`no poll matching id: ${id}`)
  return p
}

export function cmdPoll(a: PollArgs): void {
  const action = a.action ?? 'list'
  const json = a.json === true

  switch (action) {
    case 'list': {
      const polls = loadPolls()
      if (json) {
        console.log(JSON.stringify({ polls, file: POLLS_FILE }))
        return
      }
      if (polls.length === 0) {
        console.log(
          `no poll sources yet. add one:\n  jovida poll add --source weather --type rain --check 'curl -sf ... | grep -qi rain' --interval 30m\nthen react with a rule:\n  jovida rules add --when weather.rain --exec 'jovida create "带伞☔️" --when "$JOVIDA_TODAY"'\n(file: ${POLLS_FILE})`
        )
        return
      }
      for (const p of polls) console.log(pollSummary(p))
      return
    }

    case 'add': {
      // 两种入口:--spec 传整条 poll JSON(agent 友好),或拼 flag(人友好)。
      let poll: PollSource
      if (a.spec) {
        poll = validatePollSpec(a.spec)
        if (a.disabled) poll.enabled = false
      } else {
        if (!a.source || !a.type) throw new Error('add needs --source and --type (or --spec <poll-json>)')
        if (!a.check) throw new Error('add needs --check <sh -c command> (exit 0 = condition true)')
        if (!a.interval) throw new Error('add needs --interval <30s|5m|1h|seconds>')
        poll = {
          id: newPollId(),
          name: a.name,
          source: a.source,
          type: a.type,
          check: a.check,
          interval_sec: parseInterval(a.interval),
          title: a.title,
          enabled: a.disabled !== true
        }
      }
      if (a.dryRun) {
        if (json) console.log(JSON.stringify({ valid: true, dryRun: true, poll }))
        else console.log(`✓ valid (dry-run, not saved)\n${pollSummary(poll)}`)
        return
      }
      const polls = loadPolls()
      polls.push(poll)
      savePolls(polls)
      if (json) console.log(JSON.stringify({ added: poll }))
      else
        console.log(
          `✓ added poll ${poll.id}\n${pollSummary(poll)}\n(the running daemon picks it up within seconds; react to ${poll.source}.${poll.type} with 'jovida rules add')`
        )
      return
    }

    case 'rm': {
      const id = a.positionals[0]
      if (!id) throw new Error('rm needs a poll id (see: jovida poll list)')
      const polls = loadPolls()
      const p = findPoll(polls, id)
      savePolls(polls.filter((x) => x.id !== p.id))
      if (json) console.log(JSON.stringify({ removed: p.id }))
      else console.log(`✓ removed poll ${p.id}`)
      return
    }

    case 'enable':
    case 'disable': {
      const id = a.positionals[0]
      if (!id) throw new Error(`${action} needs a poll id (see: jovida poll list)`)
      const polls = loadPolls()
      const p = findPoll(polls, id)
      p.enabled = action === 'enable'
      savePolls(polls)
      if (json) console.log(JSON.stringify({ [action + 'd']: p.id, enabled: p.enabled }))
      else console.log(`✓ ${action}d poll ${p.id}`)
      return
    }

    case 'test': {
      // 单次跑 check(不落状态、不管边沿),报条件成立与否 + 上升沿会发的信封。用于撰写自检。
      let poll: PollSource
      if (a.spec) poll = validatePollSpec(a.spec)
      else if (a.positionals[0]) poll = findPoll(loadPolls(), a.positionals[0])
      else if (a.check && a.source && a.type)
        poll = { id: 'pol_test', name: a.name, source: a.source, type: a.type, check: a.check, interval_sec: a.interval ? parseInterval(a.interval) : 60, title: a.title, enabled: true }
      else throw new Error('test needs a poll id, or --source/--type/--check, or --spec <json>')

      const r = spawnSync('sh', ['-c', poll.check], { encoding: 'utf8', timeout: 30_000 })
      const code = r.status
      const output = ((r.stdout ?? '') + (r.stderr ?? '')).trim()
      const condition = code === 0
      const envelope = condition ? buildPollEnvelope(poll, output, Math.floor(Date.now() / 1000)) : null
      if (json) {
        console.log(JSON.stringify({ check: poll.check, exit: code, condition, output, wouldEmit: envelope }))
        return
      }
      console.log(`check: ${poll.check}`)
      console.log(`→ exit ${code ?? '?'} → condition ${condition ? 'TRUE' : 'false'}${output ? '  output=' + JSON.stringify(output.slice(0, 200)) : ''}`)
      if (condition) console.log(`→ on a rising edge would emit: ${envelope?.source}.${envelope?.type}  title="${envelope?.title ?? ''}"`)
      else console.log('→ condition false → no envelope (fires only when it flips false→true)')
      return
    }

    case 'spec': {
      const spec = {
        what: 'a poll source: run "check" every interval; exit 0 = condition true; emit <source>.<type> on the false→true rising edge only',
        poll: {
          source: 'string — envelope namespace, e.g. "weather"',
          type: 'string — event kind, e.g. "rain"',
          check: 'string — sh -c command; exit 0 = condition true, non-zero = false; its stdout → envelope data.output',
          interval: '"30s" | "5m" | "1h" | number-of-seconds (or interval_sec: number)',
          title: 'string? — envelope title (defaults to check stdout first line / source name)',
          name: 'string?',
          enabled: 'boolean (default true)'
        },
        semantics: 'edge-triggered: emits once when the condition flips false→true, not repeatedly while true; state persists across daemon restarts (a restart mid-condition does NOT re-fire)',
        emits: 'envelope { source, type, title, id: <poll id>, at, data:{ output, poll_id, poll } } — react with a rule: jovida rules add --when <source>.<type> …',
        apply: "jovida poll add --spec '<poll-json>' [--dry-run]"
      }
      console.log(json ? JSON.stringify(spec) : JSON.stringify(spec, null, 2))
      return
    }

    default:
      throw new Error(`unknown poll action: ${action} (use list|add|rm|enable|disable|test|spec)`)
  }
}
