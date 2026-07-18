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
  validateRuleSpec,
  buildCreateArgv,
  buildCompleteArgv,
  isEventStale,
  EMIT_TTL_SEC,
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

test('validateRuleSpec: valid object/string → normalized rule (id/enabled filled)', () => {
  const r = validateRuleSpec('{"when":"claude.commit","where":{"title":"~^feat"},"do":[{"exec":"echo hi"}]}')
  assert.equal(r.when, 'claude.commit')
  assert.ok(r.id.startsWith('rul_'))
  assert.equal(r.enabled, true)
  assert.deepEqual(r.where, { title: '~^feat' })
  // object when + explicit id/enabled preserved
  const r2 = validateRuleSpec({ id: 'rul_x', when: { source: 'todo', type: 'completed' }, enabled: false, do: [{ notify: { title: 't' } }] })
  assert.equal(r2.id, 'rul_x')
  assert.equal(r2.when, 'todo.completed')
  assert.equal(r2.enabled, false)
})

test('validateRuleSpec: clear errors for bad input', () => {
  assert.throws(() => validateRuleSpec('not json'), /valid JSON/)
  assert.throws(() => validateRuleSpec('[]'), /JSON object/)
  assert.throws(() => validateRuleSpec('{"do":[{"exec":"x"}]}'), /needs "when"/)
  assert.throws(() => validateRuleSpec('{"when":"todo.completed"}'), /at least one action/)
  assert.throws(() => validateRuleSpec('{"when":"todo.completed","do":[{"exec":"x"}],"where":[]}'), /"where" must be/)
})

test('parseRules / validateRuleSpec: create & complete actions accepted', () => {
  const parsed = parseRules(
    JSON.stringify({
      rules: [
        { id: 'a', when: 'claude.commit', do: [{ create: { title: 'PR {title}', when: '{today}', priority: 'high' } }] },
        { id: 'b', when: 'x.done', do: [{ complete: { id: '{data.entry_id}' } }] },
        { id: 'c', when: 'x.y', do: [{ create: { when: '{today}' } }] } // create 无 title → 该动作无效 → 无动作 → 整条丢弃
      ]
    })
  )
  assert.deepEqual(parsed.map((r) => r.id), ['a', 'b'])
  assert.ok('create' in parsed[0].do[0])
  const r = validateRuleSpec('{"when":"claude.commit","do":[{"create":{"title":"x"}}]}')
  assert.ok('create' in r.do[0])
})

test('buildCreateArgv: templated, omits empty optionals, argv-safe (no shell)', () => {
  const e = env('claude', 'commit', { title: 'feat: 带"引号"; 和分号', data: { entry_id: 'e1' } })
  const argv = buildCreateArgv({ title: 'PR：{title}', when: '{today}', priority: 'high' }, e)
  assert.equal(argv[0], 'create')
  assert.equal(argv[1], 'PR：feat: 带"引号"; 和分号') // 引号/分号作为单个 argv 元素,安全
  assert.match(argv[argv.indexOf('--when') + 1], /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(argv[argv.indexOf('--priority') + 1], 'high')
  assert.equal(argv.includes('--category'), false) // 未给 → 不加
  // 只有 title(其余省略)
  assert.deepEqual(buildCreateArgv({ title: '仅标题' }, e), ['create', '仅标题'])
})

test('buildCompleteArgv: templated id', () => {
  const e = env('x', 'done', { id: 'ent_9', data: { entry_id: 'ent_9' } })
  assert.deepEqual(buildCompleteArgv({ id: '{id}' }, e), ['complete', 'ent_9'])
  assert.deepEqual(buildCompleteArgv({ id: '{data.entry_id}' }, e), ['complete', 'ent_9'])
})

test('isEventStale: drops events older than TTL; keeps fresh; no-at never stale', () => {
  const now = 1_000_000
  assert.equal(EMIT_TTL_SEC, 3600) // 默认 1h
  assert.equal(isEventStale({ source: 's', type: 't', at: now - 100 }, now), false) // 新鲜
  assert.equal(isEventStale({ source: 's', type: 't', at: now - 4000 }, now), true) // 超 1h
  assert.equal(isEventStale({ source: 's', type: 't' }, now), false) // 无 at → 宁触发不误弃
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
