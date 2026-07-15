#!/usr/bin/env node
import { makeCtx } from './ctx'
import { cmdCreate } from './commands/create'
import { cmdList } from './commands/list'
import { cmdDue } from './commands/due'
import { cmdWatch } from './commands/watch'
import { cmdDaemon } from './commands/daemon'
import { cmdImport } from './commands/import'
import { cmdView } from './commands/view'
import { cmdUpdate } from './commands/update'
import { cmdComplete } from './commands/complete'
import { cmdReopen } from './commands/reopen'
import { cmdSubtask } from './commands/subtask'
import { cmdDelete } from './commands/delete'
import { cmdLogin } from './commands/login'
import { cmdWhoami } from './commands/whoami'
import { cmdSkill } from './commands/skill'
import { NotFoundError } from './commands/shared'
import { NotSignedInError, LoginError } from './session'
import { ApiError } from './api'
import { clearCredentials } from './state'
import { clearStore } from './store'
import { maybeNotifyUpdate } from './lib/update-check'

const VERSION: string = require('../package.json').version

// 可重复的值 flag（收集成数组）。其余值 flag 取最后一次。
const REPEATABLE = new Set(['remind', 'subtask', 'agent'])
// 合法的无值(布尔)flag。其余 flag 缺值 = 用法错(防 `--remind`(漏值)被静默当 true→丢弃)。
const BOOLEAN_FLAGS = new Set([
  'json',
  'no-json',
  'full',
  'all',
  'help',
  'brief',
  'fresh',
  'ansi',
  'link', // 无值 = 默认 jovida.ai;也可 --link <url>
  'dry-run',
  'clear-when',
  'clear-remind',
  'clear-category',
  'clear-desc',
  'clear-subtasks',
  'clear-hint',
  'clear-until'
])

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
        // 无值:布尔 flag 置 true;值 flag 缺值则报错(不再静默丢弃)。
        if (!BOOLEAN_FLAGS.has(key)) throw new Error(`--${key} needs a value`)
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
  jovida login [--json]                # device authorization: open browser, auto-poll until approved
  jovida login --token <vita-token>    # dev-only interim: paste a signed-in vita token
  jovida logout
  jovida whoami [--json]
  jovida skill install [--agent <name>]   # copy the bundled skill into agents (all detected, or one; see: jovida help skill)
  jovida skill show                       # print the bundled skill to stdout (for agents that install skills their own way)

  jovida create "<title>" [--when <ISO>] [--priority none|low|medium|high]
                          [--remind <ISO> ...] [--category <s>] [--desc <s>]
                          [--subtask <title> ...] [--hint <s>] [--json]
            repeating:    [--repeat day|week|month|year] [--every N] [--weekdays mon,wed,fri]
                          [--day-of-month N] [--month-of-year N] [--until YYYY-MM-DD]
                          (--repeat needs --when as the first date)
  jovida list  [--scope today|upcoming|recent|range|all] [--status pending|completed|all]
               [--query <text>] [--category <s>] [--priority <p>]
               [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit N] [--full] [--fresh] [--json]
  jovida due   [--within 2h|90m|1d] [--brief] [--fresh] [--json]
               # overdue + due-soon radar (statusline / agent-hook friendly; cached)
  jovida watch [--json]
               # stream todo changes in real time (push over SSE; not polling)
  jovida daemon start|stop|status|restart [--json]
               # background watcher: keeps the statusline cache live + fires desktop notifications
  jovida import lark [--category <s>] [--dry-run] [--json]
               # one-way import of your incomplete Lark/Feishu tasks (idempotent, re-runnable)
  jovida view <entry_id|recurring_id> [--fresh] [--json]
  jovida update <entry_id|recurring_id> [--title ...] [--when ...] [--remind ...] [...]
                          (recurring_id: also --repeat/--every/--weekdays/--until to change the repeat rule)
  jovida complete <entry_id> [<entry_id> ...] [--json]
  jovida reopen <entry_id> [<entry_id> ...] [--json]
  jovida subtask check|uncheck|add|rm <entry_id> <id|index ...> [--json]
  jovida delete <entry_id> [<entry_id> ...] [--json]

Output: JSON is emitted automatically when stdout is not a TTY (use --json/--no-json to force).
Exit:   0 ok · 1 usage · 2 not signed in · 3 backend/network · 4 not found
Env:    JOVIDA_API_URL=<url> (default https://tapi.jovida.ai) · JOVIDA_HOME=<dir> (default ~/.jovida/cli)
        JOVIDA_NO_UPDATE_CHECK=1 to silence the "update available" notice

Run \`jovida <command> --help\` for details on a command (e.g. jovida create --help).
`

// 子命令详细 help(`jovida <cmd> --help` / `jovida help <cmd>`)。
const COMMAND_HELP: Record<string, string> = {
  create: `jovida create — add a todo (or a repeating todo)

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

Repeating (makes it a repeating todo; needs --when as the first date):
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
  list: `jovida list — list, search, and filter todos

Usage:
  jovida list [options]

Options:
  --scope <s>    today (default) | upcoming | recent | range | all
  --status <s>   pending (default) | completed | all
  --query <text> case-insensitive substring on title + description
  --category <s> exact category match
  --priority <p> none | low | medium | high
  --from <YYYY-MM-DD>  range start (with --scope range)
  --to <YYYY-MM-DD>    range end
  --limit <N>    max items (default 20)
  --full         JSON: include all fields (description, subtasks, reminders) — one round-trip instead of list + view
  --fresh        bypass the local snapshot store and pull now (reads are served from a local
                 copy, revalidated by a cheap version probe when older than 300s)
  --json

Output carries "total" and "has_more" so you can tell when results were truncated by --limit.
When --query/--category/--priority is given, scope and status default to "all" (search spans everything).

Repeating todos appear as dated occurrences flagged with "recurring_id":
  --scope range --from/--to lists every occurrence in the window; today/upcoming show each routine's next one.

Examples:
  jovida list
  jovida list --query dentist                 # find todos mentioning "dentist"
  jovida list --category work --priority high
  jovida list --scope range --from 2026-06-01 --to 2026-06-30
  jovida list --full          # full detail of each todo in one call
`,
  due: `jovida due — overdue + due-soon radar (built for statuslines and agent hooks)

Usage:
  jovida due [options]

Shows pending todos that are overdue, plus those whose deadline or reminder falls
within the window (default 24h). Repeating todos contribute their occurrences.
A date-only todo counts as due by the end of its day.

Options:
  --within <dur>   window: 90m | 2h | 1d | a plain number = hours (default 24h)
  --brief          one line for statuslines/hooks: "🐰 2 overdue · 14:00 pay rent +1"
                   prints NOTHING when nothing is due; never fails (errors → silent, exit 0)
  --ansi           with --brief: layered colors for statuslines (overdue red, time yellow,
                   title dimmed). Keep it OFF for prompt hooks — context should be plain text.
  --link [url]     with --brief: wrap the line in an OSC 8 hyperlink so terminals that
                   support it (iTerm2, WezTerm, Kitty, Ghostty; Claude Code passes it
                   through) make the segment Cmd+clickable. Default target: jovida.ai.
  --fresh          bypass the snapshot cache and pull now
  --ttl <secs>     snapshot cache TTL (default 60). An expired cache is revalidated with a
                   cheap version probe first — a full re-pull happens only when data actually
                   changed. Any write through the CLI invalidates the cache immediately.
  --json           {overdue, upcoming, counts, within_secs, cache_age_secs}

Wire it into Claude Code (or any TUI agent):
  statusline  — append \`jovida due --brief --ansi --link\` to your status line command
  hook        — UserPromptSubmit hook running \`jovida due --brief\`: when something is
                due its one-liner is injected as context, so the agent reminds you in-chat
  Set JOVIDA_TIMEOUT_MS (e.g. 5000) in those commands so a bad network can't stall the TUI.
`,
  watch: `jovida watch — stream todo changes in real time (push, not polling)

Usage:
  jovida watch [--json]

Subscribes to a live push channel over SSE (the general msghub ingress) and, whenever your
todos change on the server (from any device or the agent), pulls the new snapshot and prints
what changed. This is notify-then-pull: the push is a tiny signal; the diff is computed locally
against the last snapshot, so no change is ever missed (a reconnect re-reconciles).

Output:
  --json / non-TTY   one JSON object per line (JSONL): {event, entry_id|recurring_id, title, ...}
                     event ∈ added | updated | completed | reopened | deleted
  TTY                a human-readable line per change

Runs until Ctrl-C. Reconnects automatically (the connection is read-only; it never blocks on
the network). Pipe it to an agent or a script:  jovida watch --json | your-tool

Env: JOVIDA_API_URL (same backend as other commands). Requires \`jovida login\`.
`,
  daemon: `jovida daemon — background watcher: live statusline cache + desktop notifications

Usage:
  jovida daemon start      # detach a background watcher (subscribes to the push channel)
  jovida daemon stop       # stop it
  jovida daemon status     # is it running? connected? how many due? [--json]
  jovida daemon restart
  jovida daemon run        # run in the foreground (what 'start' detaches; use for debugging)

One long-lived process turns the CLI from "pull" into "watch". On every change it:
  1. refreshes the local snapshot and writes the rendered due-radar line (ansi + plain
     variants) to statusline.json — your statusline just cats it: zero node spawn, always
     current. Wire it up (falls back to \`jovida due --brief\` when the daemon is off):
        cache=~/.jovida/cli/statusline.json
        if [ -f "$cache" ]; then jq -r '.ansi' "$cache"; else jovida due --brief --ansi --link; fi
  2. fires a native macOS notification (osascript, no dependency) for changes worth a nudge:
     a new todo (from the agent or another device), a reminder coming due, a todo crossing
     into overdue, or a completion/deletion from another device.

Reminders and overdue-crossings aren't server pushes (no data changes) — the daemon holds the
full snapshot, so it schedules local timers and rings on its own. Reconnects automatically;
a reconnect re-reconciles so nothing is missed. Logs to ~/.jovida/cli/daemon.log.

Needs a backend with the SSE ingress (\`/jov/msghub/v1/sse\`). Requires \`jovida login\`.
`,
  import: `jovida import — one-way import from an external source (currently: Lark/Feishu tasks)

Usage:
  jovida import lark [--category <s>] [--dry-run] [--json]

Reads your INCOMPLETE Lark "my tasks" via the official lark-cli and imports them
as Jovida todos. Prerequisites:
  npm i -g @larksuite/cli && lark-cli auth login --domain task

Idempotent and re-runnable — safe to run on a schedule:
  - each Lark task maps to a deterministic id (lark_<guid>): re-runs never duplicate
  - new tasks are created; changed title/description/due are updated
    (fields you edit in Jovida that the import doesn't own — priority, reminders,
     subtasks, category — are preserved)
  - a previously imported task later completed in Lark is completed in Jovida too
  - tasks deleted in Lark are kept in Jovida (reported as "orphaned")
  - one-way: nothing is ever written back to Lark

Mapping: summary first line → title (other lines + Lark description + back-link → description);
all-day due → date-only todo; timed due → exact deadline; no due → undated.

Options:
  --category <s>   grouping label for newly created todos (default 飞书)
  --dry-run        show what would happen without writing
  --json
`,
  view: `jovida view — full details of one todo, a repeating todo, or one occurrence

Usage:
  jovida view <entry_id | recurring_id | occurrence_id> [--fresh] [--json]

Given a repeating todo's recurring_id, shows its repeat rule.
Given an occurrence id (from list, "recurring:…"), shows that occurrence with its rule.
Served from the local snapshot store (revalidated by a version probe); --fresh forces a pull.
`,
  update: `jovida update — change fields of a todo, a repeating todo, or one occurrence (only the given fields change)

Usage:
  jovida update <entry_id | recurring_id | occurrence_id> [options]

Options (same as create; --title renames):
  --title <s>  --when <ISO>  --priority <p>  --category <s>  --desc <s>
  --remind <ISO> ...   (replaces the reminder list)
  --subtask "<t>" ...  (replaces the subtask list)
  --hint <s>  --json

Clear a field (unset it; passing a value only sets/replaces, never clears):
  --clear-when      (also drops reminders — a reminder needs a time)
  --clear-remind  --clear-category  --clear-desc  --clear-subtasks  --clear-hint
  --clear-until     (repeating todo only: remove the end date / make it endless)
  (a --clear-X can't be combined with the matching --X)

For a repeating todo (recurring_id), you can also change its repeat rule:
  --repeat <unit>  --every <N>  --weekdays <list>  --day-of-month <N>  --month-of-year <N>  --until <YYYY-MM-DD>
  (only the parts you pass change; switching --repeat unit drops parts that no longer apply)

Given an occurrence id (from list, "recurring:…"), this edits just that one occurrence (it
materializes it; the routine and other occurrences are unchanged). You can't change the repeat
rule from an occurrence — edit the recurring_id for that.

Examples:
  jovida update cli_01H... --priority high --when 2026-06-21T09:00:00+08:00
  jovida update cli_01J... --weekdays mon,fri      # recurring_id: change which weekdays it repeats
  jovida update cli_01J... --until 2026-12-31      # recurring_id: set an end date / stop future occurrences
  jovida update recurring:cli_01J...:1781452800 --title "moved" --when 2026-06-15T14:00:00+08:00   # tweak one occurrence
`,
  complete: `jovida complete — mark one or more todos done

Usage:
  jovida complete <entry_id> [<entry_id> ...] [--json]

An id may be a repeating todo's occurrence id (from list, "recurring:…"): completing it
ticks off just that date (materializes the occurrence); the routine keeps running.
`,
  reopen: `jovida reopen — reopen one or more completed todos (the inverse of complete)

Usage:
  jovida reopen <entry_id> [<entry_id> ...] [--json]
`,
  subtask: `jovida subtask — check / uncheck / add / remove a todo's subtasks

Usage:
  jovida subtask check   <entry_id> <id|index ...>   # mark subtask(s) done
  jovida subtask uncheck <entry_id> <id|index ...>   # mark not done
  jovida subtask add     <entry_id> "<title>"        # append a subtask
  jovida subtask rm      <entry_id> <id|index ...>   # remove subtask(s)

Address a subtask by its id (shown in \`jovida view <entry_id>\`) or its 1-based number there.
`,
  delete: `jovida delete — permanently remove one or more todos (no undo)

Usage:
  jovida delete <entry_id> [<entry_id> ...] [--json]

To stop a repeating todo, delete its recurring_id. A single occurrence cannot be deleted.
`,
  login: `jovida login — sign in (OAuth device authorization; opens a browser)

Usage:
  jovida login [--json]               # open browser, auto-poll until approved, then return
  jovida login --token <vita-token>   # dev-only interim: paste a signed-in vita token

The CLI prints a URL + short code and (best-effort) opens your browser; sign in
and approve there. It auto-polls and finishes once you approve — nothing else to run.
`,
  logout: `jovida logout — clear local credentials (~/.jovida/cli)

Local only — it removes the stored token from this machine; it does not revoke the
session server-side.
`,
  whoami: `jovida whoami — show the signed-in account (online check)

Usage:
  jovida whoami [--json]
`,
  skill: `jovida skill — install/update the agent skill from the bundled SKILL.md

Supported agents: codex, claude, gemini, cursor, windsurf, continue, opencode,
                  goose, qwen, crush, kilocode, aider, copilot (→ <dir>/skills/jovida-cli/SKILL.md)

Usage:
  jovida skill install                   # copy SKILL.md into ALL detected agents
  jovida skill install --agent codex     # install for one agent only (repeatable / comma-separated)
  jovida skill update                    # same as install (re-copy; keeps the skill in lockstep with the CLI version)
  jovida skill install --all             # install for all known agents even if not detected
  jovida skill show                      # print SKILL.md to stdout

If your agent isn't in the list above (e.g. a platform / cloud / sandbox agent that loads
skills its own way), don't rely on 'install' — run 'jovida skill show' and put the output
wherever your agent reads skills from (you know your own convention):
  jovida skill show > <your-skill-dir>/jovida-cli/SKILL.md
`
}

/** 错误 → 退出码(0 ok / 1 用法 / 2 未登录 / 3 后端 / 4 not found)。 */
function exitCodeFor(e: unknown): number {
  if (e instanceof NotSignedInError) return 2
  if (e instanceof NotFoundError) return 4
  if (e instanceof ApiError) return 3
  if (e instanceof LoginError) return 3 // 登录超时/过期/被拒 = 瞬时态,重试登录
  return 1
}
function errCode(e: unknown): string {
  if (e instanceof NotSignedInError) return 'NOT_SIGNED_IN'
  if (e instanceof NotFoundError) return 'NOT_FOUND'
  if (e instanceof ApiError) return 'BACKEND'
  if (e instanceof LoginError) return 'LOGIN_FAILED'
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
      clearStore() // 退出后不留上一账号的待办快照
      console.log(json ? JSON.stringify({ status: 'signed_out' }) : '✓ signed out')
      break
    case 'whoami':
      await cmdWhoami(ctx, { json })
      break
    case 'skill':
      cmdSkill(positionals[0], { all: flags.all === true, agents: arr(flags.agent), json })
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
        query: str(flags.query),
        category: str(flags.category),
        priority: str(flags.priority),
        full: flags.full === true,
        fresh: flags.fresh === true,
        json
      })
      break
    case 'due':
      await cmdDue(ctx, {
        within: str(flags.within),
        ttl: num(flags.ttl),
        brief: flags.brief === true,
        ansi: flags.ansi === true,
        link: flags.link === true ? true : str(flags.link),
        fresh: flags.fresh === true,
        json
      })
      break
    case 'watch':
      await cmdWatch(ctx, { json })
      break
    case 'daemon':
      await cmdDaemon(ctx, { action: positionals[0], json })
      break
    case 'import':
      await cmdImport(ctx, {
        source: positionals[0],
        category: str(flags.category),
        dryRun: flags['dry-run'] === true,
        json
      })
      break
    case 'view':
      await cmdView(ctx, { id: positionals[0], fresh: flags.fresh === true, json })
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
        repeat: str(flags.repeat),
        every: num(flags.every),
        weekdays: str(flags.weekdays),
        dayOfMonth: num(flags['day-of-month']),
        monthOfYear: num(flags['month-of-year']),
        until: str(flags.until),
        clearWhen: flags['clear-when'] === true,
        clearRemind: flags['clear-remind'] === true,
        clearCategory: flags['clear-category'] === true,
        clearDesc: flags['clear-desc'] === true,
        clearSubtasks: flags['clear-subtasks'] === true,
        clearHint: flags['clear-hint'] === true,
        clearUntil: flags['clear-until'] === true,
        json
      })
      break
    case 'complete':
      await cmdComplete(ctx, { ids: positionals, json })
      break
    case 'reopen':
      await cmdReopen(ctx, { ids: positionals, json })
      break
    case 'subtask':
      await cmdSubtask(ctx, { action: positionals[0], entryId: positionals[1], rest: positionals.slice(2), json })
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
