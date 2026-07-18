// 同步原语:在线读改写(put/get snapshot + OCC)。CLI storeless,无本地库/对账。
// 走后端 v2 统一对象接口:数据装在 TodoItemDataset.items(以 itemType 判别 entry/recurring)。
// 请求形与后端一致:PUT={ dataset:{items}, baseServerVersion };GET={ expectedServerVersion, pageToken, snapshotToken };均 proto3-JSON。
import { ApiClient, ApiError } from './api'
import { writeStore, clearStore, localServerVersion, applyUpsert } from './store'
import {
  entryToItem,
  recurringToItem,
  itemToEntry,
  itemToRecurring,
  itemIsRecurringRule,
  type GetSnapshotResponse
} from './core/proto'
import type { TodoEntry, TodoRecurring } from './core/types'

const PUT = '/jov/todo/v2/put_todo_snapshot'
const GET = '/jov/todo/v2/get_todo_snapshot'
const DELETE = '/jov/todo/v2/delete_todo_item'
const VERSION = '/jov/todo/v2/get_todo_version'
const MAX_CONFLICT = 3 // put 409(落后)→pull→重试
const MAX_EXPIRED = 3 // get 409(分页快照过期)→首页重拉

export interface Snapshot {
  entries: TodoEntry[]
  recurrings: TodoRecurring[]
  serverVersion: number
}

export class SyncClient {
  constructor(private api: ApiClient) {}

  /** 轻量版本探测(get_todo_version):只回一个版本号。给 `due` 的过期缓存续期用,免掉无谓的全量拉取。 */
  async getServerVersion(): Promise<number> {
    const r = await this.api.post<{ serverVersion?: string | number }>(VERSION, {})
    return r.serverVersion != null ? Number(r.serverVersion) : 0
  }

  /** 全量拉取(CLI storeless:每次强制全量,expectedServerVersion=0)。处理分页 + 409 SNAPSHOT_EXPIRED 重拉。 */
  async pull(): Promise<Snapshot> {
    for (let attempt = 0; attempt < MAX_EXPIRED; attempt++) {
      const r = await this.pullOnce()
      if (r) {
        writeStore(r) // 全量落本地库:推进 serverVersion + 覆盖为完整快照
        return r
      }
    }
    throw new Error('snapshot kept expiring during pagination')
  }

  private async pullOnce(): Promise<Snapshot | null> {
    const entries: TodoEntry[] = []
    const recurrings: TodoRecurring[] = []
    let pageToken = ''
    let snapshotToken = ''
    let serverVersion = 0
    for (;;) {
      let resp: GetSnapshotResponse
      try {
        resp = await this.api.post<GetSnapshotResponse>(GET, {
          expectedServerVersion: '0', // 强制全量(storeless 无本地副本可省传)
          pageToken,
          snapshotToken
        })
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) return null // SNAPSHOT_EXPIRED → 外层重拉
        throw e
      }
      serverVersion = resp.serverVersion != null ? Number(resp.serverVersion) : serverVersion
      if (!snapshotToken && resp.snapshotToken) snapshotToken = resp.snapshotToken
      for (const o of resp.dataset?.items ?? []) {
        if (itemIsRecurringRule(o)) recurrings.push(itemToRecurring(o))
        else entries.push(itemToEntry(o)) // 单态 + 发生态都映回 TodoEntry
      }
      if (!resp.hasMore || !resp.nextPageToken) break
      pageToken = resp.nextPageToken
    }
    return { entries, recurrings, serverVersion }
  }

  /** upsert entries。409 SYNC_CONFLICT → pull 追平版本 → 重试;成功乐观并入本地库。 */
  async putEntries(items: TodoEntry[]): Promise<void> {
    for (let attempt = 0; attempt <= MAX_CONFLICT; attempt++) {
      try {
        const r = await this.api.post<{ serverVersion?: string | number }>(PUT, {
          dataset: { items: items.map(entryToItem) },
          baseServerVersion: String(localServerVersion())
        })
        applyUpsert({ entries: items }, r.serverVersion != null ? Number(r.serverVersion) : localServerVersion())
        return
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && attempt < MAX_CONFLICT) {
          await this.pull() // 追平本地版本后重试
          continue
        }
        throw e
      }
    }
  }

  /** upsert 循环「类」(recurrings)。409 SYNC_CONFLICT → pull 追平 → 重试;成功乐观并入本地库。 */
  async putRecurrings(items: TodoRecurring[]): Promise<void> {
    for (let attempt = 0; attempt <= MAX_CONFLICT; attempt++) {
      try {
        const r = await this.api.post<{ serverVersion?: string | number }>(PUT, {
          dataset: { items: items.map(recurringToItem) },
          baseServerVersion: String(localServerVersion())
        })
        applyUpsert({ recurrings: items }, r.serverVersion != null ? Number(r.serverVersion) : localServerVersion())
        return
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && attempt < MAX_CONFLICT) {
          await this.pull()
          continue
        }
        throw e
      }
    }
  }

  // 逐条删除(无 OCC 门控;对未知 id 幂等)。服务端为全局软删(写 deleted_at),但对客户端透明:
  // 快照过滤掉已删行,删除契约仍是「快照中缺失 ⇒ 已删」;同 id 再 put 会就地复活(覆盖、清 deleted_at)。
  // delete 无版本回执,无法乐观推进本地版本 → 清本地库,下次读全量拉一次(delete 低频,可接受)。
  async deleteObjects(ids: string[]): Promise<void> {
    for (const itemId of ids) await this.api.post(DELETE, { itemId })
    if (ids.length) clearStore()
  }
}
