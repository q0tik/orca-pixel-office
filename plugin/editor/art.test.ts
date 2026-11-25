import { assert, test } from 'orca/testing'
import { Cast } from '../engine/actors'
import { FLOORS, FURNITURE, type FurnitureType } from '../engine/catalog'
import { fitCamera } from '../engine/camera'
import { realMap } from '../engine/fixtures'
import { planTargets } from '../engine/locations'
import {
  BUBBLE_H,
  BUBBLE_W,
  CHAR_H,
  CHAR_W,
  FURNITURE_HEADROOM,
  drawBubble,
  drawCharacter,
  drawFloor,
  drawFurniture,
  drawWall,
  drawWallItem,
  drawClockHands,
  drawNoticeNumbers,
  textWidth,
  lookFor,
  type CharPose,
  type Paint
} from './art'
import { formatDuration, working } from './format'
import { HAIRS, P, PANTS, SHIRTS, SKINS } from './palette'
import { Renderer, stackTags, type Canvas } from './render'

const PALETTE = new Set<string>([
  ...Object.values(P).flatMap((v) => (Array.isArray(v) ? v : [v as string])),
  ...SKINS,
  ...HAIRS,
  ...PANTS,
  ...SHIRTS.flat()
])

/** Paints into a map of pixels, and remembers anything painted outside the box or off-palette. */
function buffer(x0: number, y0: number, w: number, h: number) {
  const pixels = new Map<string, string>()
  const outside: string[] = []
  const foreign = new Set<string>()
  const paint: Paint = (x, y, pw, ph, color) => {
    if (!PALETTE.has(color)) foreign.add(color)
    for (let yy = y; yy < y + ph; yy += 1) {
      for (let xx = x; xx < x + pw; xx += 1) {
        if (xx < x0 || yy < y0 || xx >= x0 + w || yy >= y0 + h) outside.push(`${xx},${yy}`)
        else pixels.set(`${xx},${yy}`, color)
      }
    }
  }
  return { paint, pixels, outside, foreign, picture: () => [...pixels.entries()].sort().join(';') }
}

test('every tile and wall is painted fully, from the palette only', () => {
  for (const kind of FLOORS) {
    for (const [tx, ty] of [
      [0, 0],
      [3, 7]
    ]) {
      const b = buffer(0, 0, 16, 16)
      drawFloor(b.paint, kind, tx, ty)
      assert.equal(b.pixels.size, 256, `${kind} fills its tile`)
      assert.deepEqual([...b.foreign], [], kind)
      assert.deepEqual(b.outside, [], kind)
    }
  }
  for (const face of [true, false]) {
    const b = buffer(0, 0, 16, 16)
    drawWall(b.paint, face, { n: true, e: true, w: false }, 1)
    assert.equal(b.pixels.size, 256)
    assert.deepEqual([...b.foreign], [])
  }
})

test('furniture stays inside its footprint and headroom, in palette colours', () => {
  for (const type of Object.keys(FURNITURE) as FurnitureType[]) {
    const spec = FURNITURE[type]
    for (const facing of ['up', 'down'] as const) {
      const b = buffer(0, spec.mount === 'wall' ? 0 : -FURNITURE_HEADROOM, spec.w * 16, spec.h * 16 + (spec.mount === 'wall' ? 0 : FURNITURE_HEADROOM))
      const item = { type, w: spec.w, h: spec.h, facing, variant: undefined }
      if (spec.mount === 'wall') drawWallItem(b.paint, item)
      else drawFurniture(b.paint, item, { screenOn: true })
      assert.deepEqual(b.outside.slice(0, 3), [], `${type} ${facing}`)
      assert.deepEqual([...b.foreign], [], type)
      assert.ok(b.pixels.size > 0, `${type} draws something`)
    }
  }
})

test('living things change with the frame; clocks and the notice board stay in their boxes', () => {
  for (const type of ['server-rack', 'aquarium', 'coffee-machine'] as const) {
    const spec = FURNITURE[type]
    const frames = new Set<string>()
    for (let f = 0; f < 12; f += 1) {
      const b = buffer(0, -FURNITURE_HEADROOM, spec.w * 16, spec.h * 16 + FURNITURE_HEADROOM)
      drawFurniture(b.paint, { type, w: spec.w, h: spec.h, facing: 'down' }, { frame: f })
      assert.deepEqual(b.outside.slice(0, 3), [], `${type} frame ${f}`)
      assert.deepEqual([...b.foreign], [], type)
      frames.add(b.picture())
    }
    assert.ok(frames.size > 1, `${type} moves`)
  }
  const pictures = new Set<string>()
  for (const [h, m] of [[3, 0], [9, 30], [12, 15], [6, 45]]) {
    const b = buffer(0, 0, 16, 16)
    drawClockHands(b.paint, h, m)
    assert.deepEqual(b.outside, [])
    pictures.add(b.picture())
  }
  assert.equal(pictures.size, 4, 'every time has its own hands')
  const board = (w: number, k: number) => {
    const b = buffer(0, 0, 32, 16)
    drawNoticeNumbers(b.paint, w, k)
    assert.deepEqual(b.outside, [])
    return b.picture()
  }
  assert.notEqual(board(0, 3), board(2, 3))
  assert.notEqual(board(1, 0), board(1, 12))
  const sign = buffer(0, 0, 32, 16)
  drawWallItem(sign.paint, { type: 'sign', w: 2 })
  assert.deepEqual(sign.outside, [], 'СДАЁТСЯ fits its plate')
  assert.ok(textWidth('СДАЁТСЯ') <= 30)
  // The paper stack grows on the desk.
  const desk = (papers: number) => {
    const b = buffer(0, -FURNITURE_HEADROOM, 32, 16 + FURNITURE_HEADROOM)
    drawFurniture(b.paint, { type: 'desk', w: 2, h: 1, facing: 'up' }, { screenOn: true, papers })
    assert.deepEqual(b.outside.slice(0, 3), [])
    return [...b.pixels.entries()].filter(([, c]) => c === P.paper).length
  }
  assert.ok(desk(12) > desk(3) && desk(3) > 0)
})

test('a working desk has its screen on, an empty one off', () => {
  const on = buffer(0, -FURNITURE_HEADROOM, 32, 36)
  const off = buffer(0, -FURNITURE_HEADROOM, 32, 36)
  drawFurniture(on.paint, { type: 'desk', w: 2, h: 1, facing: 'up' }, { screenOn: true })
  drawFurniture(off.paint, { type: 'desk', w: 2, h: 1, facing: 'up' }, { screenOn: false })
  assert.ok([...on.pixels.values()].includes(P.screenLine))
  assert.ok(![...off.pixels.values()].includes(P.screenLine))
})

test('the owner desk has its big armchair, and it is empty', () => {
  const b = buffer(0, -FURNITURE_HEADROOM, 48, 32 + FURNITURE_HEADROOM)
  drawFurniture(b.paint, { type: 'ceo-desk', w: 3, h: 2, facing: 'down' })
  const colors = new Set(b.pixels.values())
  assert.ok(colors.has(P.leather), 'armchair')
  assert.ok(colors.has(P.gold), 'nameplate')
  for (const skin of SKINS) assert.ok(!colors.has(skin), 'nobody sits in it')
})

test('characters: 4 walk frames, sitting, waiting and resting all differ and fit their box', () => {
  const look = lookFor('cto')
  const pictures = new Map<string, string>()
  const draw = (pose: CharPose, facing: 'up' | 'down' | 'left' | 'right', frame = 0) => {
    const b = buffer(0, 0, CHAR_W, CHAR_H)
    drawCharacter(b.paint, look, pose, facing, frame)
    assert.deepEqual(b.outside.slice(0, 3), [], `${pose} ${facing} ${frame}`)
    assert.deepEqual([...b.foreign], [], `${pose} ${facing}`)
    return b
  }
  for (const facing of ['up', 'down', 'left', 'right'] as const) {
    const frames = [0, 1, 2, 3].map((f) => draw('walk', facing, f).picture())
    assert.notEqual(frames[0], frames[1], `walk ${facing} moves`)
    assert.notEqual(frames[1], frames[3], `walk ${facing} alternates legs`)
    pictures.set(`walk-${facing}`, frames[1])
  }
  for (const [pose, facing] of [
    ['stand', 'down'],
    ['wait', 'up'],
    ['type', 'up'],
    ['sofa', 'down']
  ] as const) {
    pictures.set(`${pose}-${facing}`, draw(pose, facing).picture())
  }
  assert.equal(new Set(pictures.values()).size, pictures.size, 'every pose looks different')
  assert.notEqual(draw('type', 'up', 0).picture(), draw('type', 'up', 1).picture(), 'typing hands move')
  // Left is the mirror of right.
  const right = draw('walk', 'right', 1)
  const left = draw('walk', 'left', 1)
  for (const [key, color] of right.pixels) {
    const [x, y] = key.split(',').map(Number)
    assert.equal(left.pixels.get(`${CHAR_W - 1 - x},${y}`), color)
  }
  // Waiting: the hand goes up above the head line.
  const wait = draw('wait', 'up')
  assert.equal(wait.pixels.get('12,4'), look.skin)
})

test('looks are stable per bot and differ between bots', () => {
  assert.deepEqual(lookFor('cto'), lookFor('cto'))
  const looks = new Set(['cto', 'seller', 'bot-2', 'a', 'b', 'c'].map((key) => JSON.stringify(lookFor(key))))
  assert.ok(looks.size >= 5)
})

test('the bubble fits and carries its glyph', () => {
  const b = buffer(0, 0, BUBBLE_W, BUBBLE_H)
  drawBubble(b.paint, '!', P.blocked)
  assert.deepEqual(b.outside, [])
  assert.equal(b.pixels.get('5,2'), P.blocked)
})

test('durations and counts read naturally', () => {
  assert.equal(formatDuration(42_000), '42 сек')
  assert.equal(formatDuration(5 * 60_000 + 10_000), '5 мин')
  assert.equal(formatDuration(2 * 3_600_000 + 7 * 60_000), '2 ч 7 мин')
  assert.equal(formatDuration(3 * 86_400_000), '3 д')
  assert.equal(working(1), '1 работает')
  assert.equal(working(3), '3 работают')
  assert.equal(working(11), '11 работают')
  assert.equal(working(21), '21 работает')
})

// ── Renderer with a fake canvas ──────────────────────────────────────────────────────────────

function fakeCanvas(width: number, height: number) {
  const calls = { fillRect: 0, drawImage: 0, fillText: [] as string[] }
  const ctx = {
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    fillRect: () => (calls.fillRect += 1),
    drawImage: () => (calls.drawImage += 1),
    fillText: (text: string) => calls.fillText.push(text),
    measureText: (text: string) => ({ width: text.length * 7 })
  }
  return { canvas: { width, height, getContext: () => ctx } as unknown as Canvas, ctx, calls }
}

test('the renderer bakes only the chunks in view and culls the rest', () => {
  const world = realMap()
  let made = 0
  const renderer = new Renderer(world, (w, h) => {
    made += 1
    return fakeCanvas(w, h).canvas
  })
  const screen = fakeCanvas(400, 300)
  const base = {
    actors: [],
    labels: new Map(),
    desks: new Map(),
    typingFrame: 0,
    bobFrame: 0,
    dpr: 1,
    hover: null
  }
  renderer.draw(screen.ctx as unknown as CanvasRenderingContext2D, { ...base, camera: { x: 60, y: 60, zoom: 4 }, view: { width: 400, height: 300 } })
  assert.equal(renderer.chunkCount, 1, 'zoomed into a corner: one chunk')
  const cornerImages = screen.calls.drawImage
  const whole = fakeCanvas(2000, 1200)
  const view = { width: 2000, height: 1200 }
  renderer.draw(whole.ctx as unknown as CanvasRenderingContext2D, { ...base, camera: fitCamera(view, renderer.size), view })
  const total = Math.ceil(world.width / 16) * Math.ceil(world.height / 16)
  assert.equal(renderer.chunkCount, total, 'all chunks once the whole office is in view')
  assert.ok(whole.calls.drawImage > cornerImages * 3, 'far more sprites drawn for the whole office')
  const before = made
  renderer.draw(whole.ctx as unknown as CanvasRenderingContext2D, { ...base, camera: fitCamera(view, renderer.size), view })
  assert.equal(made, before, 'the second frame reuses every bitmap')
  assert.ok(whole.calls.fillText.includes('Приёмная') && whole.calls.fillText.includes('CEO') && whole.calls.fillText.includes('Серверная'), 'room labels')
  // An office's label can say who sits there.
  const labelled = fakeCanvas(2000, 1200)
  renderer.draw(labelled.ctx as unknown as CanvasRenderingContext2D, { ...base, camera: fitCamera(view, renderer.size), view, roomLabels: new Map([['office-1', 'Серверная · Ада 📌']]) })
  assert.ok(labelled.calls.fillText.includes('Серверная · Ада 📌'))
})

test('bots are drawn with their name tag and status', () => {
  const world = realMap()
  const renderer = new Renderer(world, (w, h) => fakeCanvas(w, h).canvas)
  const cast = new Cast()
  cast.sync(world, planTargets(world, [{ key: 'cto', state: 'blocked', desk: null }]))
  const screen = fakeCanvas(1600, 1000)
  const view = { width: 1600, height: 1000 }
  renderer.draw(screen.ctx as unknown as CanvasRenderingContext2D, {
    camera: { ...fitCamera(view, renderer.size), zoom: 2 },
    view,
    actors: cast.views(),
    labels: new Map([['cto', { name: 'Ада', state: 'blocked' as const }]]),
    desks: new Map(),
    typingFrame: 0,
    bobFrame: 0,
    dpr: 1,
    hover: null
  })
  assert.ok(screen.calls.fillText.includes('Ада'))
  const box = renderer.hit(cast.views(), cast.views()[0].x * 16 + 8, cast.views()[0].y * 16 + 6)
  assert.equal(box, 'cto', 'hover finds the bot')
})

test('name tags of neighbours never cover each other', () => {
  const tags = [
    { x: 0, y: 100, w: 60, h: 14 },
    { x: 30, y: 100, w: 60, h: 14 },
    { x: 60, y: 100, w: 60, h: 14 },
    { x: 300, y: 100, w: 60, h: 14 }
  ]
  const ys = stackTags(tags, 2)
  for (let i = 0; i < tags.length; i += 1) {
    for (let j = i + 1; j < tags.length; j += 1) {
      const a = { ...tags[i], y: ys[i] }
      const b = { ...tags[j], y: ys[j] }
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
      assert.ok(!overlap, `${i} and ${j}`)
    }
  }
  assert.equal(ys[3], 100, 'a lone tag stays put')
  assert.equal(ys[0], 100, 'the first stays put')
})
