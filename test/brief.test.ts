import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { computeDue } from '../src/core/due'
import { renderBrief } from '../src/core/brief'
import type { TodoEntry } from '../src/core/types'

const HOUR = 3600
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
const report = (entries: TodoEntry[]) => computeDue({ entries, recurrings: [], nowSec: now, withinSecs: 24 * HOUR, todayStart })

const ESC = String.fromCharCode(27)

test('nothing due → empty string (statusline shows nothing)', () => {
  assert.equal(renderBrief(report([]), now), '')
})

test('overdue + upcoming → 🐰 line with count and next time', () => {
  const r = report([
    entry({ entryId: 'past', title: 'pay rent', dueAt: now - HOUR }),
    entry({ entryId: 'soon', title: 'call mom', dueAt: now + 2 * HOUR })
  ])
  // 14:00 = now(12:00)+2h
  assert.equal(renderBrief(r, now), '🐰 1 overdue · 14:00 call mom')
})

test('plain has no escape sequences; ansi adds color codes; link wraps in OSC 8', () => {
  const r = report([entry({ entryId: 'soon', title: 't', dueAt: now + 2 * HOUR })])
  const plain = renderBrief(r, now, {})
  assert.ok(!plain.includes(ESC), 'plain must be escape-free (used as agent-hook context)')

  const ansi = renderBrief(r, now, { ansi: true })
  assert.ok(ansi.includes(`${ESC}[33m`), 'time painted yellow')

  const linked = renderBrief(r, now, { link: true })
  assert.ok(linked.startsWith(`${ESC}]8;;https://jovida.ai${ESC}\\`), 'OSC 8 hyperlink opener')
  assert.ok(linked.endsWith(`${ESC}]8;;${ESC}\\`), 'OSC 8 hyperlink closer')
})

test('multiple upcoming collapse to first + "+N"', () => {
  const r = report([
    entry({ entryId: 'a', title: 'first', dueAt: now + 1 * HOUR }),
    entry({ entryId: 'b', title: 'second', dueAt: now + 2 * HOUR }),
    entry({ entryId: 'c', title: 'third', dueAt: now + 3 * HOUR })
  ])
  assert.equal(renderBrief(r, now), '🐰 13:00 first +2')
})
