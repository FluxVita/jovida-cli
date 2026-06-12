import { spawn } from 'node:child_process'

/** 尽力在系统浏览器打开 URL；失败静默（headless 服务器无浏览器属正常）。返回是否尝试成功派生进程。 */
export function tryOpenBrowser(url: string): boolean {
  try {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}
