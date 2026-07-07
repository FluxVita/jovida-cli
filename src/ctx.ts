import { loadConfig, platformName } from './config'
import { ApiClient } from './api'
import { Session } from './session'
import { SyncClient } from './sync'
import { getDeviceId } from './state'

export interface Ctx {
  api: ApiClient
  session: Session
  sync: SyncClient
  baseUrl: string
}

export function makeCtx(): Ctx {
  const cfg = loadConfig()
  const api = new ApiClient({
    baseUrl: cfg.baseUrl,
    appId: cfg.appId,
    deviceId: getDeviceId(),
    platform: platformName(),
    timeoutMs: cfg.timeoutMs
  })
  const session = new Session(api)
  const sync = new SyncClient(api)
  return { api, session, sync, baseUrl: cfg.baseUrl }
}
