import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { existsSync, mkdirSync, copyFileSync } from 'node:fs'

// 已知 agent → skill 安装位置 <home>/<dir>/skills/jovida-cli/SKILL.md。
const AGENTS = [
  { name: 'Codex', dir: '.codex' },
  { name: 'Claude Code', dir: '.claude' }
]
const SKILL_NAME = 'jovida-cli'

// 随包的 SKILL.md(包根)。dist/commands/skill.js → ../../SKILL.md;dev src/commands → 同样解析到仓根。
function skillSource(): string {
  return resolve(__dirname, '..', '..', 'SKILL.md')
}

export interface SkillArgs {
  all?: boolean // 即使未检测到 agent 也装(给所有已知 agent 建目录)
  json?: boolean
}

/**
 * 把随 CLI 包发布的 SKILL.md 装 / 更新进 agent 的 skill 目录。
 * 与 CLI 同一个 npm 版本 → 不漂移。`install` 与 `update` 行为相同(覆盖)。
 */
export function cmdSkill(sub: string | undefined, a: SkillArgs): void {
  if (sub && sub !== 'install' && sub !== 'update') {
    throw new Error('usage: jovida skill install   (or: jovida skill update)')
  }
  const src = skillSource()
  if (!existsSync(src)) throw new Error(`bundled SKILL.md not found at ${src}`)

  const installed: string[] = []
  const skipped: string[] = []
  for (const ag of AGENTS) {
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

  if (a.json) {
    console.log(JSON.stringify({ installed, skipped }))
    return
  }
  if (installed.length === 0) {
    console.log('No agents detected (~/.codex or ~/.claude). Re-run with --all to install for all known agents.')
    return
  }
  console.log('✓ skill installed/updated:')
  for (const p of installed) console.log(`  ${p}`)
  if (skipped.length) console.log(`(skipped, not detected: ${skipped.join(', ')} — use --all to force)`)
}
