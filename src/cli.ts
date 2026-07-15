#!/usr/bin/env node
import { makeCtx } from './ctx'
import { cmdCreate } from './commands/create'
import { cmdList } from './commands/list'
import { cmdDue } from './commands/due'
import { cmdWatch } from './commands/watch'
import { cmdDaemon } from './commands/daemon'
import { cmdRules } from './commands/rules'
import { cmdPoll } from './commands/poll'
import { cmdStream } from './commands/stream'
import { cmdEmit } from './commands/emit'
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
const REPEATABLE = new Set(['remind', 'subtask', 'agent', 'where', 'exec'])
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
  'disabled',
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
  jovida rules list|add|rm|enable|disable|test
               # "when X do Y" automations over a unified event envelope (the daemon runs them)
               # e.g. jovida rules add --when claude.commit --where title=~^feat --exec 'jovida create ...'
  jovida emit <source> <type> [--title <s>] [--id <s>] [--data <json>]
               # push a custom event into the engine — any hook/cron/script becomes a trigger source
               # (see: jovida help rules)
  jovida poll list|add|rm|enable|disable|test
               # a polling source: run a check on an interval, emit an event on its false→true edge
               # e.g. jovida poll add --source weather --type rain --check '...' --interval 30m
  jovida stream list|add|rm|enable|disable|test
               # a streaming source: a long-lived command that prints one event envelope per line
               # e.g. jovida stream add --source app --type error --cmd 'tail -F app.log | ...'
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
  rules: `jovida rules — "when X do Y" automations over a unified event envelope

Usage:
  jovida rules list [--json]
  jovida rules add --when <source.type> [--where <field=expr> ...] <action ...> [--cooldown <sec>] [--disabled]
  jovida rules add --spec '<rule-json>' [--dry-run]        # apply a full rule object (agent-friendly)
  jovida rules rm <id>
  jovida rules enable <id> | disable <id>
  jovida rules test (--source <s> --type <s> [--title <s>] [--data <json>] | --envelope <json>)
  jovida rules spec [--json]                               # print the trigger protocol (for agents to ground on)

For agents / programmatic authoring: run 'jovida rules spec --json' to learn the envelope, the built-in
'todo' source vocabulary, the rule schema and matchers; produce a rule object; validate it with
'jovida rules add --spec <json> --dry-run'; then apply it (drop --dry-run).

The engine speaks one thing: an event **envelope** { source, type, title?, id?, at?, data? }.
A rule matches an envelope by source.type (+ optional field filters) and runs actions. The **daemon**
runs them (jovida daemon start); these commands just edit ~/.jovida/cli/rules.json (hand-editable too),
which the running daemon picks up within seconds.

Event sources (the 'source' of an envelope):
  todo        built in — the daemon emits todo.<change> and todo.<moment>:
              todo.added | todo.updated | todo.completed | todo.reopened | todo.deleted
              todo.reminder | todo.overdue   (local time moments)
  <your own>  push:    anything that runs 'jovida emit <source> <type> …' — a Claude Code hook, cron, a script.
              poll:    'jovida poll add …' runs a check on an interval and emits on its false→true edge
                       (weather/CI/file conditions; see: jovida help poll).
              stream:  'jovida stream add …' supervises a long-lived command that prints one envelope
                       per line (tail a log, subscribe a feed; see: jovida help stream).

--when <source.type>     which events fire this rule. "todo.completed", "claude.commit",
                         "weather.*" (any type of that source), or just "weather" (same as .*)
--where <field=expr>     repeatable filter, AND-ed. field is an envelope path — bare keys resolve
                         against top level then data (so 'category', 'priority' work for todo;
                         'data.city' also works). expr: ~regex (case-insensitive) · =exact · else substring.
                           --where title=~^feat   --where category==健身   --where cond=rain

Actions (give at least one; multiple --exec = multiple actions, run in order):
  --exec <cmd>           run 'sh -c <cmd>'. Data reaches it SAFELY via env vars + the envelope JSON on
                         stdin — the command string is NOT interpolated (titles/messages may contain
                         quotes or ';'). Env vars set: JOVIDA_SOURCE, JOVIDA_TYPE, JOVIDA_TITLE,
                         JOVIDA_ID, JOVIDA_AT, JOVIDA_TODAY, JOVIDA_TOMORROW, JOVIDA_<KEY> for each
                         data field, and JOVIDA_DATA (whole data as JSON). Use "$JOVIDA_TITLE", not {title}.
                         (best-effort, 30s timeout; output → daemon.log)
  --notify-title <s>     fire a Jovida-branded desktop notification (--notify-message / --subtitle too).
                         These DO support {title} {source} {type} {data.x} {today} {tomorrow} placeholders
                         (safe — notify never touches a shell).

Other:
  --name <s>  a label · --cooldown <sec>  min seconds between fires (debounce) · --disabled  add switched off

Examples:
  # when a completed todo is in 健身, celebrate (notify uses {title} template)
  jovida rules add --when todo.completed --where category==健身 --notify-title "打卡✅" --notify-message "{title}"
  # when Claude Code commits a feature (via a hook that emits claude.commit), remind to open a PR
  jovida rules add --when claude.commit --where title=~^feat --exec 'jovida create "推送并开 PR：$JOVIDA_TITLE" --priority high'
  # dry-run: which rules would a claude.commit fire?
  jovida rules test --source claude --type commit --title "feat(x): y"
`,
  emit: `jovida emit — push a custom event into the trigger engine (become a source)

Usage:
  jovida emit <source> <type> [--title <s>] [--id <s>] [--data <json>]

Hands one event envelope { source, type, title?, id?, at?, data? } to the daemon, which matches it
against your rules (see: jovida help rules) and runs the actions. This is how anything becomes a
trigger source: a Claude Code hook, a cron job, a shell script — they all just call 'jovida emit'.

Fire-and-forget: it writes the envelope to a spool (~/.jovida/cli/events/) and exits 0 even if the
daemon isn't running — queued events are processed when the daemon next starts. 'at' is filled in
automatically. --data is arbitrary JSON stored under the envelope's 'data' (matchable via --where data.x).

Examples:
  jovida emit claude commit --title "feat(rules): 待办即触发器"
  jovida emit weather rain --title "杭州有雨" --data '{"city":"Hangzhou","cond":"Light rain"}'

Wire it into Claude Code (~/.claude/settings.json) — emit claude.commit after every git commit:
  "hooks": { "PostToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command",
    "command": "jq -er 'select(.tool_input.command|test(\\"git commit\\")).tool_input.command' >/dev/null && jovida emit claude commit --title \\"$(git log -1 --format=%s)\\"" }]}] }
`,
  poll: `jovida poll — a polling source: check a condition on an interval, emit an event on its rising edge

Usage:
  jovida poll list [--json]
  jovida poll add --source <s> --type <s> --check '<sh -c cmd>' --interval <30s|5m|1h> [--title <s>] [--name <s>] [--disabled]
  jovida poll add --spec '<poll-json>' [--dry-run]        # apply a full poll object (agent-friendly)
  jovida poll rm <id>
  jovida poll enable <id> | disable <id>
  jovida poll test (<id> | --source <s> --type <s> --check '<cmd>' | --spec <json>)   # run the check once, show result
  jovida poll spec [--json]                               # print the poll-source protocol (for agents)

A poll source is the third way to feed the trigger engine (alongside built-in 'todo' and 'jovida emit').
It's for conditions nothing pushes to you — weather, CI status, a file appearing, a URL going down. The
**daemon** runs each check on its interval; you react to what it emits with an ordinary rule.

  --check '<cmd>'    run 'sh -c <cmd>'. exit 0 = condition TRUE, non-zero = false. Its stdout is carried
                     on the emitted envelope as data.output (matchable via --where data.output, template {data.output}).
  --interval <dur>   how often to check: 30s | 5m | 1h | a plain number of seconds.
  --source/--type    the envelope it emits: a rule with --when <source>.<type> reacts.
  --title <s>        envelope title (defaults to the check's first stdout line, then the source name).

Edge-triggered: it emits ONCE when the condition flips false→true — not repeatedly while true. When it flips
back to false it re-arms. State persists across daemon restarts, so a restart mid-condition does NOT re-fire.
(A brand-new poll whose condition is already true fires on its first check.)

Two steps — define the source, then react to it:
  jovida poll add --source weather --type rain --interval 30m \\
    --check 'curl -sf "https://wttr.in/Hangzhou?format=%C" | grep -qiE "rain|drizzle|shower"'
  jovida rules add --when weather.rain --exec 'jovida create "记得带伞 ☔️" --when "$JOVIDA_TODAY" --priority high'

More examples:
  # CI on this branch went red → make a fix-the-build todo
  jovida poll add --source ci --type broken --interval 5m --check 'test "$(gh run list -L1 --json conclusion -q ".[0].conclusion")" = failure'
  jovida rules add --when ci.broken --exec 'jovida create "修复 CI：$JOVIDA_TITLE" --priority high'
  # dry-run a check before saving it
  jovida poll test --source weather --type rain --check 'curl -sf "https://wttr.in/?format=%C" | grep -qi rain'
`,
  stream: `jovida stream — a streaming source: a long-lived command that prints one event envelope per line

Usage:
  jovida stream list [--json]
  jovida stream add --cmd '<long-lived command>' [--source <s>] [--type <s>] [--name <s>] [--restart <sec>] [--disabled]
  jovida stream add --spec '<stream-json>' [--dry-run]        # apply a full stream object (agent-friendly)
  jovida stream rm <id>
  jovida stream enable <id> | disable <id>
  jovida stream test (<id> | --cmd '<cmd>' [--source <s>] [--type <s>] | --spec <json>)   # run ≤3s, show parsed envelopes
  jovida stream spec [--json]                                 # print the stream-source protocol (for agents)

The fourth way to feed the trigger engine (alongside built-in 'todo', 'jovida emit', and 'jovida poll').
A stream is the streaming analog of emit: instead of one event, a program that keeps producing them. The
**daemon** spawns it, supervises it (restart-on-exit with backoff), and routes each line; you react with a rule.

  --cmd '<cmd>'      a long-lived 'sh -c' command. Each stdout line must be one envelope JSON object:
                     { source?, type?, title?, id?, at?, data? }. Unparseable lines are skipped.
  --source/--type    defaults stamped onto lines that omit them — so a generator that only prints its
                     payload (e.g. {"title":"…","data":{…}}) still works when you set these.
  --restart <sec>    restart backoff base after the command exits (default 3s; doubles on repeated fast
                     exits, capped at 60s; a run of ≥10s resets it).

Examples:
  # tail an app log, emit app.error for every ERROR line
  jovida stream add --name errors --source app --type error \\
    --cmd 'tail -F /var/log/app.log | grep --line-buffered ERROR | while read l; do jq -nc --arg t "$l" "{title:\\$t}"; done'
  jovida rules add --when app.error --exec 'jovida create "查错：$JOVIDA_TITLE" --priority high'
  # a generator that prints full envelopes needs no defaults:
  jovida stream add --cmd 'my-event-source --jsonl'    # each line: {"source":"x","type":"y","title":"z"}
  # preview what a command emits before saving it:
  jovida stream test --source app --type error --cmd 'printf "{\\"title\\":\\"boom\\"}\\n"'
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
    case 'rules':
      cmdRules({
        action: positionals[0],
        positionals: positionals.slice(1),
        spec: str(flags.spec),
        dryRun: flags['dry-run'] === true,
        name: str(flags.name),
        when: str(flags.when),
        where: arr(flags.where),
        exec: arr(flags.exec),
        notifyTitle: str(flags['notify-title']),
        notifyMessage: str(flags['notify-message']),
        subtitle: str(flags.subtitle),
        cooldown: num(flags.cooldown),
        disabled: flags.disabled === true,
        envelope: str(flags.envelope),
        source: str(flags.source),
        type: str(flags.type),
        title: str(flags.title),
        data: str(flags.data),
        json
      })
      break
    case 'emit':
      cmdEmit({
        source: positionals[0],
        type: positionals[1],
        title: str(flags.title),
        id: str(flags.id),
        data: str(flags.data),
        json
      })
      break
    case 'poll':
      cmdPoll({
        action: positionals[0],
        positionals: positionals.slice(1),
        spec: str(flags.spec),
        dryRun: flags['dry-run'] === true,
        name: str(flags.name),
        source: str(flags.source),
        type: str(flags.type),
        check: str(flags.check),
        interval: str(flags.interval),
        title: str(flags.title),
        disabled: flags.disabled === true,
        json
      })
      break
    case 'stream':
      await cmdStream({
        action: positionals[0],
        positionals: positionals.slice(1),
        spec: str(flags.spec),
        dryRun: flags['dry-run'] === true,
        name: str(flags.name),
        cmd: str(flags.cmd),
        source: str(flags.source),
        type: str(flags.type),
        restart: num(flags.restart),
        disabled: flags.disabled === true,
        json
      })
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
