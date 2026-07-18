import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { validateDispatchSpec, buildTaskFromDispatch } from '../src/core/task'
import { parseRules, validateRuleSpec, type Envelope } from '../src/core/rules'

const env = (extra: Partial<Envelope> = {}): Envelope => ({ source: 'todo', type: 'added', ...extra })

test('validateDispatchSpec: requires prompt; keeps optional fields', () => {
  const d = validateDispatchSpec('{"prompt":"do X","cwd":"/w","todo_id":"e1","agent":"claude -p"}')
  assert.equal(d.prompt, 'do X')
  assert.equal(d.cwd, '/w')
  assert.equal(d.todo_id, 'e1')
  assert.equal(d.agent, 'claude -p')
  assert.throws(() => validateDispatchSpec('{"cwd":"/w"}'), /needs "prompt"/)
  assert.throws(() => validateDispatchSpec('nope'), /valid JSON/)
})

test('buildTaskFromDispatch: templates prompt/cwd/todo_id; queued; source set; empty prompt throws', () => {
  const e = env({ title: '重构鉴权', data: { entry_id: 'cli_9', description: '去掉旧分支' } })
  const t = buildTaskFromDispatch({ prompt: '完成：{title} —— {data.description}', todo_id: '{data.entry_id}' }, e, 'rul_abc', 123)
  assert.equal(t.prompt, '完成：重构鉴权 —— 去掉旧分支')
  assert.equal(t.todo_id, 'cli_9')
  assert.equal(t.status, 'queued')
  assert.equal(t.source, 'rul_abc')
  assert.equal(t.created_at, 123)
  assert.ok(t.id.startsWith('tsk_'))
  // prompt 渲染成空 → 抛(避免派空任务)
  assert.throws(() => buildTaskFromDispatch({ prompt: '{nope}' }, e, 'r', 1), /rendered empty/)
})

test('parseRules / validateRuleSpec: dispatch action accepted (needs prompt)', () => {
  const parsed = parseRules(
    JSON.stringify({
      rules: [
        { id: 'a', when: 'todo.added', do: [{ dispatch: { prompt: '做 {title}' } }] },
        { id: 'b', when: 'x.y', do: [{ dispatch: { cwd: '/w' } }] } // 无 prompt → 动作无效 → 无动作 → 丢弃
      ]
    })
  )
  assert.deepEqual(parsed.map((r) => r.id), ['a'])
  assert.ok('dispatch' in parsed[0].do[0])
  const r = validateRuleSpec('{"when":"todo.added","do":[{"dispatch":{"prompt":"go"}}]}')
  assert.ok('dispatch' in r.do[0])
})
