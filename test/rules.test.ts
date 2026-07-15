import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { parseRules, matchRule, renderTemplate, eventContext, type Rule, type RuleEvent } from '../src/core/rules'

function rule(p: Partial<Rule> & { id: string }): Rule {
  return { id: p.id, on: p.on ?? ['*'], enabled: p.enabled ?? true, exec: p.exec ?? 'true', ...p }
}
const ev = (kind: RuleEvent['kind'], todo: Record<string, unknown> = {}): RuleEvent => ({ kind, todo })

test('parseRules: tolerant — bad json, non-array, actionless/invalid items dropped', () => {
  assert.deepEqual(parseRules('not json'), [])
  assert.deepEqual(parseRules('{"rules": {}}'), [])
  const parsed = parseRules(
    JSON.stringify({
      rules: [
        { id: 'a', on: ['completed'], exec: 'echo hi' }, // ok
        { id: 'b', on: ['added'] }, // no action → dropped
        { on: ['added'], exec: 'x' }, // no id → dropped
        { id: 'c', exec: 'x' }, // no on → dropped
        { id: 'd', on: ['deleted'], notify: { title: 't' }, enabled: false } // ok, disabled
      ]
    })
  )
  assert.deepEqual(parsed.map((r) => r.id), ['a', 'd'])
  assert.equal(parsed[0].enabled, true) // 缺省启用
  assert.equal(parsed[1].enabled, false)
})

test('matchRule: disabled never matches', () => {
  assert.equal(matchRule(ev('completed'), rule({ id: 'x', on: ['completed'], enabled: false })), false)
})

test('matchRule: on gates by event kind, * matches any', () => {
  assert.equal(matchRule(ev('completed'), rule({ id: 'x', on: ['completed'] })), true)
  assert.equal(matchRule(ev('added'), rule({ id: 'x', on: ['completed'] })), false)
  assert.equal(matchRule(ev('overdue'), rule({ id: 'x', on: ['*'] })), true)
  assert.equal(matchRule(ev('reminder'), rule({ id: 'x', on: ['completed', 'reminder'] })), true)
})

test('matchRule: filters are AND-ed; title_contains is case-insensitive', () => {
  const r = rule({ id: 'x', on: ['*'], match: { title_contains: '跑步', category: '健身', priority: 'high' } })
  assert.equal(matchRule(ev('completed', { title: '晨间跑步', category: '健身', priority: 'high' }), r), true)
  assert.equal(matchRule(ev('completed', { title: '游泳', category: '健身', priority: 'high' }), r), false) // 标题不含
  assert.equal(matchRule(ev('completed', { title: '跑步', category: '工作', priority: 'high' }), r), false) // 分类不符
  assert.equal(matchRule(ev('completed', { title: '跑步', category: '健身', priority: 'low' }), r), false) // 优先级不符

  const ci = rule({ id: 'y', on: ['*'], match: { title_contains: 'RUN' } })
  assert.equal(matchRule(ev('completed', { title: 'morning run' }), ci), true)
})

test('renderTemplate: {key} substitution, unknown → empty', () => {
  const ctx = eventContext(ev('completed', { title: '晨跑', category: '健身' }))
  assert.equal(renderTemplate('{event}: {title} [{category}]', ctx), 'completed: 晨跑 [健身]')
  assert.equal(renderTemplate('{nope}-{title}', ctx), '-晨跑')
})

test('eventContext: missing fields become empty strings', () => {
  const ctx = eventContext(ev('added', { title: 'x' }))
  assert.equal(ctx.title, 'x')
  assert.equal(ctx.category, '')
  assert.equal(ctx.priority, '')
  assert.equal(ctx.event, 'added')
})
