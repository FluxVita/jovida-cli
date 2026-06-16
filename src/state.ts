// 本地状态:~/.jovida/cli/(`~/.jovida` 留作品牌命名空间,CLI 占 cli 子目录;可经 JOVIDA_HOME 覆盖)。
// 无待办库——storeless。credentials.json(token,0600)+ state.json(deviceId / lastServerVersion)。
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { deriveDeviceId } from './machine-id'

const DIR = process.env['JOVIDA_HOME'] ?? join(homedir(), '.jovida', 'cli')
const CRED = join(DIR, 'credentials.json')
const STATE = join(DIR, 'state.json')

/** Sign 态 vita token 记录（单 JWT：raw 内含 access/refresh 双窗，durs 用于推算续期时机）。 */
export interface TokenRecord {
  raw: string
  vitaId: string
  accessDur: number // access 有效期（秒）；0 = 未知（过渡 --token 流），不主动 refresh
  refreshDur: number // refresh 有效期（秒）
  receivedAt: number // 落地 Unix 秒
}

interface LocalState {
  deviceId?: string
  didStable?: boolean
  lastServerVersion?: number
  updateCheckAt?: number // 上次查 npm 最新版的 Unix 秒(节流)
  updateLatest?: string // 缓存的最新版本号
}

function ensureDir(): void {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true, mode: 0o700 })
}
function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as T
  } catch {
    return null
  }
}

function loadState(): LocalState {
  return readJson<LocalState>(STATE) ?? {}
}
function saveState(s: LocalState): void {
  ensureDir()
  writeFileSync(STATE, JSON.stringify(s, null, 2))
}

/** Vita-Did:首次派生(机器标识)并持久化;重装后由 machine-id 派生回同值。 */
export function getDeviceId(): string {
  const s = loadState()
  if (s.deviceId) return s.deviceId
  const { id, stable } = deriveDeviceId()
  s.deviceId = id
  s.didStable = stable
  saveState(s)
  return id
}

export function getLastServerVersion(): number {
  return loadState().lastServerVersion ?? 0
}
export function setLastServerVersion(v: number): void {
  const s = loadState()
  s.lastServerVersion = v
  saveState(s)
}

export function getUpdateCheck(): { at: number; latest: string } {
  const s = loadState()
  return { at: s.updateCheckAt ?? 0, latest: s.updateLatest ?? '' }
}
export function setUpdateCheck(at: number, latest: string): void {
  const s = loadState()
  s.updateCheckAt = at
  s.updateLatest = latest
  saveState(s)
}

/** 凭证:仅一枚 Sign 态 vita token(设备授权流换得;过渡期可由 --token 直粘)。 */
export interface Credentials {
  token?: TokenRecord
}

function readCreds(): Credentials | null {
  return readJson<Credentials>(CRED)
}
function writeCreds(c: Credentials): void {
  ensureDir()
  writeFileSync(CRED, JSON.stringify(c), { mode: 0o600 })
}

export function getToken(): TokenRecord | null {
  return readCreds()?.token ?? null
}
export function setToken(rec: TokenRecord): void {
  const c = readCreds() ?? {}
  c.token = rec
  writeCreds(c)
}
/** 退出:清 token。 */
export function clearCredentials(): void {
  try {
    rmSync(CRED)
  } catch {
    /* 不存在即忽略 */
  }
}
