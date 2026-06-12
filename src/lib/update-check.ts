// 轻量更新提示:每天最多查一次 npm 最新版,仅交互终端(TTY)、走 stderr(不污染 --json stdout)、
// 超时 2s、**永不抛错也永不阻塞命令**。CI / NO_UPDATE_NOTIFIER / JOVIDA_NO_UPDATE_CHECK 关闭。
import { getUpdateCheck, setUpdateCheck } from '../state'

const PKG = '@fluxvita/jovida-cli'
const DAY = 86400
const nowSec = (): number => Math.floor(Date.now() / 1000)

function isNewer(latest: string, current: string): boolean {
  const a = latest.split('.').map((n) => parseInt(n, 10))
  const b = current.split('.').map((n) => parseInt(n, 10))
  for (let i = 0; i < 3; i++) {
    const x = a[i] || 0
    const y = b[i] || 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

async function fetchLatest(): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 2000)
    const res = await fetch(`https://registry.npmjs.org/${PKG}/latest`, { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return null
    const j = (await res.json()) as { version?: string }
    return typeof j.version === 'string' ? j.version : null
  } catch {
    return null
  }
}

export async function maybeNotifyUpdate(current: string): Promise<void> {
  try {
    if (!process.stderr.isTTY) return // 仅给人看;脚本/agent(非 TTY)不打扰
    if (process.env['CI'] || process.env['JOVIDA_NO_UPDATE_CHECK'] || process.env['NO_UPDATE_NOTIFIER']) return
    const { at, latest: cached } = getUpdateCheck()
    let latest = cached
    if (!at || nowSec() - at > DAY) {
      const fresh = await fetchLatest()
      latest = fresh ?? cached
      setUpdateCheck(nowSec(), latest)
    }
    if (latest && isNewer(latest, current)) {
      process.stderr.write(
        `\n  Update available: ${current} → ${latest}\n` +
          `  Run: npm i -g ${PKG}@latest   (then: jovida skill update)\n\n`
      )
    }
  } catch {
    /* 更新检查永不影响命令 */
  }
}
