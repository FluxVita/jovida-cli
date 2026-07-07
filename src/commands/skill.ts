import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs'

// 已知 agent → skill 安装位置 <home>/<dir>/skills/jovida-cli/SKILL.md。
// keys = `--agent` 接受的定向名(小写、含别名);name = 展示名;dir = home 下子目录。
// 目录约定对齐 `skills` CLI(npx skills add)所维护的注册表;Amp/Cline/Antigravity 约定未稳定,暂未收录。
const AGENTS = [
  { keys: ['codex'], name: 'Codex', dir: '.codex' },
  { keys: ['claude', 'claude-code', 'claudecode'], name: 'Claude Code', dir: '.claude' },
  { keys: ['gemini', 'gemini-cli'], name: 'Gemini CLI', dir: '.gemini' },
  { keys: ['cursor'], name: 'Cursor', dir: '.cursor' },
  { keys: ['windsurf', 'codeium'], name: 'Windsurf', dir: '.codeium/windsurf' },
  { keys: ['continue'], name: 'Continue', dir: '.continue' },
  { keys: ['opencode'], name: 'OpenCode', dir: '.opencode' },
  { keys: ['goose'], name: 'Goose', dir: '.goose' },
  { keys: ['qwen', 'qwen-code'], name: 'Qwen Code', dir: '.qwen' },
  { keys: ['crush'], name: 'Crush', dir: '.config/crush' },
  { keys: ['kilocode', 'kilo'], name: 'KiloCode', dir: '.kilocode' },
  { keys: ['aider'], name: 'Aider', dir: '.aider-desk' },
  { keys: ['copilot', 'github-copilot'], name: 'GitHub Copilot', dir: '.copilot' }
]
const SKILL_NAME = 'jovida-cli'

// 随包的 SKILL.md(包根)。dist/commands/skill.js → ../../SKILL.md;dev src/commands → 同样解析到仓根。
function skillSource(): string {
  return resolve(__dirname, '..', '..', 'SKILL.md')
}

export interface SkillArgs {
  all?: boolean // 即使未检测到 agent 也装(给所有已知 agent 建目录)
  agents?: string[] // `--agent` 定向:只装这些 agent(名称见 AGENTS.keys);不传 = 全部已知 agent
  json?: boolean
}

/** 把 `--agent` 传入的名字(可含别名、逗号分隔)解析为 AGENTS 子集;未知名报错。 */
function selectAgents(names: string[] | undefined): typeof AGENTS {
  if (!names || names.length === 0) return AGENTS
  const wanted = names.flatMap((n) => n.split(',')).map((n) => n.trim().toLowerCase()).filter(Boolean)
  const picked: typeof AGENTS = []
  for (const w of wanted) {
    const ag = AGENTS.find((a) => a.keys.includes(w))
    if (!ag) {
      const known = AGENTS.map((a) => a.keys[0]).join(', ')
      throw new Error(`unknown agent "${w}" — known: ${known}`)
    }
    if (!picked.includes(ag)) picked.push(ag)
  }
  return picked
}

/**
 * 把随 CLI 包发布的 SKILL.md 装 / 更新进 agent 的 skill 目录。
 * 与 CLI 同一个 npm 版本 → 不漂移。`install` 与 `update` 行为相同(覆盖)。
 * 默认装进所有已检测到的 agent;`--agent codex|claude` 只装指定的;`--all` 即使未检测到也建目录。
 *
 * `show` = 把 SKILL.md 原样打印到 stdout —— 给「不在 AGENTS 列表 / 不从本地目录加载 skill」
 * 的平台/沙盒 agent 用:它们自己 `jovida skill show > <自家 skill 路径>` 或读进上下文,
 * 我们不替每个平台维护目录约定(每个 agent 最懂自己 skill 装哪)。
 */
export function cmdSkill(sub: string | undefined, a: SkillArgs): void {
  if (sub === 'show') {
    const src = skillSource()
    if (!existsSync(src)) throw new Error(`bundled SKILL.md not found at ${src}`)
    process.stdout.write(readFileSync(src, 'utf8')) // 原样内容,不包 JSON(供 agent 直接读取/重定向落盘)
    return
  }
  if (sub && sub !== 'install' && sub !== 'update') {
    throw new Error('usage: jovida skill install | update | show')
  }
  const src = skillSource()
  if (!existsSync(src)) throw new Error(`bundled SKILL.md not found at ${src}`)

  const targets = selectAgents(a.agents)
  const installed: string[] = []
  const skipped: string[] = []
  for (const ag of targets) {
    const home = join(homedir(), ag.dir)
    if (!a.all && !existsSync(home)) {
      skipped.push(ag.name)
      continue
    }
    const dir = join(home, 'skills', SKILL_NAME)
    mkdirSync(dir, { recursive: true })
    copyFileSync(src, join(dir, 'SKILL.md'))
    installed.push(join(dir, 'SKILL.md'))
  }

  // 装机时点的能力露出:让执行安装的 agent 看到「可顺手提议」的进阶配置(人和 agent 双通道)。
  const tips = [
    'Terminal reminders: `jovida due --brief` can power a statusline / prompt-hook nudge — offer to set it up (recipe: `jovida help due`, or README "Reminders in your terminal").',
    'Lark/Feishu users: `jovida import lark` imports their open Lark tasks (idempotent, re-runnable) — offer it if the user uses Feishu tasks (see `jovida help import`).'
  ]
  if (a.json) {
    console.log(JSON.stringify({ installed, skipped, tips }))
    return
  }
  if (installed.length === 0) {
    console.log('No supported agents detected. Re-run with --all to install for all known agents.')
    return
  }
  console.log('✓ skill installed/updated:')
  for (const p of installed) console.log(`  ${p}`)
  if (skipped.length) console.log(`(skipped, not detected: ${skipped.join(', ')} — use --all to force)`)
  console.log('\nWorth offering to the user:')
  for (const t of tips) console.log(`  - ${t}`)
}
