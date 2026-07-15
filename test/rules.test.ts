import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  parseRules,
  matchRule,
  matchExpr,
  fieldByPath,
  parseWhen,
  renderTemplate,
  envToEnvVars,
  type Rule,
  type Envelope
} from '../src/core/rules'

function rule(p: Partial<Rule> & { id: string; when: string }): Rule {
  return { id: p.id, when: p.when, enabled: p.enabled ?? true, do: p.do ?? [{ exec: 'true' }], ...p }
}
const env = (source: string, type: string, extra: Partial<Envelope> = {}): Envelope => ({ source, type, ...extra })

test('parseWhen: "source.type" / "source.*" / "source" / object', () => {
  assert.deepEqual(parseWhen('todo.completed'), { source: 'todo', type: 'completed' })
  assert.deepEqual(parseWhen('weather.*'), { source: 'weather', type: '*' })
  assert.deepEqual(parseWhen('weather'), { source: 'weather' })
  assert.deepEqual(parseWhen({ source: 'claude', type: 'commit' }), { source: 'claude', type: 'commit' })
})

test('parseRules: tolerant — bad json, non-array, actionless/invalid items dropped; when normalized', () => {
  assert.deepEqual(parseRules('nope'), [])
  assert.deepEqual(parseRules('{"rules":{}}'), [])
  const parsed = parseRules(
    JSON.stringify({
      rules: [
        { id: 'a', when: 'todo.completed', do: [{ exec: 'echo hi' }] }, // ok
        { id: 'b', when: 'todo.added', do: [] }, // no action → dropped
        { when: 'x.y', do: [{ exec: 'x' }] }, // no id → dropped
        { id: 'c', do: [{ exec: 'x' }] }, // no when → dropped
        { id: 'd', when: { source: 'claude', type: 'commit' }, do: [{ notify: { title: 't' } }], enabled: false } // ok(object when), disabled
      ]
    })
  )
  assert.deepEqual(parsed.map((r) => r.id), ['a', 'd'])
  assert.equal(parsed[0].enabled, true)
  assert.equal(parsed[1].when, 'claude.commit') // object when → string
  assert.equal(parsed[1].enabled, false)
})

test('matchExpr: ~regex / =exact / substring', () => {
  assert.equal(matchExpr('feat(rules): x', '~^feat'), true)
  assert.equal(matchExpr('chore: x', '~^feat'), false)
  assert.equal(matchExpr('健身', '=健身'), true)
  assert.equal(matchExpr('健身房', '=健身'), false)
  assert.equal(matchExpr('morning RUN', 'run'), true) // 子串,不区分大小写
  assert.equal(matchExpr('anything', '~[bad'), false) // 坏正则 → false,不抛
})

test('fieldByPath: bare key falls through to data; dotted walks; today/tomorrow', () => {
  const e = env('todo', 'completed', { title: '晨跑', data: { category: '健身', city: 'HZ' } })
  assert.equal(fieldByPath(e, 'title'), '晨跑') // 顶层
  assert.equal(fieldByPath(e, 'category'), '健身') // 落 data
  assert.equal(fieldByPath(e, 'data.city'), 'HZ') // 显式路径
  assert.equal(fieldByPath(e, 'nope'), undefined)
  assert.match(String(fieldByPath(e, 'today')), /^\d{4}-\d{2}-\d{2}$/)
})

test('matchRule: disabled never matches', () => {
  assert.equal(matchRule(env('todo', 'completed'), rule({ id: 'x', when: 'todo.completed', enabled: false })), false)
})

test('matchRule: when gates by source.type; * / bare source = any type', () => {
  assert.equal(matchRule(env('todo', 'completed'), rule({ id: 'x', when: 'todo.completed' })), true)
  assert.equal(matchRule(env('todo', 'added'), rule({ id: 'x', when: 'todo.completed' })), false)
  assert.equal(matchRule(env('todo', 'added'), rule({ id: 'x', when: 'todo' })), true) // bare source
  assert.equal(matchRule(env('weather', 'rain'), rule({ id: 'x', when: 'weather.*' })), true)
  assert.equal(matchRule(env('claude', 'commit'), rule({ id: 'x', when: 'todo.*' })), false) // 源不符
})

test('matchRule: where filters AND-ed over envelope fields (top level + data)', () => {
  const r = rule({ id: 'x', when: 'todo.*', where: { title: '~跑步', category: '=健身' } })
  assert.equal(matchRule(env('todo', 'completed', { title: '晨间跑步', data: { category: '健身' } }), r), true)
  assert.equal(matchRule(env('todo', 'completed', { title: '游泳', data: { category: '健身' } }), r), false)
  assert.equal(matchRule(env('todo', 'completed', { title: '跑步', data: { category: '工作' } }), r), false)
})

test('renderTemplate: {field} {data.x} {today} substitution, unknown → empty', () => {
  const e = env('claude', 'commit', { title: 'feat: x', data: { city: 'HZ' } })
  assert.equal(renderTemplate('{source}.{type}: {title}', e), 'claude.commit: feat: x')
  assert.equal(renderTemplate('city={data.city} miss={nope}', e), 'city=HZ miss=')
  assert.match(renderTemplate('{today}', e), /^\d{4}-\d{2}-\d{2}$/)
})

test('envToEnvVars: top-level + data flattened + JOVIDA_DATA', () => {
  const vars = envToEnvVars(env('todo', 'completed', { title: '晨跑', id: 'e1', data: { category: '健身', entry_id: 'e1' } }))
  assert.equal(vars.JOVIDA_SOURCE, 'todo')
  assert.equal(vars.JOVIDA_TYPE, 'completed')
  assert.equal(vars.JOVIDA_TITLE, '晨跑')
  assert.equal(vars.JOVIDA_ID, 'e1')
  assert.equal(vars.JOVIDA_CATEGORY, '健身') // data 拍平
  assert.equal(vars.JOVIDA_ENTRY_ID, 'e1')
  assert.equal(JSON.parse(vars.JOVIDA_DATA).category, '健身')
})
