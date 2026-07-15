// 桌面通知(守护用)。零依赖:macOS 走内置 osascript,别的平台暂无声(不报错)。
// 全部尽力而为——通知失败绝不影响守护主循环。
import { execFile } from 'node:child_process'

export interface Notification {
  title: string
  subtitle?: string
  message: string
}

// AppleScript 字符串字面量转义:反斜杠与双引号。控制字符不进通知文本,无需处理。
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** 弹一条系统通知。best-effort:非 macOS 或 osascript 缺失/失败一律静默。 */
export function notify(n: Notification): void {
  if (process.platform !== 'darwin') return
  let script = `display notification "${esc(n.message)}" with title "${esc(n.title)}"`
  if (n.subtitle) script += ` subtitle "${esc(n.subtitle)}"`
  try {
    execFile('osascript', ['-e', script], () => {
      /* 尽力而为:忽略退出码/错误 */
    })
  } catch {
    /* spawn 失败也静默 */
  }
}
