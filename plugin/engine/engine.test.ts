import { existsSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import type { DeskState } from '../src/bots'
import { Cast } from './actors'
import { clampCamera, fitCamera, MARGIN, origin, panBy, screenToWorld, visibleRect, zoomAt, ZoomAccumulator } from './camera'
import { bubbleGlyph, planTargets, ruleFor, STATUS_PLACE, type Target } from './locations'
import { findPath } from './path'
import { intersects, Scheduler, visibleChunks, type Clock } from './scheduler'
import { assignBotSeats, emptyPins, isBotPlace, occupantOf, parseDeskMap, parsePins, pin, serializePins, swap, unpin } from './seating'
import { realMap } from './fixtures'
import type { World } from './world'

const here = (file: string) => new URL(file, import.meta.url).pathname

// ── Seating ────────────────────────────────────────────────────────────────────────────────

/** A seeded random, so a test can replay «Math.random». */
function seeded(seed: number): () => number {
  let x = Math.imul(seed, 2654435761) >>> 0 || 1
  const next = () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return (x >>> 0) / 2 ** 32
  }
  for (let i = 0; i < 4; i += 1) next()
  return next
}

test('no seating config ships: places are described by the map only', () => {
  assert.ok(!existsSync(here('../office/seating.json')), 'no hard-wired seats')
  const world = realMap()
  const places = world.desks.filter(isBotPlace)
  assert.ok(places.length >= 5, 'four C-level offices and the mini office')
  assert.equal(new Set(places.map((d) => d.room)).size, places.length, 'one desk per office')
  assert.ok(places.some((d) => d.room === 'mini'), 'the mini office in the reception is a place')
})

test('random seating: free offices only, one bot each, then the same places after a restart', () => {
  const world = realMap()
  const keys = ['cto', 'seller', 'bot-2']
  const first = assignBotSeats(keys, world.desks, {}, {}, seeded(7))
  const ids = keys.map((k) => first.seats.get(k)!.id)
  assert.equal(new Set(ids).size, 3, 'one bot per office')
  for (const k of keys) assert.ok(isBotPlace(first.seats.get(k)!), `${k} sits in an office`)
  assert.deepEqual(Object.keys(first.memory).sort(), [...keys].sort(), 'the choice is remembered')
  // «Restart»: memory read back from storage, a different random: everyone keeps their place.
  const stored = parseDeskMap(JSON.parse(JSON.stringify(first.memory)))
  for (const seed of [1, 2, 3, 99]) {
    const again = assignBotSeats([...keys].reverse(), world.desks, {}, stored, seeded(seed))
    for (const k of keys) assert.equal(again.seats.get(k)!.id, first.seats.get(k)!.id, `${k} after restart (seed ${seed})`)
    assert.deepEqual(again.memory, first.memory, 'nothing new to store')
  }
  // Different seeds without memory may give different places: it really is random.
  const picks = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => assignBotSeats(['solo'], world.desks, {}, {}, seeded(seed)).seats.get('solo')!.id))
  assert.ok(picks.size > 1, 'not always the same office')
})

test('the owner pin always wins over the remembered place, and survives a restart', () => {
  const world = realMap()
  const places = world.desks.filter(isBotPlace)
  const memory = { cto: places[0].id, seller: places[1].id }
  // Pin seller to cto's remembered office: seller gets it, cto takes another free one.
  const pins = parsePins(JSON.parse(JSON.stringify(serializePins(pin(emptyPins(), 'bots', 'seller', places[0].id)))))
  const r = assignBotSeats(['cto', 'seller'], world.desks, pins.bots, memory, seeded(3))
  assert.equal(r.seats.get('seller')!.id, places[0].id)
  assert.notEqual(r.seats.get('cto')!.id, places[0].id)
  assert.ok(isBotPlace(r.seats.get('cto')!))
  // Restart with the stored pins and memory: the same.
  const again = assignBotSeats(['seller', 'cto'], world.desks, pins.bots, r.memory, seeded(42))
  assert.equal(again.seats.get('seller')!.id, places[0].id)
  assert.equal(again.seats.get('cto')!.id, r.seats.get('cto')!.id)
  // Unpin: back to auto, and the bot keeps where it sits.
  const free = unpin(pins, 'bots', 'seller')
  const after = assignBotSeats(['seller', 'cto'], world.desks, free.bots, again.memory, seeded(5))
  assert.equal(after.seats.get('seller')!.id, places[0].id)
})

test('one bot per office: pinning to a taken office swaps, a stale pin is dropped', () => {
  const world = realMap()
  const [a, b, c] = world.desks.filter(isBotPlace)
  const seats = new Map([
    ['cto', a.id],
    ['seller', b.id],
    ['bot-2', null as string | null]
  ])
  assert.equal(occupantOf(b.id, seats, 'cto'), 'seller')
  assert.equal(occupantOf(c.id, seats), null)
  const swapped = swap(pin(emptyPins(), 'bots', 'seller', b.id), 'bots', 'cto', b.id, 'seller', a.id)
  assert.deepEqual(swapped.bots, { cto: b.id, seller: a.id })
  const r = assignBotSeats(['cto', 'seller'], world.desks, swapped.bots, { cto: a.id, seller: b.id })
  assert.equal(r.seats.get('cto')!.id, b.id)
  assert.equal(r.seats.get('seller')!.id, a.id)
  // No seat of its own: the other goes back to the automatic seating.
  const loose = swap(swapped, 'bots', 'bot-2', a.id, 'seller', null)
  assert.equal(loose.bots['bot-2'], a.id)
  assert.equal(loose.bots.seller, undefined)
  // One pin per desk: pinning onto someone's pinned desk drops that pin.
  assert.deepEqual(pin(swapped, 'bots', 'bot-2', b.id).bots, { 'bot-2': b.id, seller: a.id })
  // Junk in storage reads as no pins.
  assert.deepEqual(parsePins('junk'), emptyPins())
  assert.deepEqual(parsePins({ bots: { x: 1, y: 'teams.t1' }, workers: [] }), { bots: { y: 'teams.t1' }, workers: {} })
})

test('more bots than offices: the rest sit in the team room, then stand', () => {
  const world = realMap()
  const keys = Array.from({ length: 7 }, (_, i) => `bot${i}`)
  const r = assignBotSeats(keys, world.desks, {}, {}, seeded(11))
  const places = world.desks.filter(isBotPlace).length
  assert.equal([...r.seats.values()].filter((d) => d && isBotPlace(d)).length, places)
  assert.equal([...r.seats.values()].filter((d) => d && d.roomKind === 'team').length, keys.length - places)
  const tiny = world.desks.filter((d) => d.id === 'teams.t1')
  const crowd = assignBotSeats(['a', 'b'], tiny, {}, {})
  assert.equal(crowd.seats.get('a')?.id, 'teams.t1')
  assert.equal(crowd.seats.get('b'), null)
})

// ── Status → place ─────────────────────────────────────────────────────────────────────────

test('the status table: work at the desk, wait at the owner door, rest in the lounge', () => {
  assert.deepEqual(STATUS_PLACE.working.places[0], 'desk')
  assert.deepEqual(STATUS_PLACE.blocked.places, ['owner-wait'])
  assert.deepEqual(STATUS_PLACE.waiting.places, ['owner-wait'])
  assert.equal(STATUS_PLACE.blocked.bubble, 'blocked')
  assert.equal(STATUS_PLACE.waiting.bubble, 'waiting')
  assert.equal(STATUS_PLACE.done.places[0], 'sofa')
  assert.equal(STATUS_PLACE.idle.places[0], 'kitchen')
  assert.equal(STATUS_PLACE.working.bubble, null)
  assert.equal(ruleFor('nonsense' as DeskState), STATUS_PLACE.idle)
})

test('the priority table: every state × Needs you × failed last turn', () => {
  const states: DeskState[] = ['working', 'blocked', 'waiting', 'done', 'idle']
  const expected: Record<string, [string, string | null]> = {
    // state|needsYou|failed → [first place, sign]
    'working|0|0': ['desk', null],
    'working|1|0': ['desk', null],
    'working|0|1': ['desk', null],
    'working|1|1': ['desk', null],
    'blocked|0|0': ['owner-wait', 'blocked'],
    'blocked|1|0': ['owner-wait', 'blocked'],
    'blocked|0|1': ['owner-wait', 'blocked'],
    'blocked|1|1': ['owner-wait', 'blocked'],
    'waiting|0|0': ['owner-wait', 'waiting'],
    'waiting|1|0': ['owner-wait', 'waiting'],
    'waiting|0|1': ['owner-wait', 'waiting'],
    'waiting|1|1': ['owner-wait', 'waiting'],
    'done|0|0': ['sofa', null],
    'done|1|0': ['owner-wait', 'needs'],
    'done|0|1': ['sofa', 'failed'],
    'done|1|1': ['owner-wait', 'failed'],
    'idle|0|0': ['kitchen', null],
    'idle|1|0': ['owner-wait', 'needs'],
    'idle|0|1': ['kitchen', 'failed'],
    'idle|1|1': ['owner-wait', 'failed']
  }
  for (const state of states) {
    for (const needsYou of [0, 1]) {
      for (const failed of [false, true]) {
        const key = `${state}|${needsYou}|${failed ? 1 : 0}`
        const rule = ruleFor(state, { needsYou: needsYou * 3, failed })
        assert.deepEqual([rule.places[0], rule.bubble], expected[key], key)
      }
    }
  }
  assert.equal(bubbleGlyph('needs'), '?')
  for (const b of ['blocked', 'failed', 'waiting'] as const) assert.equal(bubbleGlyph(b), '!')
  assert.match(ruleFor('done', { needsYou: 2 }).label, /Needs you/)
  assert.match(ruleFor('done', { failed: true }).label, /ошибкой/)
})

test('Needs you sends a resting bot to the owner door, working ones stay at their desks', () => {
  const world = realMap()
  const t = planTargets(world, [
    { key: 'a', state: 'done', desk: null, needsYou: 3 },
    { key: 'b', state: 'working', desk: world.desks[0], needsYou: 3 },
    { key: 'c', state: 'idle', desk: null, failed: true }
  ])
  assert.deepEqual([t.get('a')!.place, t.get('a')!.bubble, t.get('a')!.pose], ['owner-wait', 'needs', 'wait'])
  assert.deepEqual([t.get('b')!.place, t.get('b')!.bubble], ['desk', null])
  assert.deepEqual([t.get('c')!.place, t.get('c')!.bubble], ['kitchen', 'failed'])
})

function plan(world: World, states: Record<string, DeskState>, previous?: Map<string, Target>) {
  const { seats } = assignBotSeats(Object.keys(states), world.desks, { cto: 'office-1.desk' }, {}, () => 0)
  return planTargets(
    world,
    Object.entries(states).map(([key, state]) => ({ key, state, desk: seats.get(key) ?? null })),
    previous
  )
}

test('each state puts the bot in its place', () => {
  const world = realMap()
  const targets = plan(world, { cto: 'working', a: 'blocked', b: 'waiting', c: 'done', d: 'idle' })
  const cto = targets.get('cto')!
  const desk = world.desks.find((d) => d.id === 'office-1.desk')!
  assert.deepEqual([cto.place, cto.x, cto.y, cto.pose], ['desk', desk.seat.x, desk.seat.y, 'type'])
  assert.equal(targets.get('a')!.place, 'owner-wait')
  assert.equal(targets.get('a')!.bubble, 'blocked')
  assert.equal(targets.get('b')!.place, 'owner-wait')
  assert.equal(targets.get('b')!.bubble, 'waiting')
  assert.equal(targets.get('c')!.place, 'sofa')
  assert.equal(targets.get('c')!.pose, 'sofa')
  assert.equal(targets.get('d')!.place, 'kitchen')
  const tiles = [...targets.values()].map((t) => `${t.x},${t.y}`)
  assert.equal(new Set(tiles).size, tiles.length, 'nobody shares a tile')
})

test('a bot keeps its spot while others come and go; crowds overflow next to the spots', () => {
  const world = realMap()
  const first = plan(world, { a: 'done', b: 'done' })
  const second = plan(world, { a: 'working', b: 'done' }, first)
  assert.deepEqual(second.get('b'), first.get('b'), 'b did not move when a left the sofa')
  const many: Record<string, DeskState> = {}
  for (let i = 0; i < 12; i += 1) many[`w${String(i).padStart(2, '0')}`] = 'blocked'
  const crowd = plan(world, many)
  assert.equal(crowd.size, 12)
  const tiles = [...crowd.values()].map((t) => `${t.x},${t.y}`)
  assert.equal(new Set(tiles).size, 12)
  for (const target of crowd.values()) assert.equal(target.bubble, 'blocked')
})

// ── Walking ────────────────────────────────────────────────────────────────────────────────

test('a bot appears in place, then walks the BFS path tile by tile on a state change', () => {
  const world = realMap()
  const cast = new Cast()
  const first = plan(world, { cto: 'working' })
  assert.ok(cast.sync(world, first))
  assert.equal(cast.walking(), 0, 'no walk on first sight')
  const actor = cast.actors.get('cto')!
  const start = { x: actor.x, y: actor.y }
  const second = plan(world, { cto: 'blocked' }, first)
  assert.ok(cast.sync(world, second))
  const expected = findPath(world, start, second.get('cto')!)!
  assert.deepEqual(actor.path, expected)
  assert.ok(cast.animating())
  let ticks = 0
  let last = { x: actor.x, y: actor.y }
  while (cast.walking() && ticks < 1000) {
    cast.tick()
    ticks += 1
    const view = cast.views()[0]
    assert.ok(Math.abs(view.x - last.x) + Math.abs(view.y - last.y) <= 0.5 + 1e-9, 'never jumps')
    last = { x: view.x, y: view.y }
  }
  assert.equal(ticks, expected.length * 2, 'half a tile per tick')
  assert.deepEqual([actor.x, actor.y], [second.get('cto')!.x, second.get('cto')!.y])
  assert.equal(actor.facing, 'up', 'faces the owner door')
  // Same state again: no walk.
  assert.equal(cast.sync(world, plan(world, { cto: 'blocked' }, second)), false)
})

test('a retarget mid-walk finishes the step, then turns', () => {
  const world = realMap()
  const cast = new Cast()
  const a = plan(world, { cto: 'working' })
  cast.sync(world, a)
  const b = plan(world, { cto: 'done' }, a)
  cast.sync(world, b)
  cast.tick() // half way into the first step
  const actor = cast.actors.get('cto')!
  const stepping = actor.path[0]
  const c = plan(world, { cto: 'waiting' }, b)
  cast.sync(world, c)
  assert.deepEqual(actor.path[0], stepping, 'the step in progress stays first')
  while (cast.walking()) cast.tick()
  assert.deepEqual([actor.x, actor.y], [c.get('cto')!.x, c.get('cto')!.y])
})

test('the timer is needed only while something moves', () => {
  const world = realMap()
  const cast = new Cast()
  cast.sync(world, plan(world, { a: 'done', b: 'idle' }))
  assert.equal(cast.animating(), false, 'resting bots need no timer')
  cast.sync(world, plan(world, { a: 'working', b: 'idle' }))
  assert.ok(cast.animating(), 'walking')
  while (cast.walking()) cast.tick()
  assert.ok(cast.animating(), 'typing at the desk')
  cast.sync(world, plan(world, { a: 'waiting', b: 'idle' }))
  while (cast.walking()) cast.tick()
  assert.ok(cast.animating(), 'bubble')
})

// ── Camera ─────────────────────────────────────────────────────────────────────────────────

const view = { width: 1600, height: 1000 }
const worldPx = { width: 896, height: 576 }

test('fit shows the whole building at the biggest whole zoom, centred', () => {
  const cam = fitCamera(view, worldPx)
  assert.equal(cam.zoom, 1)
  const big = fitCamera({ width: 3000, height: 2000 }, worldPx)
  assert.equal(big.zoom, Math.floor(Math.min(3000 / (896 + 2 * MARGIN), 2000 / (576 + 2 * MARGIN))))
  assert.deepEqual([big.x, big.y], [448, 288])
  const rect = visibleRect(big, { width: 3000, height: 2000 })
  assert.ok(rect.x <= 0 && rect.y <= 0 && rect.x + rect.w >= 896 && rect.y + rect.h >= 576, 'all of it visible')
  assert.ok(Number.isInteger(big.zoom))
})

test('camera bounds: never more than the margin past the edge', () => {
  const cam = clampCamera({ x: -500, y: 99999, zoom: 4 }, view, worldPx)
  const rect = visibleRect(cam, view)
  assert.ok(rect.x >= -MARGIN - 1 && rect.x <= 0, `left edge ${rect.x}`)
  assert.ok(rect.y + rect.h <= worldPx.height + MARGIN + 1, 'bottom edge')
  const small = clampCamera({ x: 0, y: 0, zoom: 1 }, { width: 2000, height: 2000 }, worldPx)
  assert.deepEqual([small.x, small.y], [448, 288], 'a building smaller than the view stays centred')
  assert.equal(clampCamera({ x: 0, y: 0, zoom: 40 }, view, worldPx).zoom, 12)
  assert.equal(clampCamera({ x: 0, y: 0, zoom: 0 }, view, worldPx).zoom, 1)
})

test('pan moves with the drag; zoom keeps the point under the cursor', () => {
  const cam = clampCamera({ x: 400, y: 300, zoom: 4 }, view, worldPx)
  const moved = panBy(cam, 40, -20, view, worldPx)
  assert.deepEqual([moved.x, moved.y], [cam.x - 10, cam.y + 5])
  const under = screenToWorld(cam, view, 300, 200)
  const zoomed = zoomAt(cam, 6, 300, 200, view, worldPx)
  const after = screenToWorld(zoomed, view, 300, 200)
  assert.equal(zoomed.zoom, 6)
  assert.ok(Math.abs(after.x - under.x) < 0.5 && Math.abs(after.y - under.y) < 0.5)
  const o = origin(zoomed, view)
  assert.ok(Number.isInteger(o.x) && Number.isInteger(o.y), 'pixel grid stays aligned')
})

test('a series of zoom steps near the edge keeps aiming at the first point', () => {
  const v = { width: 2800, height: 1720 }
  let cam = fitCamera(v, worldPx)
  const anchor = screenToWorld(cam, v, 730, 480)
  for (let i = 0; i < 4; i += 1) cam = zoomAt(cam, cam.zoom + 1, 730, 480, v, worldPx, anchor)
  const after = screenToWorld(cam, v, 730, 480)
  assert.ok(Math.abs(after.x - anchor.x) < 1 && Math.abs(after.y - anchor.y) < 1, `${after.x},${after.y} vs ${anchor.x},${anchor.y}`)
})

test('pinch and wheel deltas turn into whole zoom steps', () => {
  const acc = new ZoomAccumulator(60)
  assert.equal(acc.push(-20), 0)
  assert.equal(acc.push(-20), 0)
  assert.equal(acc.push(-25), 1)
  assert.equal(acc.push(100), -1)
  assert.equal(acc.push(10), 0)
})

// ── Render scheduling and culling ─────────────────────────────────────────────────────────────

function fakeClock() {
  const frames: (() => void)[] = []
  let interval: (() => void) | null = null
  const clock: Clock = {
    requestFrame: (cb) => frames.push(cb),
    setInterval: (cb) => {
      interval = cb
      return 1
    },
    clearInterval: () => {
      interval = null
    }
  }
  return {
    clock,
    flush: () => frames.splice(0).forEach((cb) => cb()),
    tick: () => interval?.(),
    get running() {
      return interval !== null
    }
  }
}

test('draws only when dirty, once per frame', () => {
  const fake = fakeClock()
  let draws = 0
  const s = new Scheduler(fake.clock, () => (draws += 1), () => false, () => false)
  fake.flush()
  assert.equal(draws, 0, 'nothing changed, nothing drawn')
  s.invalidate()
  s.invalidate()
  s.invalidate()
  fake.flush()
  assert.equal(draws, 1, 'three changes, one frame')
  fake.flush()
  assert.equal(draws, 1)
})

test('one animation timer: starts on wake, stops when nothing moves', () => {
  const fake = fakeClock()
  let left = 3
  let draws = 0
  const s = new Scheduler(
    fake.clock,
    () => (draws += 1),
    () => {
      left -= 1
      return true
    },
    () => left > 0
  )
  s.wake()
  s.wake()
  assert.ok(fake.running)
  fake.tick()
  fake.flush()
  fake.tick()
  fake.flush()
  fake.tick()
  fake.flush()
  assert.equal(fake.running, false, 'stopped by itself')
  assert.equal(draws, 3)
  s.wake()
  assert.equal(fake.running, false, 'no wake without animation')
})

test('only the chunks in view are drawn', () => {
  const world = { width: 56, height: 36 } // tiles
  const all = visibleChunks({ x: -100, y: -100, w: 5000, h: 5000 }, world, 16)
  assert.equal(all.length, 4 * 3)
  const corner = visibleChunks({ x: 0, y: 0, w: 100, h: 100 }, world, 16)
  assert.deepEqual(corner, [{ cx: 0, cy: 0 }])
  const edge = visibleChunks({ x: 250, y: 250, w: 20, h: 20 }, world, 16)
  assert.deepEqual(edge, [
    { cx: 0, cy: 0 },
    { cx: 1, cy: 0 },
    { cx: 0, cy: 1 },
    { cx: 1, cy: 1 }
  ])
  assert.deepEqual(visibleChunks({ x: 5000, y: 0, w: 10, h: 10 }, world, 16), [])
  assert.ok(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }))
  assert.ok(!intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }))
})
