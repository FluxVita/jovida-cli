// jovida pack — 注册表/快捷指令库:把一套自动化(源 + 规则)导出成可分享的 bundle 文件,import/install 即装成实时定义。
// export/import 走文件或 stdin(分享);save/list/show/install/rm 走本地库(~/.jovida/cli/packs/)。
import { readFileSync, writeFileSync } from 'node:fs'
import { loadRules, saveRules, type Rule } from '../core/rules'
import { loadPolls, savePolls, type PollSource } from '../core/poll'
import { loadStreams, saveStreams, type StreamSource } from '../core/stream'
import {
  buildBundle,
  validateBundle,
  reidBundle,
  bundleCounts,
  listPacks,
  readPack,
  writePack,
  removePack,
  PACKS_DIR,
  type Bundle
} from '../core/pack'

export interface PackArgs {
  action?: string // export | import | save | install | list | show | rm
  positionals: string[] // pack name(save/install/show/rm)/ file path(import)
  name?: string // export/save: bundle 名
  desc?: string // export/save: 描述
  rule?: string[] // export/save: 选中的 rule id(可重复)
  poll?: string[] // export/save: 选中的 poll id
  stream?: string[] // export/save: 选中的 stream id
  all?: boolean // export/save: 全选
  out?: string // export: 写到文件(缺省 stdout)
  dryRun?: boolean // import/install: 只校验+预览,不落盘
  disabled?: boolean // import/install: 全部装成停用(安全先审再启)
  json?: boolean
}

const pick = <T extends { id: string }>(all: T[], ids: string[] | undefined, takeAll: boolean): T[] => {
  if (takeAll) return all
  if (!ids || ids.length === 0) return []
  return all.filter((x) => ids.some((id) => x.id === id || x.id.endsWith(id)))
}

/** 从当前实时定义里按选择组装一个 bundle(export/save 共用)。 */
function gatherBundle(a: PackArgs): Bundle {
  if (!a.name) throw new Error('needs --name <bundle-name>')
  const rules = pick<Rule>(loadRules(), a.rule, a.all === true)
  const polls = pick<PollSource>(loadPolls(), a.poll, a.all === true)
  const streams = pick<StreamSource>(loadStreams(), a.stream, a.all === true)
  if (rules.length + polls.length + streams.length === 0)
    throw new Error('nothing selected — use --all, or --rule/--poll/--stream <id> (repeatable)')
  return buildBundle(a.name, a.desc, { rules, polls, streams })
}

/** 把 bundle 装进实时定义(重发新 id;可选全停用)。返回装入计数。 */
function installBundle(bundle: Bundle, disabled: boolean): { rules: number; polls: number; streams: number } {
  const b = reidBundle(bundle)
  if (b.rules?.length) {
    const cur = loadRules()
    for (const r of b.rules) cur.push(disabled ? { ...r, enabled: false } : r)
    saveRules(cur)
  }
  if (b.polls?.length) {
    const cur = loadPolls()
    for (const p of b.polls) cur.push(disabled ? { ...p, enabled: false } : p)
    savePolls(cur)
  }
  if (b.streams?.length) {
    const cur = loadStreams()
    for (const s of b.streams) cur.push(disabled ? { ...s, enabled: false } : s)
    saveStreams(cur)
  }
  return bundleCounts(b)
}

function readBundleArg(fileOrDash: string | undefined): Bundle {
  if (!fileOrDash) throw new Error('import needs a bundle file path (or "-" for stdin)')
  const text = fileOrDash === '-' ? readFileSync(0, 'utf8') : readFileSync(fileOrDash, 'utf8')
  return validateBundle(text)
}

const summary = (b: Bundle): string => {
  const c = bundleCounts(b)
  return `${c.rules} rule(s), ${c.polls} poll(s), ${c.streams} stream(s)`
}

function reportInstall(action: string, bundle: Bundle, a: PackArgs): void {
  const json = a.json === true
  if (a.dryRun) {
    if (json) console.log(JSON.stringify({ valid: true, dryRun: true, name: bundle.name, counts: bundleCounts(bundle) }))
    else console.log(`✓ valid (dry-run, not installed): "${bundle.name}" — ${summary(bundle)}`)
    return
  }
  const installed = installBundle(bundle, a.disabled === true)
  if (json) console.log(JSON.stringify({ [action + 'ed']: bundle.name, installed, disabled: a.disabled === true }))
  else
    console.log(
      `✓ ${action}ed "${bundle.name}": ${installed.rules} rule(s), ${installed.polls} poll(s), ${installed.streams} stream(s)${a.disabled ? ' (all disabled — review then enable)' : ''}\n(the running daemon picks them up within seconds)`
    )
}

export function cmdPack(a: PackArgs): void {
  const action = a.action ?? 'list'
  const json = a.json === true

  switch (action) {
    case 'export': {
      const bundle = gatherBundle(a)
      const text = JSON.stringify(bundle, null, 2)
      if (a.out) {
        writeFileSync(a.out, text + '\n', { mode: 0o600 })
        if (json) console.log(JSON.stringify({ exported: bundle.name, file: a.out, counts: bundleCounts(bundle) }))
        else console.log(`✓ exported "${bundle.name}" → ${a.out} (${summary(bundle)})`)
      } else {
        console.log(text) // 到 stdout,便于管道/复制分享
      }
      return
    }

    case 'save': {
      // 同 export,但落进本地库(~/.jovida/cli/packs/<name>.json)
      const bundle = gatherBundle(a)
      writePack(bundle.name, bundle)
      if (json) console.log(JSON.stringify({ saved: bundle.name, counts: bundleCounts(bundle) }))
      else console.log(`✓ saved pack "${bundle.name}" (${summary(bundle)})\ninstall it (here or elsewhere) with: jovida pack install ${bundle.name}`)
      return
    }

    case 'import': {
      const bundle = readBundleArg(a.positionals[0])
      reportInstall('import', bundle, a)
      return
    }

    case 'install': {
      const name = a.positionals[0]
      if (!name) throw new Error('install needs a pack name (see: jovida pack list)')
      const bundle = readPack(name)
      reportInstall('install', bundle, a)
      return
    }

    case 'list': {
      const names = listPacks()
      if (json) {
        console.log(JSON.stringify({ packs: names, dir: PACKS_DIR }))
        return
      }
      if (names.length === 0) {
        console.log(`no saved packs. make one from your current automations:\n  jovida pack save --name my-kit --all\n(dir: ${PACKS_DIR})`)
        return
      }
      for (const n of names) {
        try {
          const b = readPack(n)
          console.log(`${n}  — ${summary(b)}${b.description ? '  · ' + b.description : ''}`)
        } catch {
          console.log(`${n}  (unreadable)`)
        }
      }
      return
    }

    case 'show': {
      const name = a.positionals[0]
      if (!name) throw new Error('show needs a pack name (see: jovida pack list)')
      const bundle = readPack(name)
      console.log(json ? JSON.stringify(bundle) : JSON.stringify(bundle, null, 2))
      return
    }

    case 'rm': {
      const name = a.positionals[0]
      if (!name) throw new Error('rm needs a pack name (see: jovida pack list)')
      removePack(name)
      if (json) console.log(JSON.stringify({ removed: name }))
      else console.log(`✓ removed pack "${name}" (this only deletes the library file; installed rules/polls/streams stay)`)
      return
    }

    default:
      throw new Error(`unknown pack action: ${action} (use export|import|save|install|list|show|rm)`)
  }
}
