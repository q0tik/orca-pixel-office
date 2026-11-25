import { assert, test } from 'orca/testing'
import { realMap, tinyMap } from '../engine/fixtures'
import { parseMap } from '../engine/world'
import { drawFurniture, drawWallItem, nightWindow, T } from './art'
import { P } from './palette'

/** The tiny test building with one more thing on the work room's top wall. */
const tinyMapWith = (item: object) => tinyMap((m) => m.stamps.work.furniture.push(item))
import { windowCover, windowOps, windowSeed } from './windows'

test('night windows: a bookshelf in front of a window keeps every pixel of its own (no city lights on the books)', () => {
  const world = realMap()
  // Every window with something standing in front of it, in every office.
  const windows = world.furniture.filter((f) => f.type === 'window')
  let checked = 0
  for (const win of windows) {
    const cover = windowCover(win, world.furniture, (p, item) => drawFurniture(p, item, {}))
    if (!cover.size) continue
    checked += 1
    const seed = windowSeed(win)
    const view = nightWindow(win.w * T, seed)
    const drawn = [...view.stars, ...view.lights].filter(([x, y]) => !cover.has(`${x},${y}`))
    for (let frame = 0; frame < 2000; frame += 7) for (const op of windowOps(win.w * T, seed, frame)) if (!cover.has(`${op.x},${op.y}`)) drawn.push([op.x, op.y])
    for (const [x, y] of drawn) assert.ok(!cover.has(`${x},${y}`), `${win.room} window: nothing drawn over what stands in front`)
  }
  assert.ok(checked >= 1, `windows with furniture in front checked (${checked}: in this map the CEO bookshelf)`)
  // The CEO's bookshelf stands in front of the left window: it covers it, and its books keep their colours.
  const ceo = windows.find((w) => w.room === 'ceo')!
  const cover = windowCover(ceo, world.furniture, (p, item) => drawFurniture(p, item, {}))
  assert.ok(cover.size > 0, 'the bookshelf covers part of the CEO window')
  const view = nightWindow(ceo.w * T, windowSeed(ceo))
  assert.ok([...view.stars, ...view.lights].some(([x, y]) => cover.has(`${x},${y}`)), 'some lights are behind the books — and are not drawn')
})

test('night windows: the city lives — houses’ windows go out and on rarely and not together, stars twinkle, a car, a plane', () => {
  const world = realMap()
  const [a, b] = world.furniture.filter((f) => f.type === 'window')
  const width = 48
  const changes = (seed: number) => {
    const seen: string[] = []
    for (let f = 0; f < 3000; f += 1) seen.push(windowOps(width, seed, f).filter((o) => o.color === 'cityDark' || o.color === 'cityLight').map((o) => `${o.x},${o.y},${o.color}`).sort().join(';'))
    return seen
  }
  const sa = changes(windowSeed(a))
  const sb = changes(windowSeed(b))
  assert.notDeepEqual(sa, sb, 'two windows do not blink together')
  let flips = 0
  for (let f = 1; f < sa.length; f += 1) if (sa[f] !== sa[f - 1]) flips += 1
  assert.ok(flips > 10 && flips < 600, `now and then, not all the time (${flips} changes in 10 min)`)
  // Deterministic: the same frame, the same picture.
  assert.deepEqual(windowOps(width, 7, 123), windowOps(width, 7, 123))
  // Over ten minutes a car drives past and a plane flies over; stars twinkle.
  const kinds = new Set<string>()
  for (let f = 0; f < 3000; f += 1) for (const o of windowOps(width, windowSeed(a), f)) kinds.add(o.color)
  for (const k of ['carHead', 'carTail', 'planeRed', 'planeWhite', 'sky']) assert.ok(kinds.has(k), `${k} seen`)
  // Inside the glass only, never on the frame.
  for (let f = 0; f < 3000; f += 13) for (const o of windowOps(width, 3, f)) assert.ok(o.x >= 2 && o.x < width - 2 && o.y >= 5 && o.y <= 12 && o.y !== 8 && o.x % 16 !== 15 && o.x % 16 !== 0)
})

test('windows: only those out of the building show the sky; the kitchen window into the hall is plain glass', () => {
  const world = realMap()
  const windows = world.furniture.filter((f) => f.type === 'window')
  assert.ok(windows.every((w) => w.view === 'outside' || w.view === 'inside'), 'every window says where it looks')
  assert.deepEqual(windows.filter((w) => w.view === 'inside').map((w) => w.room), ['lounge'], 'the kitchen window looks into the hall')
  // Outside windows are on the building's outer wall, inside ones have a room behind them.
  for (const w of windows) {
    const behind = w.y > 0 ? world.tiles[(w.y - 1) * world.width + w.x] : 'void'
    assert.equal(w.view === 'outside', behind === 'void', `${w.room} (${w.x},${w.y})`)
  }
  const colours = (state: Parameters<typeof drawWallItem>[2]) => {
    const px = new Set<string>()
    drawWallItem((x, y, w, h, c) => px.add(c), { type: 'window', w: 3 }, state)
    return px
  }
  const inside = colours({ night: true, inside: true, beyond: P.concrete, seed: 5 })
  assert.ok(!inside.has(P.star) && !inside.has(P.cityLight) && !inside.has(P.sky), 'inside, at night: no sky, no stars, no city')
  assert.ok(inside.has(P.concrete) && inside.has(P.glassHi), 'the hall’s floor through the glass, a reflection')
  const glow = new Set<string>()
  drawWallItem((x, y, w, h, c) => glow.add(c), { type: 'window', w: 3 }, { night: true, inside: true, glowOnly: true })
  assert.equal(glow.size, 0, 'nothing of it shines at night')
  const outside = colours({ night: true, seed: 5 })
  assert.ok(outside.has(P.star) && outside.has(P.cityLight), 'outside, at night: stars and the city')
  // A wrong word is a map error.
  const { errors } = parseMap(tinyMapWith({ type: 'window', x: 1, y: 0, view: 'sideways' }) as never)
  assert.ok(errors.some((e) => e.includes('view')))
})

test('the tech desk: the small top monitor stands on a pole down to the desk, nothing hangs in the air', () => {
  const px = new Map<string, string>()
  drawFurniture((x, y, w, h, c) => {
    for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) px.set(`${xx},${yy}`, c)
  }, { type: 'desk', w: 2, h: 1, facing: 'up', variant: 'multi' }, { screenOn: true })
  for (let y = -15; y <= 2; y += 1) assert.ok(px.has(`15,${y}`) && px.has(`16,${y}`), `the pole at y ${y}`)
})
