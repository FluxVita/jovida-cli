import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { computeDue } from '../src/core/due'
import { belongDateToSec, secToBelongDate } from '../src/core/convert'
import type { Reminder, TodoEntry, TodoRecurring } from '../src/core/types'

const DAY = 86400
const HOUR = 3600

// 相对「今天」构造(与 recurrence.test 同法),任何一天跑都稳定。now 固定在今天中午。
function startOfTodaySec(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return Math.floor(d.getTime() / 1000)
}
const todayStart = startOfTodaySec()
const now = todayStart + 12 * HOUR

function entry(p: Partial<TodoEntry> & { entryId: string }): TodoEntry {
  return {
    title: p.entryId,
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
    createdAt: 0,
    updatedAt: 0,
    hint: '',
    ...p
  }
}
function reminder(offsetSecs: number[], enabled?: boolean): Reminder {
  return { id: 'rem1', canAlarm: true, offsetSecs, ...(enabled === undefined ? {} : { enabled }) }
}

const compute = (entries: TodoEntry[], recurrings: TodoRecurring[] = [], withinSecs = 24 * HOUR) =>
  computeDue({ entries, recurrings, nowSec: now, withinSecs, todayStart })

test('classifies overdue vs upcoming vs out-of-window by the reminder anchor', () => {
  const r = compute([
    entry({ entryId: 'past', dueAt: now - HOUR }),
    entry({ entryId: 'soon', dueAt: now + 2 * HOUR }),
    entry({ entryId: 'far', dueAt: now + 48 * HOUR }), // beyond window
    entry({ entryId: 'dateless' }) // no due/belong => not on the radar
  ])
  assert.deepEqual(r.overdue.map((i) => i.entry.entryId), ['past'])
  assert.deepEqual(r.upcoming.map((i) => i.entry.entryId), ['soon'])
})

test('completed items never surface', () => {
  const r = compute([entry({ entryId: 'done', dueAt: now - HOUR, completedAt: now - 10 })])
  assert.equal(r.overdue.length + r.upcoming.length, 0)
})

test('a date-only todo is due by end of its day, not at midnight start', () => {
  const today = entry({ entryId: 'today', belongAt: todayStart })
  const yesterday = entry({ entryId: 'yest', belongAt: todayStart - DAY })
  const r = compute([today, yesterday])
  assert.deepEqual(r.overdue.map((i) => i.entry.entryId), ['yest']) // anchor = yesterday 24:00 < now
  assert.deepEqual(r.upcoming.map((i) => i.entry.entryId), ['today']) // anchor = tonight 24:00, in window
  assert.equal(r.upcoming[0].anchorAt, todayStart + DAY)
})

test('a reminder firing inside the window surfaces an item whose deadline is outside it', () => {
  // due in 30h (outside 24h window) but reminded 26h ahead => fires at now+4h
  const e = entry({ entryId: 'remindme', dueAt: now + 30 * HOUR, reminder: reminder([26 * HOUR]) })
  const r = compute([e])
  assert.equal(r.upcoming.length, 1)
  assert.equal(r.upcoming[0].nextAt, now + 4 * HOUR)
  assert.equal(r.upcoming[0].nextIsReminder, true)
})

test('a disabled reminder (enabled=false) does not fire', () => {
  const e = entry({ entryId: 'muted', dueAt: now + 30 * HOUR, reminder: reminder([26 * HOUR], false) })
  const r = compute([e])
  assert.equal(r.upcoming.length, 0)
})

test('nextAt picks the earliest in-window time and sorts upcoming by it', () => {
  const a = entry({ entryId: 'a', dueAt: now + 6 * HOUR, reminder: reminder([HOUR]) }) // reminder at +5h
  const b = entry({ entryId: 'b', dueAt: now + 3 * HOUR })
  const r = compute([a, b])
  assert.deepEqual(r.upcoming.map((i) => i.entry.entryId), ['b', 'a'])
  assert.equal(r.upcoming[1].nextAt, now + 5 * HOUR)
  assert.equal(r.upcoming[1].nextIsReminder, true)
})

test('overdue sorts oldest first', () => {
  const r = compute([entry({ entryId: 'new', dueAt: now - HOUR }), entry({ entryId: 'old', dueAt: now - 5 * HOUR })])
  assert.deepEqual(r.overdue.map((i) => i.entry.entryId), ['old', 'new'])
})

test("a daily routine contributes today's occurrence (due by end of day)", () => {
  const daily: TodoRecurring = {
    recurringId: 'rid1',
    title: 'standup',
    description: '',
    category: '',
    priority: 'none',
    dueAt: 0,
    belongAt: belongDateToSec(secToBelongDate(todayStart - 10 * DAY)), // seeded in the past
    subtasks: [],
    reminder: null,
    repeat: { unit: 'day', interval: 1, weekdays: [], dayOfMonth: 0, monthOfYear: 0, endAt: 0 },
    createdAt: 0,
    updatedAt: 0
  }
  const r = compute([], [daily])
  assert.equal(r.upcoming.length, 1)
  assert.equal(r.upcoming[0].entry.recurringId, 'rid1')
  assert.equal(r.upcoming[0].anchorAt, todayStart + DAY)
  // a completed fork of today's occurrence silences it
  const fork = { ...r.upcoming[0].entry, completedAt: now - 10 }
  const r2 = compute([fork], [daily])
  assert.equal(r2.upcoming.length, 0)
})
