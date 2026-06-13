#!/usr/bin/env node
import { makeCtx } from './ctx'
import { cmdCreate } from './commands/create'
import { cmdList } from './commands/list'
import { cmdView } from './commands/view'
import { cmdUpdate } from './commands/update'
import { cmdComplete } from './commands/complete'
import { cmdReopen } from './commands/reopen'
import { cmdDelete } from './commands/delete'
import { cmdLogin } from './commands/login'
import { cmdWhoami } from './commands/whoami'
import { cmdSkill } from './commands/skill'
import { NotFoundError } from './commands/shared'
import { NotSignedInError } from './session'
import { ApiError } from './api'
import { clearCredentials } from './state'
import { maybeNotifyUpdate } from './lib/update-check'

const VERSION: string = require('../package.json').version

// 可重复的值 flag（收集成数组）。其余值 flag 取最后一次,无值则布尔 true。
const REPEATABLE = new Set(['remind', 'subtask'])

interface Parsed {
  positionals: string[]
  flags: Record<string, string | string[] | boolean>
}

function parse(argv: string[]): Parsed {
  const positionals: string[] = []
  const flags: Record<string, string | string[] | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true
      } else {
        i++
        if (REPEATABLE.has(key)) {
          const cur = (flags[key] as string[] | undefined) ?? []
          cur.push(next)
          flags[key] = cur
        } else {
          flags[key] = next
        }
      }
    } else {
      positionals.push(a)
    }
  }
  return { positionals, flags }
}

const str = (v: string | string[] | boolean | undefined): string | undefined =>
  typeof v === 'string' ? v : undefined
const arr = (v: string | string[] | boolean | undefined): string[] | undefined =>
  Array.isArray(v) ? v : typeof v === 'string' ? [v] : undefined
const num = (v: string | string[] | boolean | undefined): number | undefined =>
  typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined

const HELP = `Jovida Daily CLI

Usage:
  jovida login [--json]                # device authorization: open the URL, enter the code, approve
  jovida login --token <vita-token>    # dev-only interim: paste a signed-in vita token
  jovida logout
  jovida whoami [--json]
  jovida skill install                 # copy the bundled skill into detected agents (Codex/Claude)

  jovida create "<title>" [--when <ISO>] [--priority none|low|medium|high]
                          [--remind <ISO> ...] [--category <s>] [--desc <s>]
                          [--subtask <title> ...] [--hint <s>] [--json]
            recurring:    [--repeat day|week|month|year] [--every N] [--weekdays mon,wed,fri]
                          [--day-of-month N] [--month-of-year N] [--until YYYY-MM-DD]
                          (--repeat requires --when as the first occurrence)
  jovida list  [--scope today|upcoming|recent|range|all] [--status pending|completed|all]
               [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit N] [--full] [--json]
  jovida view <entry_id> [--json]
  jovida update <entry_id> [--title ...] [--when ...] [--priority ...] [--remind ...] [...]
  jovida complete <entry_id> [<entry_id> ...] [--json]
  jovida reopen <entry_id> [<entry_id> ...] [--json]
  jovida delete <entry_id> [<entry_id> ...] [--json]

Output: JSON is emitted automatically when stdout is not a TTY (use --json/--no-json to force).
Exit:   0 ok · 1 usage · 2 not signed in · 3 backend/network · 4 not found
Env:    JOVIDA_API_URL=<url> (default https://tapi.jovida.ai) · JOVIDA_HOME=<dir> (default ~/.jovida)
        JOVIDA_NO_UPDATE_CHECK=1 to silence the "update available" notice

Run \`jovida <command> --help\` for details on a command (e.g. jovida create --help).
`

// 子命令详细 help(`jovida <cmd> --help` / `jovida help <cmd>`)。
const COMMAND_HELP: Record<string, string> = {
  create: `jovida create — add a todo (or a recurring series)

Usage:
  jovida create "<title>" [options]

Options:
  --when <ISO>           date "2026-06-15" = that day · datetime "2026-06-15T18:00:00+08:00" = deadline
  --priority <p>         none | low | medium | high
  --category <s>         free-text label
  --desc <s>             description (single line)
  --remind <ISO> ...     reminder time(s), repeatable; must be at/before --when
  --subtask "<t>" ...    subtask(s), repeatable
  --hint <s>             short companion hint
  --json

Recurring (creates a series; requires --when as the first occurrence):
  --repeat <unit>        day | week | month | year
  --every <N>            interval, e.g. --repeat week --every 2 = biweekly
  --weekdays <list>      weekly: mon,wed,fri (or 1..7)
  --day-of-month <N>     monthly/yearly
  --month-of-year <N>    yearly
  --until <YYYY-MM-DD>   end date

Examples:
  jovida create "submit report" --when 2026-06-20T18:00:00+08:00 --priority high
  jovida create "standup" --when 2026-06-15 --repeat week --weekdays mon,wed,fri
`,
  list: `jovida list — list todos (a scoped view, not a search)

Usage:
  jovida list [options]

Options:
  --scope <s>    today (default) | upcoming | recent | range | all
  --status <s>   pending (default) | completed | all
  --from <YYYY-MM-DD>  range start (with --scope range)
  --to <YYYY-MM-DD>    range end
  --limit <N>    max items (default 20)
  --full         JSON: include all fields (description, subtasks, reminders) — one round-trip instead of list + view
  --json

Examples:
  jovida list
  jovida list --scope all --status all
  jovida list --scope range --from 2026-06-01 --to 2026-06-30
  jovida list --full          # full detail of each todo in one call
`,
  view: `jovida view — full details of one todo

Usage:
  jovida view <entry_id> [--json]
`,
  update: `jovida update — change fields of an existing todo (only the given fields change)

Usage:
  jovida update <entry_id> [options]

Options (same as create; --title renames):
  --title <s>  --when <ISO>  --priority <p>  --category <s>  --desc <s>
  --remind <ISO> ...   (replaces the reminder list)
  --subtask "<t>" ...  (replaces the subtask list)
  --hint <s>  --json

Example:
  jovida update cli_01H... --priority high --when 2026-06-21T09:00:00+08:00
`,
  complete: `jovida complete — mark one or more todos done

Usage:
  jovida complete <entry_id> [<entry_id> ...] [--json]
`,
  reopen: `jovida reopen — reopen one or more completed todos (the inverse of complete)

Usage:
  jovida reopen <entry_id> [<entry_id> ...] [--json]
`,
  delete: `jovida delete — permanently remove one or more todos (no undo)

Usage:
  jovida delete <entry_id> [<entry_id> ...] [--json]
`,
  login: `jovida login — sign in (OAuth device authorization; opens a browser)

Usage:
  jovida login [--json]
  jovida login --token <vita-token>   # dev-only interim: paste a signed-in vita token

The CLI prints a URL + short code and (best-effort) opens your browser; sign in
and approve there. It cannot sign in for you.
`,
  logout: `jovida logout — clear local credentials (~/.jovida)
`,
  whoami: `jovida whoami — show the signed-in account (online check)

Usage:
  jovida whoami [--json]
`,
  skill: `jovida skill — install/update the agent skill from the bundled SKILL.md

Usage:
  jovida skill install         # copy SKILL.md into detected agents (~/.codex, ~/.claude → skills/jovida-cli/)
  jovida skill update          # same (re-copy; keeps the skill in lockstep with the CLI version)
  jovida skill install --all   # install for all known agents even if not detected
`
}

/** 错误 → 退出码(0 ok / 1 用法 / 2 未登录 / 3 后端 / 4 not found)。 */
function exitCodeFor(e: unknown): number {
  if (e instanceof NotSignedInError) return 2
  if (e instanceof NotFoundError) return 4
  if (e instanceof ApiError) return 3
  return 1
}
function errCode(e: unknown): string {
  if (e instanceof NotSignedInError) return 'NOT_SIGNED_IN'
  if (e instanceof NotFoundError) return 'NOT_FOUND'
  if (e instanceof ApiError) return 'BACKEND'
  return 'USAGE'
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2)
  const { positionals, flags } = parse(rest)

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    const topic = positionals[0] // `jovida help <command>`
    console.log(topic && COMMAND_HELP[topic] ? COMMAND_HELP[topic] : HELP)
    return
  }
  if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
    console.log(VERSION)
    return
  }
  // `jovida <command> --help` / `-h` → that command's detailed help.
  if (flags.help === true || rest.includes('--help') || rest.includes('-h')) {
    console.log(COMMAND_HELP[cmd] ?? HELP)
    return
  }

  // JSON 输出:非 TTY 自动开;--json / --no-json 强制。
  const json = flags.json === true ? true : flags['no-json'] === true ? false : !process.stdout.isTTY

  const ctx = makeCtx()

  switch (cmd) {
    case 'login':
      await cmdLogin(ctx, { token: str(flags.token), json })
      break
    case 'logout':
      clearCredentials()
      console.log(json ? JSON.stringify({ status: 'signed_out' }) : '✓ signed out')
      break
    case 'whoami':
      await cmdWhoami(ctx, { json })
      break
    case 'skill':
      cmdSkill(positionals[0], { all: flags.all === true, json })
      break
    case 'create':
      await cmdCreate(ctx, {
        title: positionals.join(' ').trim(),
        when: str(flags.when),
        priority: str(flags.priority),
        category: str(flags.category),
        desc: str(flags.desc),
        remind: arr(flags.remind),
        subtask: arr(flags.subtask),
        hint: str(flags.hint),
        repeat: str(flags.repeat),
        every: num(flags.every),
        weekdays: str(flags.weekdays),
        dayOfMonth: num(flags['day-of-month']),
        monthOfYear: num(flags['month-of-year']),
        until: str(flags.until),
        json
      })
      break
    case 'list':
      await cmdList(ctx, {
        scope: str(flags.scope),
        status: str(flags.status),
        from: str(flags.from),
        to: str(flags.to),
        limit: num(flags.limit),
        full: flags.full === true,
        json
      })
      break
    case 'view':
      await cmdView(ctx, { id: positionals[0], json })
      break
    case 'update':
      await cmdUpdate(ctx, {
        id: positionals[0],
        title: str(flags.title),
        when: str(flags.when),
        priority: str(flags.priority),
        category: str(flags.category),
        desc: str(flags.desc),
        remind: arr(flags.remind),
        subtask: arr(flags.subtask),
        hint: str(flags.hint),
        json
      })
      break
    case 'complete':
      await cmdComplete(ctx, { ids: positionals, json })
      break
    case 'reopen':
      await cmdReopen(ctx, { ids: positionals, json })
      break
    case 'delete':
      await cmdDelete(ctx, { ids: positionals, json })
      break
    default:
      console.error(`unknown command: ${cmd}\n`)
      console.log(HELP)
      process.exitCode = 1
  }

  await maybeNotifyUpdate(VERSION) // 节流 + 仅 TTY + 永不抛;放最后,不影响命令输出/退出码
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e)
  const reason = e instanceof ApiError ? e.reason : undefined
  // JSON 错误走 stderr(成功 JSON 走 stdout)。非 TTY 时也用 JSON。
  if (!process.stdout.isTTY) {
    process.stderr.write(JSON.stringify({ error: { code: errCode(e), message: msg, ...(reason ? { reason } : {}) } }) + '\n')
  } else {
    process.stderr.write(`jovida: ${msg}\n`)
  }
  process.exitCode = exitCodeFor(e)
})
