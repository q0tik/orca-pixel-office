import { assert, test } from 'orca/testing'
import { realMap } from './fixtures'
import { chatClouds, CHAT_TURN_MS, EVENT_HOLD_MS, Life, modeFor, seededRandom, stopsOf } from './life'
import { planTargets, type Target } from './locations'
import { assignBotSeats } from './seating'
import { findPath } from './path'

function bases(states: Record<string, 'working' | 'blocked' | 'waiting' | 'done' | 'idle'>, extra: Record<string, { needsYou?: number; failed?: boolean }> = {}) {
  const world = realMap()
  const { seats } = assignBotSeats(Object.keys(states), world.desks, {}, {}, () => 0)
  return planTargets(world, Object.entries(states).map(([key, state]) => ({ key, state, desk: seats.get(key) ?? null, ...extra[key] })))
}

/** Steps a life through `ms` of time in 250 ms ticks; returns every target each bot had. */
function run(life: Life, base: Map<string, Target>, from: number, ms: number): Map<string, Target[]> {
  const seen = new Map<string, Target[]>()
  for (let t = from; t <= from + ms; t += 250) {
    if (t < life.nextAt() && t !== from) continue
    for (const [k, target] of life.plan(base, t)) seen.set(k, [...(seen.get(k) ?? []), target])
  }
  return seen
}

test('the routine follows the status: rest for done/idle, the door for waiting, none at work or after a failure', () => {
  const t = bases({ a: 'working', b: 'done', c: 'idle', d: 'waiting', e: 'blocked', f: 'done', g: 'idle' }, { f: { needsYou: 2 }, g: { failed: true } })
  assert.equal(modeFor(t.get('a')!), null, 'working stays at the desk')
  assert.equal(modeFor(t.get('b')!), 'rest')
  assert.equal(modeFor(t.get('c')!), 'rest')
  assert.equal(modeFor(t.get('d')!), 'wait')
  assert.equal(modeFor(t.get('e')!), 'wait')
  assert.equal(modeFor(t.get('f')!), 'wait', 'Needs you: to the owner door, with the sign')
  assert.equal(modeFor(t.get('g')!), null, 'a failed turn keeps the bot under its «!»')
})

test('resting bots visit shared places only; waiting ones stay in the reception near the owner door', () => {
  const world = realMap()
  const stops = stopsOf(world)
  const roomOf = (x: number, y: number) => world.rooms.find((r) => r.id === world.roomAt[y * world.width + x])!
  const doing = new Set(stops.rest.map((s) => s.doing))
  for (const thing of ['у кофемашины', 'у кулера', 'смотрит на рыбок', 'у книжного шкафа', 'смотрит в окно', 'сидит на диване']) assert.ok(doing.has(thing), thing)
  for (const s of stops.rest) assert.ok(['lounge', 'reception', 'corridor'].includes(roomOf(s.x, s.y).kind), `${s.doing} in a shared room`)
  const door = world.doors.find((d) => d.owner)!
  for (const s of stops.wait) {
    assert.equal(roomOf(s.x, s.y).kind, 'reception')
    assert.ok(Math.abs(s.x - door.x) + Math.abs(s.y - door.y) <= 9, 'not far from the door (the aquarium is the farthest)')
  }
  // Every stop can be walked to from the lounge.
  const sofa = world.spots.find((s) => s.kind === 'sofa')!
  for (const s of [...stops.rest, ...stops.wait]) assert.ok(findPath(world, sofa, s), `${s.doing} (${s.x},${s.y}) reachable`)
})

test('bots on a routine move between stops over time, never two on one tile, and only their own mode', () => {
  const world = realMap()
  const base = bases({ a: 'done', b: 'idle', c: 'done', w: 'waiting', x: 'working' })
  const life = new Life(world, seededRandom(42))
  const first = life.plan(base, 0)
  for (const [k, t] of first) assert.deepEqual([t.x, t.y], [base.get(k)!.x, base.get(k)!.y], 'no run on open: everyone starts at the real place')
  const seen = run(life, base, 0, 10 * 60_000)
  const stops = stopsOf(world)
  const restTiles = new Set(stops.rest.map((s) => `${s.x},${s.y}`))
  const waitTiles = new Set(stops.wait.map((s) => `${s.x},${s.y}`))
  for (const k of ['a', 'b', 'c']) {
    const tiles = new Set(seen.get(k)!.map((t) => `${t.x},${t.y}`))
    assert.ok(tiles.size >= 3, `${k} goes places`)
    for (const t of seen.get(k)!) if (`${t.x},${t.y}` !== `${base.get(k)!.x},${base.get(k)!.y}`) assert.ok(restTiles.has(`${t.x},${t.y}`))
  }
  for (const t of seen.get('w')!) assert.ok(waitTiles.has(`${t.x},${t.y}`) || t.place === 'owner-wait', 'waits by the door')
  for (const t of seen.get('x')!) assert.deepEqual([t.x, t.y, t.pose], [base.get('x')!.x, base.get('x')!.y, 'type'], 'working: at the desk')
  // At any moment the planned tiles are all different.
  const check = new Life(world, seededRandom(7))
  for (let t = 0; t < 5 * 60_000; t += 1000) {
    const tiles = [...check.plan(base, t).values()].map((x) => `${x.x},${x.y}`)
    assert.equal(new Set(tiles).size, tiles.length, `t=${t}`)
  }
})

test('real events win: a status change ends the routine at once, a letter sends the bot back for a while', () => {
  const world = realMap()
  const life = new Life(world, seededRandom(3))
  const resting = bases({ a: 'done' })
  run(life, resting, 0, 5 * 60_000)
  // Find a moment it is away from its sofa.
  let t = 5 * 60_000
  let away = life.plan(resting, t).get('a')!
  for (let i = 0; i < 200 && away.x === resting.get('a')!.x && away.y === resting.get('a')!.y; i += 1) {
    t = Math.max(t + 250, life.nextAt())
    away = life.plan(resting, t).get('a')!
  }
  assert.ok(away.x !== resting.get('a')!.x || away.y !== resting.get('a')!.y, 'it went somewhere')
  // Work starts: straight to the desk, no routine.
  const working = bases({ a: 'working' })
  const now = life.plan(working, t + 1).get('a')!
  assert.deepEqual([now.place, now.routine], ['desk', undefined])
  // Back to rest, then a letter: at its real place, and it stays there EVENT_HOLD_MS.
  const life2 = new Life(world, seededRandom(3))
  run(life2, resting, 0, 5 * 60_000)
  life2.interrupt('a', t)
  const held = life2.plan(resting, t)
  assert.deepEqual([held.get('a')!.x, held.get('a')!.y], [resting.get('a')!.x, resting.get('a')!.y])
  assert.ok(life2.nextAt() >= t + EVENT_HOLD_MS - 1)
  // Needs you appears: to the door now.
  const needs = bases({ a: 'done' }, { a: { needsYou: 1 } })
  assert.equal(life2.plan(needs, t + 10).get('a')!.place, 'owner-wait')
})

test('the same seed plays the same day', () => {
  const world = realMap()
  const base = bases({ a: 'done', b: 'idle', w: 'waiting' })
  const day = (seed: number) => {
    const life = new Life(world, seededRandom(seed))
    const out: string[] = []
    for (let t = 0; t < 10 * 60_000; t += 500) out.push([...life.plan(base, t)].map(([k, v]) => `${k}@${v.x},${v.y}`).join(' '))
    return out.join('\n')
  }
  assert.equal(day(11), day(11))
  assert.notEqual(day(11), day(12))
})

test('chat clouds: only resting bots next to each other, one speaks at a time, icons only', () => {
  const bots = [
    { key: 'a', x: 10, y: 10, resting: true },
    { key: 'b', x: 11, y: 10, resting: true },
    { key: 'c', x: 30, y: 30, resting: true },
    { key: 'd', x: 12, y: 10, resting: false }
  ]
  const speakers = new Set<string>()
  for (let t = 0; t < CHAT_TURN_MS * 20; t += CHAT_TURN_MS / 2) {
    const clouds = chatClouds(bots, t)
    assert.ok(clouds.size <= 1, 'one at a time')
    for (const [k, icon] of clouds) {
      speakers.add(k)
      assert.ok(['coffee', 'talk', 'dots', 'laugh', 'chart', 'fish'].includes(icon))
    }
  }
  assert.deepEqual([...speakers].sort(), ['a', 'b'], 'the lone and the walking one stay quiet; the two take turns')
  assert.deepEqual(chatClouds(bots, 1234), chatClouds(bots, 1234), 'deterministic')
})

test('a free bot with an office sometimes rests at home: chair, plant, window, ball; one without stays about the office', () => {
  const world = realMap()
  const stops = stopsOf(world)
  for (const room of world.rooms.filter((r) => r.kind === 'clevel')) {
    const list = stops.home.get(room.id) ?? []
    for (const pose of ['phone', 'rock', 'feet']) assert.ok(list.some((s) => s.pose === pose), `${room.id}: ${pose}`)
    for (const s of list) assert.equal(world.roomAt[s.y * world.width + s.x], room.id, `${room.id}: ${s.pose} at home`)
  }
  const poses = new Set([...stops.home.values()].flat().map((s) => s.pose))
  for (const pose of ['water', 'window', 'ball']) assert.ok(poses.has(pose as never), pose)
  const base = bases({ a: 'done', b: 'idle' })
  const office = world.desks.find((d) => d.room === 'office-2')!
  const homes = new Map([['a', 'office-2']])
  let home = 0
  let homeless = 0
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const life = new Life(world, seededRandom(seed))
    for (let t = 0; t < 10 * 60_000; t += 1000) {
      const out = life.plan(base, t, homes)
      const a = out.get('a')!
      if (world.roomAt[a.y * world.width + a.x] === 'office-2') home += 1
      const b = out.get('b')!
      if (world.rooms.find((r) => r.id === world.roomAt[b.y * world.width + b.x])?.kind === 'clevel') homeless += 1
    }
  }
  assert.ok(home > 0, 'a goes home now and then')
  assert.equal(homeless, 0, 'b has no office: it never rests in one')
  assert.ok(office)
})
