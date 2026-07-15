// 桌面通知(守护用)。零 npm 依赖、全程尽力而为——通知失败绝不影响守护主循环。
//
// 图标/名字:osascript 的 `display notification` 只能挂在「脚本编辑器」名下,图标改不了。
// 故 mac 上直接 exec 一份自带的 terminal-notifier(assets/,arm64,随包分发,用户零安装):
//   -sender 借用已装的 Jovida 桌面 app 的图标+名字(点通知还能唤起它),
//   -contentImage 挂自带的 jovida.png(没装桌面 app 时的品牌兜底)。
// 自带二进制跑不了(Intel Mac / 被 Gatekeeper 拦)或缺失 → 回退 osascript(图标是系统脚本图标,功能仍在)。
import { join } from 'node:path'
import { execFile } from 'node:child_process'

export interface Notification {
  title: string
  subtitle?: string
  message: string
}

// 借用哪个已装 app 的身份(图标/名字/点击唤起)。默认 Jovida Daily;可用环境变量覆盖。
const SENDER = process.env['JOVIDA_NOTIFY_SENDER'] || 'ai.jovida.desktop'
// 自带资源:dist/notify.js 运行时 __dirname=dist,资源在包根 assets/。
const TN_BIN = join(__dirname, '..', 'assets', 'terminal-notifier.app', 'Contents', 'MacOS', 'terminal-notifier')
const ICON = join(__dirname, '..', 'assets', 'jovida.png')

// AppleScript 字符串字面量转义:反斜杠与双引号。
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** 回退:osascript 内置通知(图标为系统脚本图标,无法自定义)。 */
function notifyOsascript(n: Notification): void {
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

/** 弹一条系统通知。best-effort:非 macOS 一律静默;优先自带 terminal-notifier(Jovida 图标),失败回退 osascript。 */
export function notify(n: Notification): void {
  if (process.platform !== 'darwin') return // win/linux 暂缓
  const args = ['-title', n.title, '-message', n.message, '-sender', SENDER, '-contentImage', ICON]
  if (n.subtitle) args.push('-subtitle', n.subtitle)
  try {
    execFile(TN_BIN, args, (err) => {
      // 自带二进制缺失/跑不了(ENOENT/ENOEXEC/非 0)→ 回退 osascript。
      if (err) notifyOsascript(n)
    })
  } catch {
    notifyOsascript(n)
  }
}
