// jovida task — agent worker 的任务队列:手动入队 + 查看 + 清理(#8)。执行在常驻 worker(见 ../worker.ts)。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  newTaskId,
  writeTask,
  readTasks,
  readTask,
  clearFinishedTasks,
  TASKS_DIR,
  type Task
} from '../core/task'

export interface TaskArgs {
  action?: string // add | list | show | clear
  positionals: string[] // add: prompt; show: id
  cwd?: string
  todo?: string // 关联待办 id
  agent?: string // 覆盖 agent 命令
  json?: boolean
}

const STATUS_MARK: Record<Task['status'], string> = { queued: '◦', running: '▶', done: '✓', failed: '✗' }

function taskLine(t: Task): string {
  const age = t.finished_at ? `${t.finished_at - t.created_at}s` : ''
  return `${STATUS_MARK[t.status]} ${t.id}  [${t.status}${t.exit_code !== undefined && t.status === 'failed' ? ' exit ' + t.exit_code : ''}]${age ? ' ' + age : ''}\n    ${t.prompt.split('\n')[0].slice(0, 90)}${t.todo_id ? `\n    ↳ todo ${t.todo_id}` : ''}`
}

function tailLog(id: string, lines: number): string | null {
  try {
    const text = readFileSync(join(TASKS_DIR, `${id}.log`), 'utf8')
    const all = text.split('\n')
    return all.slice(Math.max(0, all.length - lines)).join('\n').trim()
  } catch {
    return null
  }
}

export function cmdTask(a: TaskArgs): void {
  const action = a.action ?? 'list'
  const json = a.json === true

  switch (action) {
    case 'add': {
      const prompt = a.positionals.join(' ').trim()
      if (!prompt) throw new Error('add needs a prompt: jovida task add "<instruction for the agent>"')
      const task: Task = {
        id: newTaskId(),
        prompt,
        cwd: a.cwd,
        agent: a.agent,
        todo_id: a.todo,
        source: 'manual',
        created_at: Math.floor(Date.now() / 1000),
        status: 'queued'
      }
      writeTask(task)
      if (json) console.log(JSON.stringify({ added: task }))
      else console.log(`✓ queued task ${task.id}\n    ${prompt.split('\n')[0].slice(0, 90)}\n(a running worker will pick it up; start one: jovida worker start)`)
      return
    }

    case 'list': {
      const tasks = readTasks()
      if (json) {
        console.log(JSON.stringify({ tasks, dir: TASKS_DIR }))
        return
      }
      if (tasks.length === 0) {
        console.log(`no tasks. queue one:\n  jovida task add "重构 X 模块并跑测试"\nor from a rule:\n  jovida rules add --when todo.added --where category==agent --dispatch "完成这个待办：{title}"`)
        return
      }
      for (const t of tasks) console.log(taskLine(t))
      return
    }

    case 'show': {
      const id = a.positionals[0]
      if (!id) throw new Error('show needs a task id (see: jovida task list)')
      const t = readTask(id)
      if (!t) throw new Error(`no task matching id: ${id}`)
      const log = tailLog(t.id, 40)
      if (json) {
        console.log(JSON.stringify({ task: t, log }))
        return
      }
      console.log(taskLine(t))
      if (t.cwd) console.log(`    cwd: ${t.cwd}`)
      if (t.source) console.log(`    source: ${t.source}`)
      console.log(log ? `\n--- log (last 40 lines) ---\n${log}` : '\n(no log yet)')
      return
    }

    case 'clear': {
      const n = clearFinishedTasks()
      if (json) console.log(JSON.stringify({ cleared: n }))
      else console.log(`✓ cleared ${n} finished task(s)`)
      return
    }

    default:
      throw new Error(`unknown task action: ${action} (use add|list|show|clear)`)
  }
}
