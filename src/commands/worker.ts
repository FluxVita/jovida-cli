// jovida worker — 常驻串行 agent worker 的生命周期 + 配置(#8)。run 是前台工作体(start detach 后跑的就是它)。
import { runWorker, startWorker, stopWorker, statusWorker, WORKER_LOG_FILE } from '../worker'
import { loadWorkerConfig, saveWorkerConfig, WORKER_CONFIG_FILE, WORKSPACE_DIR, type WorkerConfig } from '../core/task'

export interface WorkerArgs {
  action?: string // start | stop | status | restart | run | config
  agentCmd?: string // config: agent 命令(sh -c 模板;prompt 走 $JOVIDA_TASK_PROMPT + stdin)
  cwd?: string // config: 缺省工作目录
  timeout?: number // config: 单任务超时秒
  json?: boolean
}

function printStatus(json: boolean): void {
  const { running, status } = statusWorker()
  const cfg = loadWorkerConfig()
  if (json) {
    console.log(JSON.stringify({ running, config: cfg, ...(status ? { status } : {}) }))
    return
  }
  if (!running || !status) {
    console.log(`○ worker not running${cfg.agent_cmd ? '' : ' · no agent_cmd configured (jovida worker config --agent-cmd …)'}`)
    return
  }
  const agent = status.agentConfigured ? 'agent configured' : 'NO agent_cmd (idle-fails tasks)'
  console.log(`● running · pid ${status.pid} · ${agent} · queue: ${status.queued} queued, ${status.running} running, ${status.done} done, ${status.failed} failed`)
}

export async function cmdWorker(a: WorkerArgs): Promise<void> {
  const action = a.action ?? 'status'
  const json = a.json === true

  switch (action) {
    case 'run':
      await runWorker()
      return
    case 'start': {
      const r = await startWorker()
      if (json) console.log(JSON.stringify({ ok: r.ok, pid: r.pid, message: r.message }))
      else console.log(`${r.ok ? '✓' : '✗'} ${r.message}`)
      if (!r.ok) process.exitCode = 3
      return
    }
    case 'stop': {
      const r = await stopWorker()
      if (json) console.log(JSON.stringify({ ok: r.ok, message: r.message }))
      else console.log(`${r.ok ? '✓' : '○'} ${r.message}`)
      return
    }
    case 'restart': {
      await stopWorker()
      const r = await startWorker()
      if (json) console.log(JSON.stringify({ ok: r.ok, pid: r.pid, message: r.message }))
      else console.log(`${r.ok ? '✓' : '✗'} ${r.message}`)
      if (!r.ok) process.exitCode = 3
      return
    }
    case 'status':
      printStatus(json)
      return
    case 'config': {
      const cur = loadWorkerConfig()
      const touched = a.agentCmd !== undefined || a.cwd !== undefined || a.timeout !== undefined
      if (!touched) {
        // 只看
        if (json) console.log(JSON.stringify({ config: cur, file: WORKER_CONFIG_FILE, defaultCwd: WORKSPACE_DIR }))
        else {
          console.log(`worker config (${WORKER_CONFIG_FILE}):`)
          console.log(`  agent_cmd: ${cur.agent_cmd ?? '(unset — worker will fail tasks until set)'}`)
          console.log(`  cwd:       ${cur.cwd ?? `(default ${WORKSPACE_DIR})`}`)
          console.log(`  timeout:   ${cur.timeout_sec ?? 1800}s`)
          console.log(`\nset it, e.g.:  jovida worker config --agent-cmd 'claude -p "$JOVIDA_TASK_PROMPT"' --cwd ~/agent-workspace`)
        }
        return
      }
      const next: WorkerConfig = { ...cur }
      if (a.agentCmd !== undefined) next.agent_cmd = a.agentCmd
      if (a.cwd !== undefined) next.cwd = a.cwd
      if (a.timeout !== undefined && a.timeout > 0) next.timeout_sec = a.timeout
      saveWorkerConfig(next)
      if (json) console.log(JSON.stringify({ saved: next }))
      else console.log(`✓ worker config saved\n  agent_cmd: ${next.agent_cmd ?? '(unset)'}\n  cwd:       ${next.cwd ?? `(default ${WORKSPACE_DIR})`}\n(a running worker picks it up on the next task)`)
      return
    }
    default:
      throw new Error(`unknown worker action: ${action} (use start|stop|status|restart|run|config; log: ${WORKER_LOG_FILE})`)
  }
}
