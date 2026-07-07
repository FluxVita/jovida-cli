// 运行配置。默认连**生产** api.jovida.ai;内部 / 测试环境经 `JOVIDA_API_URL` 覆盖
// ——内部地址**不在源码硬编码**(公开仓只留生产默认)。
export interface AppConfig {
  baseUrl: string
  appId: string
  timeoutMs: number
}

const DEFAULT_BASE_URL = 'https://tapi.jovida.ai' // 生产(公开默认)
const DEFAULT_APP_ID = '2012' // Vita-Aid:复用 Jovida TODO app_id(同 group → 同 vitaID)

export function loadConfig(): AppConfig {
  const t = Number(process.env['JOVIDA_TIMEOUT_MS'])
  return {
    baseUrl: process.env['JOVIDA_API_URL'] || DEFAULT_BASE_URL,
    appId: process.env['JOVIDA_APP_ID'] || DEFAULT_APP_ID,
    timeoutMs: Number.isFinite(t) && t > 0 ? t : 0 // 0 = 不限时(交互场景);statusline/hook 用 env 收紧
  }
}

// 单一版本来源:取 package.json,避免与 npm 版本双写漂移(dist/config.js 与 src/config.ts 都解析到包根)。
export const APP_VERSION: string = require('../package.json').version

/** process.platform → Vita-Platform 值。 */
export function platformName(): string {
  if (process.platform === 'darwin') return 'macos'
  if (process.platform === 'win32') return 'windows'
  return 'linux'
}
