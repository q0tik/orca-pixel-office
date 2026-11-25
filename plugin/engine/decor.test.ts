import { assert, test } from 'orca/testing'
import { MAX_SHEETS, noticeCounts, paperSheets } from './locations'

test('the paper stack grows with real time at work, up to a limit; none without a start time', () => {
  const now = 10 * 3_600_000
  assert.equal(paperSheets(null, now), 0)
  assert.equal(paperSheets(now - 60_000, now), 1)
  assert.equal(paperSheets(now - 9 * 60_000, now), 3)
  assert.equal(paperSheets(now - 5 * 3_600_000, now), MAX_SHEETS)
})

test('the notice board counts bots at the owner door and bots at work, from their real state', () => {
  const counts = noticeCounts([
    { state: 'working' },
    { state: 'working', needsYou: 2 },
    { state: 'blocked' },
    { state: 'waiting' },
    { state: 'done', needsYou: 1 },
    { state: 'idle' },
    { state: 'done', failed: true }
  ])
  assert.deepEqual(counts, { waiting: 3, working: 2 })
  assert.deepEqual(noticeCounts([]), { waiting: 0, working: 0 })
})
