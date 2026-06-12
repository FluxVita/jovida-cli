#!/usr/bin/env node
import { makeCtx } from './ctx'
import { cmdCreate } from './commands/create'
import { cmdList } from './commands/list'
import { cmdShow } from './commands/show'
import { cmdUpdate } from './commands/update'
import { cmdComplete } from './commands/complete'
import { cmdDelete } from './commands/delete'
import { cmdLogin } from './commands/login'
import { cmdWhoami } from './commands/whoami'
import { NotFoundError } from './commands/shared'
import { NotSignedInError } from './session'
import { ApiError } from './api'
import { clearCredentials } from './state'

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

  jovida create "<title>" [--when <ISO>] [--priority none|low|medium|high]
                          [--remind <ISO> ...] [--category <s>] [--desc <s>]
                          [--subtask <title> ...] [--hint <s>] [--json]
  jovida list  [--scope today|upcoming|recent|range|all] [--status pending|completed|all]
               [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit N] [--json]
  jovida show <entry_id> [--json]
  jovida update <entry_id> [--title ...] [--when ...] [--priority ...] [--remind ...] [...]
  jovida complete <entry_id> [--json]
  jovida delete <entry_id> [<entry_id> ...] [--json]

Output: JSON is emitted automatically when stdout is not a TTY (use --json/--no-json to force).
Env:    JOVIDA_API_URL=<url> (default https://api.jovida.ai) · JOVIDA_HOME=<dir> (default ~/.jovida)
`

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
    console.log(HELP)
    return
  }
  if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
    console.log(require('../package.json').version)
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
        json
      })
      break
    case 'show':
      await cmdShow(ctx, { id: positionals[0], json })
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
      await cmdComplete(ctx, { id: positionals[0], json })
      break
    case 'delete':
      await cmdDelete(ctx, { ids: positionals, json })
      break
    default:
      console.error(`unknown command: ${cmd}\n`)
      console.log(HELP)
      process.exitCode = 1
  }
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
