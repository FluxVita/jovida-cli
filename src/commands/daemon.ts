// jovida daemon start|stop|status|restart|run — 常驻推送守护的生命周期管理。
// run 是前台工作体(start 自我 detach 后跑的就是它,也可手动前台跑调试)。
import type { Ctx } from '../ctx'
import { runDaemon, startDaemon, stopDaemon, statusDaemon, DAEMON_LOG_FILE } from '../daemon'

export interface DaemonArgs {
  action?: string // start | stop | status | restart | run
  json?: boolean
}

function printStatus(json: boolean): void {
  const { running, status } = statusDaemon()
  if (json) {
    console.log(JSON.stringify({ running, ...(status ? { status } : {}) }))
    return
  }
  if (!running || !status) {
    console.log('○ daemon not running')
    return
  }
  const conn = status.connected ? 'connected' : 'disconnected'
  const due = status.overdue || status.upcoming ? `${status.overdue} overdue · ${status.upcoming} upcoming` : 'nothing due'
  // 自动化装载:规则 + 三类源(poll/stream 计数),都非零才各自显示,保持单行简洁
  const autos = [status.rules && `${status.rules} rules`, status.polls && `${status.polls} polls`, status.streams && `${status.streams} streams`]
    .filter(Boolean)
    .join(' · ')
  console.log(`● running · pid ${status.pid} · ${conn} · store v=${status.storeVersion} · ${due}${autos ? ' · ' + autos : ''}`)
}

export async function cmdDaemon(ctx: Ctx, a: DaemonArgs): Promise<void> {
  const action = a.action ?? 'status'
  switch (action) {
    case 'run':
      // 前台阻塞直到 SIGINT/SIGTERM。未登录等错误由外层 catch 处理(非 0 退出,不留活 pid)。
      await runDaemon(ctx)
      return
    case 'start': {
      const r = await startDaemon()
      if (a.json) console.log(JSON.stringify({ ok: r.ok, pid: r.pid, message: r.message }))
      else console.log(`${r.ok ? '✓' : '✗'} ${r.message}`)
      if (!r.ok) process.exitCode = 3
      return
    }
    case 'stop': {
      const r = await stopDaemon()
      if (a.json) console.log(JSON.stringify({ ok: r.ok, message: r.message }))
      else console.log(`${r.ok ? '✓' : '○'} ${r.message}`)
      return
    }
    case 'restart': {
      await stopDaemon()
      const r = await startDaemon()
      if (a.json) console.log(JSON.stringify({ ok: r.ok, pid: r.pid, message: r.message }))
      else console.log(`${r.ok ? '✓' : '✗'} ${r.message}`)
      if (!r.ok) process.exitCode = 3
      return
    }
    case 'status':
      printStatus(a.json === true)
      return
    default:
      throw new Error(`unknown daemon action: ${action} (use start|stop|status|restart|run; log: ${DAEMON_LOG_FILE})`)
  }
}
