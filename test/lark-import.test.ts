import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  larkEntryId,
  isLarkEntryId,
  larkGuidOf,
  larkTaskCompletedAtSec,
  splitSummary,
  mapLarkTask,
  larkFieldsChanged,
  newEntryFromLark,
  type LarkTask
} from '../src/core/lark-import'
import { secToBelongDate } from '../src/core/convert'

const GUID = '841eeb68-d81e-432e-83e2-e86eb49623c8'

test('lark entry id round-trips and is recognizable', () => {
  const id = larkEntryId(GUID)
  assert.equal(id, `lark_${GUID}`)
  assert.equal(isLarkEntryId(id), true)
  assert.equal(isLarkEntryId('cli_01ABC'), false)
  assert.equal(larkGuidOf(id), GUID)
})

test('splitSummary: first non-empty line becomes the single-line title, rest preserved', () => {
  const { title, rest } = splitSummary('\n  @知北(董书瑾)  \n换 key\n第三行')
  assert.equal(title, '@知北(董书瑾)')
  assert.equal(rest, '换 key\n第三行')
  assert.equal(splitSummary('').title, '(untitled)')
  assert.equal(splitSummary('单行任务').rest, '')
})

test('all-day due maps to a date-only todo on the local day of the UTC-midnight stamp', () => {
  // 2026-06-06 00:00 UTC(飞书全天 due 的存法)
  const t: LarkTask = { guid: GUID, summary: 'x', due: { is_all_day: true, timestamp: '1780704000000' } }
  const m = mapLarkTask(t)
  assert.equal(m.dueAt, 0)
  assert.ok(m.belongAt > 0)
  // 本地(UTC+8 及以东)应落在 6/6;其余时区按「时间戳的本地日」——与飞书 app 展示一致
  assert.equal(secToBelongDate(m.belongAt), secToBelongDate(1780704000))
})

test('timed due maps to an exact deadline with derived belong day', () => {
  const t: LarkTask = { guid: GUID, summary: 'x', due: { is_all_day: false, timestamp: '1782111600000' } }
  const m = mapLarkTask(t)
  assert.equal(m.dueAt, 1782111600)
  assert.equal(secToBelongDate(m.belongAt), secToBelongDate(1782111600))
})

test('no due maps to an undated todo; description composes rest + lark desc + url', () => {
  const t: LarkTask = {
    guid: GUID,
    summary: '标题\n补充说明',
    description: '飞书描述',
    url: 'https://applink.feishu.cn/x',
    created_at: '1780401516192'
  }
  const m = mapLarkTask(t)
  assert.equal(m.dueAt, 0)
  assert.equal(m.belongAt, 0)
  assert.equal(m.title, '标题')
  assert.equal(m.description, '补充说明\n飞书描述\nhttps://applink.feishu.cn/x')
  assert.equal(m.createdAt, 1780401516)
})

test('completedAt parses ms string, "0" means incomplete', () => {
  assert.equal(larkTaskCompletedAtSec({ guid: GUID, completed_at: '0' }), 0)
  assert.equal(larkTaskCompletedAtSec({ guid: GUID, completed_at: '1782111880577' }), 1782111880)
  assert.equal(larkTaskCompletedAtSec({ guid: GUID }), 0)
})

test('change detection only looks at import-owned fields', () => {
  const m = mapLarkTask({ guid: GUID, summary: '标题' })
  const entry = newEntryFromLark(m, '飞书', 1000)
  assert.equal(larkFieldsChanged(entry, m), false)
  // 用户在 Jovida 侧改优先级/提醒不算漂移
  assert.equal(larkFieldsChanged({ ...entry, priority: 'high' }, m), false)
  // 飞书侧改了标题要追平
  assert.equal(larkFieldsChanged(entry, { ...m, title: '新标题' }), true)
})

test('newEntryFromLark: pending, categorized, lark created_at kept, now as fallback', () => {
  const m = mapLarkTask({ guid: GUID, summary: 'x', created_at: '1780401516192' })
  const e = newEntryFromLark(m, '飞书', 999)
  assert.equal(e.completedAt, 0)
  assert.equal(e.category, '飞书')
  assert.equal(e.createdAt, 1780401516)
  assert.equal(e.updatedAt, 999)
  const noCreated = newEntryFromLark(mapLarkTask({ guid: GUID, summary: 'x' }), '飞书', 999)
  assert.equal(noCreated.createdAt, 999)
})
