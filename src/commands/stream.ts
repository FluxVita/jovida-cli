// jovida stream — stream 源的管理面(list/add/rm/enable/disable/test/spec)。
// stream 是触发器协议里的一种**源**:一个长驻命令,stdout 每行一条 JSONL 信封,引擎监督重启+逐行路由。
// 真正的长驻+监督在守护里(嵌入运行体,见 ../stream.ts);这里只增删查改 streams.json + 有界预览。
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import {
  loadStreams,
  saveStreams,
  newStreamId,
  validateStreamSpec,
  parseStreamLine,
  STREAMS_FILE,
  type StreamSource
} from '../core/stream'

export interface StreamArgs {
  action?: string // list | add | rm | enable | disable | test | spec
  positionals: string[] // stream id(rm/enable/disable/test)
  spec?: string // add: 整条 stream JSON(agent 友好)
  dryRun?: boolean // add: 只校验+预览,不落盘
  name?: string
  cmd?: string
  source?: string
  type?: string
  restart?: number // restart_sec
  disabled?: boolean
  json?: boolean
}

function streamSummary(s: StreamSource): string {
  const flag = s.enabled ? '●' : '○'
  const def = s.source || s.type ? `  (default ${s.source ?? '*'}.${s.type ?? '*'})` : ''
  return `${flag} ${s.id}${s.name ? '  ' + s.name : ''}${def}\n    cmd: ${s.cmd}`
}

function findStream(streams: StreamSource[], id: string): StreamSource {
  const s = streams.find((x) => x.id === id || x.id.endsWith(id))
  if (!s) throw new Error(`no stream matching id: ${id}`)
  return s
}

// test:跑 cmd,收最多 N 行或 T 秒,解析成信封预览,然后杀掉(长驻命令不会自己退)。
function previewStream(s: StreamSource, maxLines: number, maxMs: number): Promise<{ envelopes: unknown[]; skipped: number; exit: number | null }> {
  return new Promise((resolve) => {
    const envelopes: unknown[] = []
    let skipped = 0
    let done = false
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('sh', ['-c', s.cmd], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      resolve({ envelopes: [], skipped: 0, exit: null })
      void e
      return
    }
    const finish = (exit: number | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        child.kill('SIGTERM')
      } catch {
        /* 已退出 */
      }
      resolve({ envelopes, skipped, exit })
    }
    const timer = setTimeout(() => finish(null), maxMs)
    const rl = child.stdout ? createInterface({ input: child.stdout }) : null
    rl?.on('line', (line) => {
      if (done) return
      const env = parseStreamLine(line, { source: s.source, type: s.type })
      if (env) envelopes.push(env)
      else if (line.trim()) skipped++
      if (envelopes.length >= maxLines) finish(0)
    })
    child.on('error', () => finish(null))
    child.on('close', (code) => finish(code))
  })
}

export async function cmdStream(a: StreamArgs): Promise<void> {
  const action = a.action ?? 'list'
  const json = a.json === true

  switch (action) {
    case 'list': {
      const streams = loadStreams()
      if (json) {
        console.log(JSON.stringify({ streams, file: STREAMS_FILE }))
        return
      }
      if (streams.length === 0) {
        console.log(
          `no stream sources yet. add one (a long-lived command that prints one envelope JSON per line):\n  jovida stream add --name errors --source app --type error \\\n    --cmd 'tail -F /var/log/app.log | grep --line-buffered ERROR | while read l; do jq -nc --arg t "$l" "{title:\\$t}"; done'\nthen react with a rule:\n  jovida rules add --when app.error --exec 'jovida create "查错：$JOVIDA_TITLE" --priority high'\n(file: ${STREAMS_FILE})`
        )
        return
      }
      for (const s of streams) console.log(streamSummary(s))
      return
    }

    case 'add': {
      let stream: StreamSource
      if (a.spec) {
        stream = validateStreamSpec(a.spec)
        if (a.disabled) stream.enabled = false
      } else {
        if (!a.cmd) throw new Error('add needs --cmd <long-lived command> (or --spec <stream-json>)')
        stream = {
          id: newStreamId(),
          name: a.name,
          cmd: a.cmd,
          source: a.source,
          type: a.type,
          enabled: a.disabled !== true,
          restart_sec: a.restart && a.restart > 0 ? a.restart : undefined
        }
      }
      if (a.dryRun) {
        if (json) console.log(JSON.stringify({ valid: true, dryRun: true, stream }))
        else console.log(`✓ valid (dry-run, not saved)\n${streamSummary(stream)}`)
        return
      }
      const streams = loadStreams()
      streams.push(stream)
      saveStreams(streams)
      if (json) console.log(JSON.stringify({ added: stream }))
      else console.log(`✓ added stream ${stream.id}\n${streamSummary(stream)}\n(the running daemon spawns & supervises it within seconds; react to its events with 'jovida rules add')`)
      return
    }

    case 'rm': {
      const id = a.positionals[0]
      if (!id) throw new Error('rm needs a stream id (see: jovida stream list)')
      const streams = loadStreams()
      const s = findStream(streams, id)
      saveStreams(streams.filter((x) => x.id !== s.id))
      if (json) console.log(JSON.stringify({ removed: s.id }))
      else console.log(`✓ removed stream ${s.id}`)
      return
    }

    case 'enable':
    case 'disable': {
      const id = a.positionals[0]
      if (!id) throw new Error(`${action} needs a stream id (see: jovida stream list)`)
      const streams = loadStreams()
      const s = findStream(streams, id)
      s.enabled = action === 'enable'
      saveStreams(streams)
      if (json) console.log(JSON.stringify({ [action + 'd']: s.id, enabled: s.enabled }))
      else console.log(`✓ ${action}d stream ${s.id}`)
      return
    }

    case 'test': {
      // 有界预览:跑 cmd,收最多 5 行或 3 秒,解析成信封,然后杀掉(长驻命令不会自退)。
      let stream: StreamSource
      if (a.spec) stream = validateStreamSpec(a.spec)
      else if (a.positionals[0]) stream = findStream(loadStreams(), a.positionals[0])
      else if (a.cmd) stream = { id: 'str_test', name: a.name, cmd: a.cmd, source: a.source, type: a.type, enabled: true }
      else throw new Error('test needs a stream id, or --cmd, or --spec <json>')

      const r = await previewStream(stream, 5, 3000)
      if (json) {
        console.log(JSON.stringify({ cmd: stream.cmd, ...r }))
        return
      }
      console.log(`cmd: ${stream.cmd}`)
      console.log(`→ parsed ${r.envelopes.length} envelope(s)${r.skipped ? `, skipped ${r.skipped} unparseable line(s)` : ''} in ≤3s:`)
      for (const e of r.envelopes) {
        const env = e as { source: string; type: string; title?: string }
        console.log(`    ${env.source}.${env.type}  title="${env.title ?? ''}"`)
      }
      if (r.envelopes.length === 0) console.log('    (none — lines must be JSON envelopes with source+type, or set --source/--type defaults)')
      return
    }

    case 'spec': {
      const spec = {
        what: 'a stream source: a long-lived command whose stdout prints one envelope JSON per line; the daemon supervises it (restart-on-exit with backoff) and routes each line',
        stream: {
          cmd: 'string — long-lived sh -c command; prints one JSON object per line',
          source: 'string? — default source for lines that omit "source"',
          type: 'string? — default type for lines that omit "type"',
          name: 'string?',
          enabled: 'boolean (default true)',
          restart_sec: 'number? — restart backoff base on exit (default 3)'
        },
        line: 'each stdout line = envelope JSON { source?, type?, title?, id?, at?, data? }; source/type fall back to the stream defaults; unparseable lines / missing source+type are skipped',
        supervision: 'exit → restart after backoff (base·2^consecutive-fast-exits, capped 60s); a process that runs ≥10s resets the backoff',
        emits: 'whatever envelopes the command prints — react with a rule: jovida rules add --when <source>.<type> …',
        apply: "jovida stream add --spec '<stream-json>' [--dry-run]"
      }
      console.log(json ? JSON.stringify(spec) : JSON.stringify(spec, null, 2))
      return
    }

    default:
      throw new Error(`unknown stream action: ${action} (use list|add|rm|enable|disable|test|spec)`)
  }
}
