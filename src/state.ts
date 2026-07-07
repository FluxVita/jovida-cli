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

/** 写盘失败(沙箱 home 不可写最常见)→ 转成可执行指引,而非裸 EACCES。 */
function writeError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e)
  return new Error(
    `cannot write to data dir ${DIR} (${msg}). ` +
      `If this is a sandbox where the home directory isn't writable or persistent, ` +
      `set JOVIDA_HOME to a writable directory and retry — e.g.  JOVIDA_HOME="$PWD/.jovida" jovida login`
  )
}

function ensureDir(): void {
  try {
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true, mode: 0o700 })
  } catch (e) {
    throw writeError(e)
  }
}

/**
 * 登录前确认数据目录可写。沙箱里 `~` 常不可写 → 提前报错(带 JOVIDA_HOME 指引),
 * 免得用户在浏览器批准之后才在写 token 那一刻失败、白批准一轮。
 */
export function ensureWritable(): void {
  ensureDir()
  const probe = join(DIR, '.write-probe')
  try {
    writeFileSync(probe, '')
    rmSync(probe)
  } catch (e) {
    throw writeError(e)
  }
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
  try {
    writeFileSync(STATE, JSON.stringify(s, null, 2))
  } catch (e) {
    throw writeError(e)
  }
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

// ---- 快照缓存(`jovida due` 的高频轮询用;statusline/hook 每回合都调,不能每次全量 pull) ----
// 尽力而为:读写失败一律静默当无缓存。写路径(put/delete)成功后由 sync 失效,防状态栏显示已完成的旧项。
const SNAP_CACHE = join(DIR, 'snapshot-cache.json')

interface SnapCacheFile {
  at: number // 写入 Unix 秒
  payload: unknown
}

/** 读缓存(带存活秒数,新鲜度判定交给调用方——过期缓存还可经版本探测续期,不在这里丢弃)。 */
export function readSnapshotCache<T>(): { payload: T; ageSecs: number } | null {
  const c = readJson<SnapCacheFile>(SNAP_CACHE)
  if (!c || typeof c.at !== 'number') return null
  const age = Math.floor(Date.now() / 1000) - c.at
  if (age < 0) return null
  return { payload: c.payload as T, ageSecs: age }
}

export function writeSnapshotCache(payload: unknown): void {
  try {
    ensureDir()
    writeFileSync(SNAP_CACHE, JSON.stringify({ at: Math.floor(Date.now() / 1000), payload }), { mode: 0o600 })
  } catch {
    /* 缓存尽力而为,写不进不影响命令本身 */
  }
}

export function invalidateSnapshotCache(): void {
  try {
    rmSync(SNAP_CACHE)
  } catch {
    /* 不存在即忽略 */
  }
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
  try {
    writeFileSync(CRED, JSON.stringify(c), { mode: 0o600 })
  } catch (e) {
    throw writeError(e)
  }
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
