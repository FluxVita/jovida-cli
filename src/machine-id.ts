import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'

// 设备标识（Vita-Did）派生。目标：删 app 再装回来不变 —— 故派生自**OS 机器标识**，
// 而非存一个 UUID（UUID 落在 app userData，卸载即丢）。机器标识能扛卸载重装/清数据，
// 扛不住重装系统/换机/抹盘。取不到时降级随机 UUID（那种会重置）。
// 隐私：原始硬件 ID 不外发，加盐 SHA-256 后用（app 维度隔离）。

function rawMachineId(): string | null {
  try {
    if (process.platform === 'darwin') {
      const out = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
        encoding: 'utf8'
      })
      return /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out)?.[1] ?? null
    }
    if (process.platform === 'win32') {
      const out = execFileSync(
        'reg',
        ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
        { encoding: 'utf8' }
      )
      return /MachineGuid\s+REG_SZ\s+([A-Fa-f0-9-]+)/.exec(out)?.[1] ?? null
    }
    // linux
    for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
      try {
        const id = readFileSync(p, 'utf8').trim()
        if (id) return id
      } catch {
        /* try next */
      }
    }
    return null
  } catch {
    return null
  }
}

const SALT = 'jovida-cli-did-v1'

/** 派生 device-id。stable=true 表示来自机器标识（重装稳定）；false=降级随机（会重置）。 */
export function deriveDeviceId(): { id: string; stable: boolean } {
  const raw = rawMachineId()
  if (raw) {
    const h = createHash('sha256').update(SALT).update(raw).digest('hex').slice(0, 32)
    return { id: `dvc_${h}`, stable: true }
  }
  return { id: `dvc_${randomUUID().replace(/-/g, '')}`, stable: false }
}
