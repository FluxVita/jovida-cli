import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  parseInterval,
  parsePolls,
  validatePollSpec,
  isRisingEdge,
  buildPollEnvelope,
  type PollSource
} from '../src/core/poll'

const poll = (p: Partial<PollSource> = {}): PollSource => ({
  id: 'pol_x',
  source: 'weather',
  type: 'rain',
  check: 'true',
  interval_sec: 1800,
  enabled: true,
  ...p
})

test('parseInterval: 30s / 5m / 1h / bare seconds; rejects garbage', () => {
  assert.equal(parseInterval('30s'), 30)
  assert.equal(parseInterval('5m'), 300)
  assert.equal(parseInterval('1h'), 3600)
  assert.equal(parseInterval('45'), 45) // 纯数字 = 秒
  assert.throws(() => parseInterval('0'), /must be like/)
  assert.throws(() => parseInterval('5x'), /must be like/)
  assert.throws(() => parseInterval('abc'), /must be like/)
})

test('parsePolls: tolerant — bad json / non-array / invalid items dropped; enabled default', () => {
  assert.deepEqual(parsePolls('nope'), [])
  assert.deepEqual(parsePolls('{"polls":{}}'), [])
  const parsed = parsePolls(
    JSON.stringify({
      polls: [
        { id: 'a', source: 'weather', type: 'rain', check: 'x', interval_sec: 60 }, // ok
        { id: 'b', source: 'weather', type: 'rain', check: 'x' }, // no interval → dropped
        { id: 'c', type: 'rain', check: 'x', interval_sec: 60 }, // no source → dropped
        { source: 'w', type: 'r', check: 'x', interval_sec: 60 }, // no id → dropped
        { id: 'd', source: 'ci', type: 'broken', check: 'x', interval_sec: 300, enabled: false } // ok, disabled
      ]
    })
  )
  assert.deepEqual(parsed.map((p) => p.id), ['a', 'd'])
  assert.equal(parsed[0].enabled, true)
  assert.equal(parsed[1].enabled, false)
})

test('isRisingEdge: only false/undefined → true fires', () => {
  assert.equal(isRisingEdge(undefined, true), true) // 首次观测即成立 → 发
  assert.equal(isRisingEdge(false, true), true) // false→true 上升沿
  assert.equal(isRisingEdge(true, true), false) // 持续成立 → 不重复发
  assert.equal(isRisingEdge(true, false), false) // 下降沿 → 只复位
  assert.equal(isRisingEdge(false, false), false)
  assert.equal(isRisingEdge(undefined, false), false)
})

test('buildPollEnvelope: stdout → data.output; title falls to first line then name', () => {
  const e = buildPollEnvelope(poll({ name: '杭州降雨' }), 'Light rain\n17°C\n', 123)
  assert.equal(e.source, 'weather')
  assert.equal(e.type, 'rain')
  assert.equal(e.title, 'Light rain') // check stdout 首行
  assert.equal(e.id, 'pol_x')
  assert.equal(e.at, 123)
  assert.equal(e.data?.output, 'Light rain\n17°C')
  assert.equal(e.data?.poll_id, 'pol_x')
  assert.equal(e.data?.poll, '杭州降雨')

  const explicit = buildPollEnvelope(poll({ title: '带伞' }), 'whatever', 1)
  assert.equal(explicit.title, '带伞') // 显式 title 优先
  const noOut = buildPollEnvelope(poll({ name: 'n' }), '', 1)
  assert.equal(noOut.title, 'n') // 无 stdout → 源名
})

test('validatePollSpec: valid object/string → normalized (id/enabled filled, interval parsed)', () => {
  const p = validatePollSpec('{"source":"weather","type":"rain","check":"grep -qi rain","interval":"30m"}')
  assert.equal(p.source, 'weather')
  assert.equal(p.type, 'rain')
  assert.equal(p.interval_sec, 1800) // "30m" → 秒
  assert.ok(p.id.startsWith('pol_'))
  assert.equal(p.enabled, true)
  // interval_sec 数字 + 显式 id/enabled 保留
  const p2 = validatePollSpec({ id: 'pol_y', source: 'ci', type: 'broken', check: 'x', interval_sec: 300, enabled: false })
  assert.equal(p2.id, 'pol_y')
  assert.equal(p2.interval_sec, 300)
  assert.equal(p2.enabled, false)
})

test('validatePollSpec: clear errors for bad input', () => {
  assert.throws(() => validatePollSpec('not json'), /valid JSON/)
  assert.throws(() => validatePollSpec('[]'), /JSON object/)
  assert.throws(() => validatePollSpec('{"type":"rain","check":"x","interval":"5m"}'), /needs "source"/)
  assert.throws(() => validatePollSpec('{"source":"w","check":"x","interval":"5m"}'), /needs "type"/)
  assert.throws(() => validatePollSpec('{"source":"w","type":"r","interval":"5m"}'), /needs "check"/)
  assert.throws(() => validatePollSpec('{"source":"w","type":"r","check":"x"}'), /interval/)
})
