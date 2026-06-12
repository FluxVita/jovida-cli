// 运行配置。默认连**生产** api.jovida.ai;内部 / 测试环境经 `JOVIDA_API_URL` 覆盖
// ——内部地址**不在源码硬编码**(公开仓只留生产默认)。
export interface AppConfig {
  baseUrl: string
  appId: string
}

const DEFAULT_BASE_URL = 'https://tapi.jovida.ai' // 生产(公开默认)
const DEFAULT_APP_ID = '2012' // Vita-Aid:复用 Jovida TODO app_id(同 group → 同 vitaID)

export function loadConfig(): AppConfig {
  return {
    baseUrl: process.env['JOVIDA_API_URL'] || DEFAULT_BASE_URL,
    appId: process.env['JOVIDA_APP_ID'] || DEFAULT_APP_ID
  }
}

export const APP_VERSION = '0.0.1'

/** process.platform → Vita-Platform 值。 */
export function platformName(): string {
  if (process.platform === 'darwin') return 'macos'
  if (process.platform === 'win32') return 'windows'
  return 'linux'
}
