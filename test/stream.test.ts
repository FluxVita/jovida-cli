import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { parseStreams, validateStreamSpec, parseStreamLine } from '../src/core/stream'

test('parseStreams: tolerant — bad json / non-array / invalid items dropped; enabled default', () => {
  assert.deepEqual(parseStreams('nope'), [])
  assert.deepEqual(parseStreams('{"streams":{}}'), [])
  const parsed = parseStreams(
    JSON.stringify({
      streams: [
        { id: 'a', cmd: 'my-source --jsonl' }, // ok
        { id: 'b' }, // no cmd → dropped
        { cmd: 'x' }, // no id → dropped
        { id: 'c', cmd: 'tail -F log', source: 'app', type: 'error', enabled: false } // ok, disabled
      ]
    })
  )
  assert.deepEqual(parsed.map((s) => s.id), ['a', 'c'])
  assert.equal(parsed[0].enabled, true)
  assert.equal(parsed[1].enabled, false)
  assert.equal(parsed[1].source, 'app')
})

test('parseStreamLine: full envelope / defaults fill / bad line / missing source+type', () => {
  // 行自带完整信封
  assert.deepEqual(parseStreamLine('{"source":"x","type":"y","title":"z"}', {}), {
    source: 'x',
    type: 'y',
    title: 'z',
    id: undefined,
    at: undefined,
    data: undefined
  })
  // 行只带 payload,source/type 用 stream 缺省
  const e = parseStreamLine('{"title":"boom","data":{"k":1}}', { source: 'app', type: 'error' })
  assert.equal(e?.source, 'app')
  assert.equal(e?.type, 'error')
  assert.equal(e?.title, 'boom')
  assert.deepEqual(e?.data, { k: 1 })
  // 行里的 source 覆盖缺省
  assert.equal(parseStreamLine('{"source":"z","type":"t"}', { source: 'app', type: 'error' })?.source, 'z')
  // 坏行 / 非对象 / 空行 → null
  assert.equal(parseStreamLine('not json', {}), null)
  assert.equal(parseStreamLine('[1,2]', {}), null)
  assert.equal(parseStreamLine('   ', { source: 'a', type: 'b' }), null)
  // 补不齐 source+type → null
  assert.equal(parseStreamLine('{"title":"x"}', { source: 'app' }), null) // 缺 type
  assert.equal(parseStreamLine('{"type":"y"}', {}), null) // 缺 source
})

test('validateStreamSpec: valid object/string → normalized (id/enabled filled)', () => {
  const s = validateStreamSpec('{"cmd":"my-source --jsonl","source":"app","type":"error"}')
  assert.equal(s.cmd, 'my-source --jsonl')
  assert.equal(s.source, 'app')
  assert.ok(s.id.startsWith('str_'))
  assert.equal(s.enabled, true)
  const s2 = validateStreamSpec({ id: 'str_x', cmd: 'x', enabled: false, restart_sec: 10 })
  assert.equal(s2.id, 'str_x')
  assert.equal(s2.enabled, false)
  assert.equal(s2.restart_sec, 10)
})

test('validateStreamSpec: clear errors for bad input', () => {
  assert.throws(() => validateStreamSpec('not json'), /valid JSON/)
  assert.throws(() => validateStreamSpec('[]'), /JSON object/)
  assert.throws(() => validateStreamSpec('{"source":"app"}'), /needs "cmd"/)
  assert.throws(() => validateStreamSpec('{"cmd":"x","restart_sec":-1}'), /restart_sec/)
})
