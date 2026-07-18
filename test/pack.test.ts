import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { validateBundle, reidBundle, buildBundle, bundleCounts, isValidPackName } from '../src/core/pack'

const RULE = { when: 'weather.rain', do: [{ exec: 'jovida create "带伞"' }] }
const POLL = { source: 'weather', type: 'rain', check: 'grep -qi rain', interval: '30m' }
const STREAM = { cmd: 'my-source --jsonl', source: 'app', type: 'error' }

test('validateBundle: validates each section, fills ids/name', () => {
  const b = validateBundle(JSON.stringify({ name: 'kit', description: 'x', rules: [RULE], polls: [POLL], streams: [STREAM] }))
  assert.equal(b.name, 'kit')
  assert.equal(b.description, 'x')
  assert.equal(b.rules?.length, 1)
  assert.ok(b.rules?.[0].id.startsWith('rul_'))
  assert.equal(b.polls?.[0].interval_sec, 1800) // "30m" 归一
  assert.ok(b.streams?.[0].id.startsWith('str_'))
})

test('validateBundle: empty / missing sections → empty arrays; default name', () => {
  const b = validateBundle('{}')
  assert.equal(b.name, 'imported')
  assert.deepEqual(b.rules, [])
  assert.deepEqual(b.polls, [])
  assert.deepEqual(b.streams, [])
})

test('validateBundle: clear errors point at the bad item', () => {
  assert.throws(() => validateBundle('nope'), /valid JSON/)
  assert.throws(() => validateBundle('[]'), /JSON object/)
  assert.throws(() => validateBundle('{"rules":{}}'), /"rules" must be an array/)
  assert.throws(() => validateBundle(JSON.stringify({ rules: [{ do: [{ exec: 'x' }] }] })), /rules\[0\].*needs "when"/)
  assert.throws(() => validateBundle(JSON.stringify({ polls: [POLL, { source: 'w', type: 'r' }] })), /polls\[1\].*check/)
})

test('reidBundle: every def gets a fresh id (source.type bindings untouched)', () => {
  const b = validateBundle(JSON.stringify({ name: 'k', rules: [RULE], polls: [POLL], streams: [STREAM] }))
  const before = { r: b.rules?.[0].id, p: b.polls?.[0].id, s: b.streams?.[0].id }
  const re = reidBundle(b)
  assert.notEqual(re.rules?.[0].id, before.r)
  assert.notEqual(re.polls?.[0].id, before.p)
  assert.notEqual(re.streams?.[0].id, before.s)
  assert.equal(re.rules?.[0].when, 'weather.rain') // 绑定不变
  assert.equal(re.polls?.[0].source, 'weather')
})

test('buildBundle: omits empty sections', () => {
  const b = buildBundle('n', undefined, { rules: [], polls: [{ id: 'pol_1', source: 'w', type: 'r', check: 'x', interval_sec: 60, enabled: true }], streams: [] })
  assert.equal(b.rules, undefined)
  assert.equal(b.streams, undefined)
  assert.equal(b.polls?.length, 1)
  assert.deepEqual(bundleCounts(b), { rules: 0, polls: 1, streams: 0 })
})

test('isValidPackName: safe filenames only', () => {
  assert.equal(isValidPackName('rain-umbrella'), true)
  assert.equal(isValidPackName('my_kit.v2'), true)
  assert.equal(isValidPackName('..'), false)
  assert.equal(isValidPackName('a/b'), false)
  assert.equal(isValidPackName('has space'), false)
  assert.equal(isValidPackName(''), false)
})
