// 版本门控的快照读取:所有读命令(list/view/due)与写命令的「读那一半」共用的入口。
// 把原先 due 私有的 loadSnapshot 提升到这里,统一「本地新鲜直读 / 过期探版本 / 变了才全量拉」。
import type { Ctx } from './ctx'
import type { Snapshot } from './sync'
import { readStore, touchStore } from './store'

// 读命令默认新鲜期:300s 内直读本地,超过才花一个 get_todo_version 探测。--fresh 可强制拉取。
export const DEFAULT_READ_TTL = 300

export interface LoadOpts {
  ttlSecs?: number // 新鲜期;0 = 每次都探版本
  fresh?: boolean // 跳过本地,强制全量拉
}

/**
 * 读路径:本地新鲜(age ≤ ttl)直接用;否则 ensureSession 后探版本——没变就续新鲜期用本地,
 * 变了(或无本地)才全量 pull。ensureSession 只在「要碰网」时才调,保住 due --brief 的低开销。
 */
export async function loadSnapshot(ctx: Ctx, opts: LoadOpts = {}): Promise<{ snap: Snapshot; ageSecs: number }> {
  const ttl = opts.ttlSecs ?? DEFAULT_READ_TTL
  const stored = opts.fresh ? null : readStore()
  if (stored && stored.ageSecs <= ttl) return { snap: stored.snap, ageSecs: stored.ageSecs }

  await ctx.session.ensureSession()
  if (stored) {
    try {
      if ((await ctx.sync.getServerVersion()) === stored.snap.serverVersion) {
        touchStore() // 版本没变:续新鲜期,继续用本地
        return { snap: stored.snap, ageSecs: 0 }
      }
    } catch {
      /* 探测失败(网络抖动)→ 落回全量拉,该抛的错由 pull 抛 */
    }
  }
  return { snap: await ctx.sync.pull(), ageSecs: 0 } // pull 内部刷新本地库
}

/**
 * 写路径的读那一半:写必须联网(ensureSession 必走),但版本探测是**尽力而为**——
 * 探到变了就先 pull 追平再改;探测失败(断网等)不阻塞,直接用本地,put 的严格 OCC 会兜底(409→pull→重试)。
 * 无本地则全量 pull 打底。
 */
export async function loadForWrite(ctx: Ctx): Promise<Snapshot> {
  await ctx.session.ensureSession()
  const stored = readStore()
  if (!stored) return ctx.sync.pull()
  try {
    if ((await ctx.sync.getServerVersion()) !== stored.snap.serverVersion) {
      return await ctx.sync.pull() // 服务端已变 → 拿最新再改
    }
  } catch {
    /* 探测失败 → 不阻塞,用本地;冲突交给 put OCC */
  }
  return stored.snap
}
