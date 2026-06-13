import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  seriesOccursOn,
  seriesOccurrencesInRange,
  occurrenceId,
  parseOccurrenceId,
  occurrenceToEntry,
  ymdFromSec,
  expandRecurring,
  type YMD
} from '../src/core/recurrence'
import { belongDateToSec, secToBelongDate } from '../src/core/convert'
import type { RepeatUnit, TodoRecurring } from '../src/core/types'

const DAY = 86400

function series(seedKey: string, repeat: Partial<TodoRecurring['repeat']> & { unit: RepeatUnit }, dueIso?: string): TodoRecurring {
  return {
    recurringId: 'rid1',
    title: 'standup',
    description: '',
    category: 'work',
    priority: 'none',
    dueAt: dueIso ? Math.floor(Date.parse(dueIso) / 1000) : 0,
    belongAt: belongDateToSec(seedKey),
    subtasks: [],
    reminder: null,
    repeat: {
      unit: repeat.unit,
      interval: repeat.interval ?? 1,
      weekdays: repeat.weekdays ?? [],
      dayOfMonth: repeat.dayOfMonth ?? 0,
      monthOfYear: repeat.monthOfYear ?? 0,
      endAt: repeat.endAt ?? 0
    },
    createdAt: 0,
    updatedAt: 0
  }
}
const ymd = (s: string): YMD => {
  const [y, m, d] = s.split('-').map(Number)
  return { y, m, d }
}

test('daily interval respects the seed-anchored cadence', () => {
  const s = series('2026-06-01', { unit: 'day', interval: 2 })
  assert.equal(seriesOccursOn(s, ymd('2026-06-01')), true)
  assert.equal(seriesOccursOn(s, ymd('2026-06-02')), false)
  assert.equal(seriesOccursOn(s, ymd('2026-06-03')), true)
  assert.equal(seriesOccursOn(s, ymd('2026-05-31')), false) // before seed
})

test('weekly matches the byWeekdays set', () => {
  const s = series('2026-06-01', { unit: 'week', weekdays: [1, 3, 5] }) // Mon Wed Fri
  assert.equal(seriesOccursOn(s, ymd('2026-06-01')), true) // Mon
  assert.equal(seriesOccursOn(s, ymd('2026-06-02')), false) // Tue
  assert.equal(seriesOccursOn(s, ymd('2026-06-03')), true) // Wed
  assert.equal(seriesOccursOn(s, ymd('2026-06-05')), true) // Fri
})

test('weekly interval counts Monday-aligned weeks; empty weekdays => seed weekday', () => {
  const s = series('2026-06-01', { unit: 'week', interval: 2 }) // seed Mon
  assert.equal(seriesOccursOn(s, ymd('2026-06-01')), true)
  assert.equal(seriesOccursOn(s, ymd('2026-06-08')), false) // next Mon, skipped
  assert.equal(seriesOccursOn(s, ymd('2026-06-15')), true) // 2nd Mon
})

test('monthly clamps an overflowing day to month-end', () => {
  const s = series('2026-01-31', { unit: 'month', dayOfMonth: 31 })
  assert.equal(seriesOccursOn(s, ymd('2026-01-31')), true)
  assert.equal(seriesOccursOn(s, ymd('2026-02-28')), true) // Feb clamps to 28
  assert.equal(seriesOccursOn(s, ymd('2026-02-27')), false)
  assert.equal(seriesOccursOn(s, ymd('2026-04-30')), true) // Apr clamps to 30
})

test('yearly does NOT clamp (leap-day skips non-leap years)', () => {
  const s = series('2024-02-29', { unit: 'year', dayOfMonth: 29, monthOfYear: 2 })
  assert.equal(seriesOccursOn(s, ymd('2024-02-29')), true)
  assert.equal(seriesOccursOn(s, ymd('2025-02-28')), false) // non-leap => no occurrence
  assert.equal(seriesOccursOn(s, ymd('2028-02-29')), true)
})

test('endAt is an inclusive day-granular cutoff', () => {
  const s = series('2026-06-01', { unit: 'day', endAt: belongDateToSec('2026-06-03') })
  assert.equal(seriesOccursOn(s, ymd('2026-06-03')), true)
  assert.equal(seriesOccursOn(s, ymd('2026-06-04')), false)
})

test('occurrencesInRange enumerates both ends inclusive', () => {
  const occ = seriesOccurrencesInRange(series('2026-06-01', { unit: 'day' }), belongDateToSec('2026-06-01'), belongDateToSec('2026-06-07'))
  assert.equal(occ.length, 7)
})

test('occurrence id is deterministic and round-trips', () => {
  const occSec = belongDateToSec('2026-06-03')
  const id = occurrenceId('rid1', occSec)
  const p = parseOccurrenceId(id)
  assert.equal(p?.recurringId, 'rid1')
  assert.equal(p?.occurrenceSec, occSec)
  assert.equal(parseOccurrenceId('cli_123'), null)
  const ent = occurrenceToEntry(series('2026-06-01', { unit: 'day' }), ymd('2026-06-03'))
  assert.equal(ent.entryId, id) // occurrenceToEntry uses the same id generator
  assert.equal(ent.occurrenceAt, occSec)
})

test('occurrence inherits the series time-of-day as its due time', () => {
  const s = series('2026-06-01', { unit: 'day' }, '2026-06-01T09:30:00+08:00')
  const ent = occurrenceToEntry(s, ymd('2026-06-03'))
  const dt = new Date(ent.dueAt * 1000)
  assert.equal(dt.getHours(), 9)
  assert.equal(dt.getMinutes(), 30)
})

// ---- expandRecurring orchestration (relative to "today", so stable any run day) ----
function startOfTodaySec(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return Math.floor(d.getTime() / 1000)
}
const todayStart = startOfTodaySec()
const tomorrowStart = todayStart + DAY
const todayKey = secToBelongDate(todayStart)
// seed in the past so a daily series occurs every day including today
const pastSeed = secToBelongDate(todayStart - 10 * DAY)
const daily = series(pastSeed, { unit: 'day' })
const base = {
  recurrings: [daily],
  todayStart,
  tomorrowStart,
  rangeFrom: todayStart,
  rangeTo: Number.POSITIVE_INFINITY,
  horizonDays: 90,
  collapseHorizonDays: 1830
}

test('expand today => one occurrence, dated today, flagged', () => {
  const v = expandRecurring({ ...base, realEntries: [], scope: 'today', status: 'pending' })
  assert.equal(v.length, 1)
  assert.equal(secToBelongDate(v[0].belongAt), todayKey)
  assert.equal(v[0].recurringId, 'rid1')
})

test('expand dedups against a forked occurrence (open or completed)', () => {
  const fork = occurrenceToEntry(daily, ymd(todayKey))
  assert.equal(expandRecurring({ ...base, realEntries: [fork], scope: 'today', status: 'pending' }).length, 0)
  const done = { ...fork, completedAt: todayStart + 100 }
  assert.equal(expandRecurring({ ...base, realEntries: [done], scope: 'today', status: 'pending' }).length, 0)
})

test('expand range full-expands every occurrence in the window', () => {
  const v = expandRecurring({ ...base, realEntries: [], scope: 'range', rangeFrom: todayStart, rangeTo: todayStart + 6 * DAY + DAY - 1, status: 'pending' })
  assert.equal(v.length, 7)
})

test('expand upcoming collapses to the next occurrence (tomorrow)', () => {
  const v = expandRecurring({ ...base, realEntries: [], scope: 'upcoming', status: 'pending' })
  assert.equal(v.length, 1)
  assert.equal(secToBelongDate(v[0].belongAt), secToBelongDate(tomorrowStart))
})

test('expand upcoming skips a completed fork and surfaces the day after', () => {
  const forkTom = { ...occurrenceToEntry(daily, ymdFromSec(tomorrowStart)), completedAt: tomorrowStart + 100 }
  const v = expandRecurring({ ...base, realEntries: [forkTom], scope: 'upcoming', status: 'pending' })
  assert.equal(v.length, 1)
  assert.equal(secToBelongDate(v[0].belongAt), secToBelongDate(tomorrowStart + DAY))
})

test('expand upcoming suppresses virtual when an open fork already covers it', () => {
  const forkTom = occurrenceToEntry(daily, ymdFromSec(tomorrowStart)) // open
  assert.equal(expandRecurring({ ...base, realEntries: [forkTom], scope: 'upcoming', status: 'pending' }).length, 0)
})

test('expand all collapses from today; recent and completed-status expand nothing', () => {
  assert.equal(expandRecurring({ ...base, realEntries: [], scope: 'all', status: 'pending' }).length, 1)
  assert.equal(expandRecurring({ ...base, realEntries: [], scope: 'recent', status: 'all' }).length, 0)
  assert.equal(expandRecurring({ ...base, realEntries: [], scope: 'today', status: 'completed' }).length, 0)
})
