import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TodoEntry, TodoRecurring } from '../src/core/types'

// store.ts 在模块加载时从 JOVIDA_HOME 定 DIR,故必须在 import 前设好 env。
// 顶层 await 在 cjs 转译下不支持 → env 顶层设好,模块在 before 钩子里动态 import(那时 env 已就位)。
process.env.JOVIDA_HOME = mkdtempSync(join(tmpdir(), 'jovida-store-'))
let store: typeof import('../src/store')
before(async () => {
  store = await import('../src/store')
})

function entry(id: string, title = id): TodoEntry {
  return {
    entryId: id,
    title,
    description: '',
    category: '',
    priority: 'none',
    dueAt: 0,
    belongAt: 0,
    recurringId: '',
    occurrenceAt: 0,
    subtasks: [],
    reminder: null,
    completedAt: 0,
    createdAt: 1,
    updatedAt: 1,
    hint: ''
  }
}
function recurring(id: string): TodoRecurring {
  return {
    recurringId: id,
    title: id,
    description: '',
    category: '',
    priority: 'none',
    dueAt: 0,
    belongAt: 0,
    subtasks: [],
    reminder: null,
    repeat: { unit: 'day', interval: 1, weekdays: [], dayOfMonth: 0, monthOfYear: 0, endAt: 0 },
    createdAt: 1,
    updatedAt: 1
  }
}

test('empty store reads as null / version 0', () => {
  store.clearStore()
  assert.equal(store.readStore(), null)
  assert.equal(store.localServerVersion(), 0)
})

test('writeStore round-trips serverVersion + items, fresh age', () => {
  store.writeStore({ serverVersion: 5, entries: [entry('e1')], recurrings: [recurring('r1')] })
  const r = store.readStore()
  assert.ok(r)
  assert.equal(r.snap.serverVersion, 5)
  assert.equal(r.snap.entries.length, 1)
  assert.equal(r.snap.recurrings.length, 1)
  assert.ok(r.ageSecs >= 0 && r.ageSecs < 5)
  assert.equal(store.localServerVersion(), 5)
})

test('applyUpsert updates existing, appends new, advances version', () => {
  store.writeStore({ serverVersion: 5, entries: [entry('e1', 'old')], recurrings: [] })
  store.applyUpsert({ entries: [entry('e1', 'new'), entry('e2')] }, 6)
  const r = store.readStore()
  assert.ok(r)
  assert.equal(r.snap.serverVersion, 6)
  assert.equal(r.snap.entries.length, 2)
  assert.equal(r.snap.entries.find((e) => e.entryId === 'e1')?.title, 'new')
  assert.ok(r.snap.entries.some((e) => e.entryId === 'e2'))
})

test('applyUpsert on empty store is a no-op (next read re-pulls)', () => {
  store.clearStore()
  store.applyUpsert({ entries: [entry('e1')] }, 9)
  assert.equal(store.readStore(), null) // 无本地 → 不凭空造,等下次全量拉
})

test('applyUpsert upserts recurrings by recurringId', () => {
  store.writeStore({ serverVersion: 1, entries: [], recurrings: [recurring('r1')] })
  store.applyUpsert({ recurrings: [recurring('r1'), recurring('r2')] }, 2)
  const r = store.readStore()
  assert.ok(r)
  assert.equal(r.snap.recurrings.length, 2)
  assert.equal(r.snap.serverVersion, 2)
})

test('clearStore removes local snapshot', () => {
  store.writeStore({ serverVersion: 3, entries: [entry('e1')], recurrings: [] })
  store.clearStore()
  assert.equal(store.readStore(), null)
  rmSync(process.env.JOVIDA_HOME as string, { recursive: true, force: true })
})
