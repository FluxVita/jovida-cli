// 本地待办快照库:~/.jovida/cli/store.json(经 JOVIDA_HOME 覆盖)。
// 取代旧的 snapshot-cache.json——把「due 私有的尽力而为缓存」升级成所有读命令共享的、
// 版本门控的一等本地快照。契约是**全量替换**(同步协议无 delta),故本地永远是「某个
// serverVersion 的完整快照」,不存在部分更新的中间态——这正是本地化在这套协议下低风险的原因。
//
// 仍是尽力而为存储:读写失败一律静默当「无本地」(下次读会重新全量拉)。写路径(put)严格 OCC,
// 写成功即 base 当时最新,故可**乐观**地把本次 upsert 并入本地并推进版本(applyUpsert);
// delete 无版本回执,直接清库,下次读重拉一次即可。
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import type { TodoEntry, TodoRecurring } from './core/types'

const DIR = process.env['JOVIDA_HOME'] ?? join(homedir(), '.jovida', 'cli')
const STORE = join(DIR, 'store.json')

/** 一份完整快照(某个 serverVersion 下的全部 entries + recurrings)。 */
export interface StoredSnapshot {
  serverVersion: number
  entries: TodoEntry[]
  recurrings: TodoRecurring[]
}

interface StoreFile extends StoredSnapshot {
  syncedAt: number // 写入 Unix 秒(新鲜度判定用)
}

const nowSec = (): number => Math.floor(Date.now() / 1000)

function ensureDir(): void {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true, mode: 0o700 })
}

function readFile(): StoreFile | null {
  try {
    const f = JSON.parse(readFileSync(STORE, 'utf8')) as StoreFile
    if (!f || typeof f.syncedAt !== 'number' || typeof f.serverVersion !== 'number') return null
    if (!Array.isArray(f.entries) || !Array.isArray(f.recurrings)) return null
    return f
  } catch {
    return null
  }
}

function writeFile(f: StoreFile): void {
  try {
    ensureDir()
    writeFileSync(STORE, JSON.stringify(f), { mode: 0o600 })
  } catch {
    /* 尽力而为:写不进不影响命令,下次读重拉 */
  }
}

/** 读本地快照(带存活秒数;新鲜度判定交给调用方)。 */
export function readStore(): { snap: StoredSnapshot; ageSecs: number } | null {
  const f = readFile()
  if (!f) return null
  const age = nowSec() - f.syncedAt
  if (age < 0) return null // 时钟回拨:当作无缓存
  return { snap: { serverVersion: f.serverVersion, entries: f.entries, recurrings: f.recurrings }, ageSecs: age }
}

/** 全量落库(pull 后调用)——覆盖本地为该 serverVersion 的完整快照。 */
export function writeStore(snap: StoredSnapshot): void {
  writeFile({ ...snap, syncedAt: nowSec() })
}

/** 版本没变、只续新鲜期(探测命中时用):重盖 syncedAt,数据不动。 */
export function touchStore(): void {
  const f = readFile()
  if (f) writeFile({ ...f, syncedAt: nowSec() })
}

/** 清空本地快照(登出/换号/delete 后:不留旧数据)。 */
export function clearStore(): void {
  try {
    rmSync(STORE)
  } catch {
    /* 不存在即忽略 */
  }
}

/** put 的 base 版本:本地已知的 serverVersion(无本地=0,服务端会按需回全量)。 */
export function localServerVersion(): number {
  return readFile()?.serverVersion ?? 0
}

/**
 * 写成功后的乐观更新:把本次 upsert 的 entries/recurrings 就地并入本地,并把版本推进到服务端回执值。
 * 依据严格 OCC——put 成功 ⟹ 本次 base 就是当时服务端最新 ⟹ 本地(=base 快照)+本次 upsert 即新一致态。
 * 无本地则跳过(下次读会全量拉);为空 upsert(仅版本推进)也照常刷版本。
 */
export function applyUpsert(
  upsert: { entries?: TodoEntry[]; recurrings?: TodoRecurring[] },
  newServerVersion: number
): void {
  const f = readFile()
  if (!f) return
  const entries = f.entries.slice()
  const recurrings = f.recurrings.slice()
  for (const e of upsert.entries ?? []) {
    const i = entries.findIndex((x) => x.entryId === e.entryId)
    if (i >= 0) entries[i] = e
    else entries.push(e)
  }
  for (const s of upsert.recurrings ?? []) {
    const i = recurrings.findIndex((x) => x.recurringId === s.recurringId)
    if (i >= 0) recurrings[i] = s
    else recurrings.push(s)
  }
  writeFile({ serverVersion: newServerVersion, entries, recurrings, syncedAt: nowSec() })
}
