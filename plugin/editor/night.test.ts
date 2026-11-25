import { readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import { FURNITURE, type FurnitureType } from '../engine/catalog'
import { fitCamera } from '../engine/camera'
import { realMap } from '../engine/fixtures'
import { collectLights, lightKey, type ScreenKind } from '../engine/lights'
import { drawFurniture, FURNITURE_HEADROOM, glows, type Paint } from './art'
import { PHASES } from './daylight'
import { drawScreen, screenRects } from './lamps'
import { P } from './palette'
import { renderDecorPanel } from './panel'
import { Renderer, type Canvas, type FrameState } from './render'
import { DECOR_STORAGE_KEY, emptyDecor, loadPacks, parseDecor, parsePack, serializeDecor, switchLight } from './skins'

const PALETTE = new Set<string>(Object.values(P).flatMap((v) => (Array.isArray(v) ? v : [v as string])))

function buffer(x0: number, y0: number, w: number, h: number) {
  const pixels = new Map<string, string>()
  const outside: string[] = []
  const foreign = new Set<string>()
  const paint: Paint = (x, y, pw, ph, color) => {
    if (!PALETTE.has(color)) foreign.add(color)
    for (let yy = y; yy < y + ph; yy += 1)
      for (let xx = x; xx < x + pw; xx += 1) {
        if (xx < x0 || yy < y0 || xx >= x0 + w || yy >= y0 + h) outside.push(`${xx},${yy}`)
        else pixels.set(`${xx},${yy}`, color)
      }
  }
  return { paint, pixels, outside, foreign, picture: () => [...pixels.entries()].sort().join(';') }
}

const LIGHTS: [FurnitureType, string[]][] = [
  ['floor-lamp', ['', 'arc', 'paper']],
  ['wall-lamp', ['', 'globe', 'bulb']],
  ['desk-lamp', ['', 'arm']],
  ['candles', ['', 'jar']],
  ['garland', ['', 'rainbow']],
  ['neon-sign', ['', 'heart', '247']],
  ['night-light', ['', 'star']]
]

function drawn(type: FurnitureType, variant: string, state: Parameters<typeof drawFurniture>[2]) {
  const spec = FURNITURE[type]
  const b = buffer(0, -FURNITURE_HEADROOM, spec.w * 16, spec.h * 16 + FURNITURE_HEADROOM)
  drawFurniture(b.paint, { type, w: spec.w, h: spec.h, facing: 'down', variant: variant || undefined }, state)
  return b
}

test('night: lamps are off by day and lit at night; only lit ones have pixels that shine', () => {
  assert.equal(PHASES.day.lamps, false)
  assert.equal(PHASES.day.dark, undefined, 'by day no dark and no light map')
  assert.equal(PHASES.morning.lamps, false)
  assert.ok(PHASES.night.lamps && PHASES.night.dark && PHASES.night.dark.alpha > 0.4, 'at night the dark and the lamps')
  assert.ok(PHASES.evening.lamps && PHASES.evening.dark && PHASES.evening.dark.alpha < PHASES.night.dark!.alpha, 'the evening is lighter')
  for (const [type, variants] of LIGHTS) {
    for (const variant of variants) {
      for (const frame of [0, 3, 7]) {
        const off = drawn(type, variant, { lit: false, frame })
        const on = drawn(type, variant, { lit: true, frame })
        for (const b of [off, on]) {
          assert.deepEqual(b.outside.slice(0, 3), [], `${type}/${variant} inside its footprint and headroom`)
          assert.deepEqual([...b.foreign], [], `${type}/${variant} in palette colours`)
        }
        assert.notEqual(off.picture(), on.picture(), `${type}/${variant}: lit looks different`)
        assert.equal(drawn(type, variant, { lit: false, frame, glowOnly: true }).pixels.size, 0, `${type}/${variant}: off, nothing shines`)
        assert.ok(drawn(type, variant, { lit: true, frame, glowOnly: true }).pixels.size > 0, `${type}/${variant}: lit, it shines`)
        assert.equal(glows(type, { lit: false }), false)
        assert.equal(glows(type, { lit: true }), true)
      }
    }
  }
  // Candle flames tremble with the one ambient timer.
  const flames = new Set([0, 1, 2, 3, 4, 5].map((f) => drawn('candles', '', { lit: true, frame: f, glowOnly: true }).picture()))
  assert.ok(flames.size > 1, 'the flames move')
})

test('night: the microwave, the coffee machine and the fridge light up only while in use', () => {
  for (const type of ['microwave', 'coffee-machine', 'fridge'] as FurnitureType[]) {
    const idle = drawn(type, '', { lit: true, frame: 1 })
    const busy = drawn(type, '', { lit: true, active: true, frame: 1 })
    assert.deepEqual(busy.outside.slice(0, 3), [], `${type} in use stays in its box`)
    assert.deepEqual([...busy.foreign], [], type)
    assert.notEqual(idle.picture(), busy.picture(), `${type} looks used`)
    assert.equal(drawn(type, '', { lit: true, frame: 1, glowOnly: true }).pixels.size, 0, `${type} idle: dark even at night`)
    assert.ok(drawn(type, '', { lit: true, active: true, frame: 1, glowOnly: true }).pixels.size > 0, `${type} in use: it shines`)
    assert.equal(glows(type, { lit: true }), false)
    assert.equal(glows(type, { active: true }), true)
  }
  // The microwave hums: in use it changes from frame to frame (shakes, the plate turns); idle it keeps still.
  const hum = new Set([0, 1, 2, 3].map((f) => drawn('microwave', '', { active: true, frame: f }).picture()))
  const still = new Set([0, 1, 2, 3].map((f) => drawn('microwave', '', { frame: f }).picture()))
  assert.ok(hum.size >= 3, 'it hums')
  assert.equal(still.size, 1, 'idle: still')
})

test('night: screens show live work by role, a screensaver when away, nothing when off', () => {
  const kinds: ScreenKind[] = ['code', 'logs', 'chart', 'chat', 'saver-logo', 'saver-stars']
  const pictures = new Map<ScreenKind, string>()
  for (const kind of kinds) {
    const frames = new Set<string>()
    for (let f = 0; f < 16; f += 1) {
      const b = buffer(0, 0, 14, 9)
      drawScreen(b.paint, kind, 14, 9, f)
      assert.deepEqual(b.outside, [], `${kind} stays on the screen`)
      assert.deepEqual([...b.foreign], [], kind)
      assert.equal(b.pixels.size, 14 * 9, `${kind} fills the screen`)
      frames.add(b.picture())
      if (f === 0) pictures.set(kind, b.picture())
    }
    assert.ok(frames.size > 3, `${kind} is alive`)
  }
  assert.equal(new Set(pictures.values()).size, kinds.length, 'every kind looks different')
  const off = buffer(0, 0, 14, 9)
  drawScreen(off.paint, 'off', 14, 9, 3)
  assert.equal(off.pixels.size, 0)
  // Where the screens are: one monitor, three on the tech desk, the lid logo of a laptop facing down.
  assert.equal(screenRects({ w: 2, facing: 'up' }).length, 1)
  assert.equal(screenRects({ w: 2, facing: 'up', variant: 'multi' }).length, 3)
  assert.ok(screenRects({ w: 2, facing: 'down' })[0].lid)
})

function fakeCanvas(width: number, height: number) {
  const calls = { drawImage: 0, putImageData: 0, ops: [] as string[] }
  const ctx: Record<string, unknown> = {
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    fillRect: () => {},
    clearRect: () => {},
    drawImage: () => (calls.drawImage += 1),
    fillText: () => {},
    measureText: (text: string) => ({ width: text.length * 7 }),
    save: () => {},
    restore: () => {},
    setLineDash: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    strokeRect: () => {},
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: () => (calls.putImageData += 1)
  }
  return { canvas: { width, height, getContext: () => ctx } as unknown as Canvas, ctx, calls }
}

test('night: the light map is built once per change, not every frame', () => {
  const world = realMap()
  const renderer = new Renderer(world, (w, h) => fakeCanvas(w, h).canvas)
  const screen = fakeCanvas(1600, 1000)
  const view = { width: 1600, height: 1000 }
  const lights = collectLights(world, { on: true, off: new Set(), using: new Set(), screens: new Map() })
  const base: FrameState = { camera: fitCamera(view, renderer.size), view, actors: [], labels: new Map(), desks: new Map(), typingFrame: 0, bobFrame: 0, dpr: 1, hover: null }
  const ctx = screen.ctx as unknown as CanvasRenderingContext2D
  renderer.draw(ctx, { ...base, daylight: { tint: null, lamps: false } })
  assert.equal(renderer.lightBuilds, 0, 'by day: no light map at all')
  const night = { ...base, lighting: { key: 'night|a', dark: { color: '#060a26', alpha: 0.6 }, lights }, lamps: { on: true, off: new Set<string>() } }
  for (let frame = 0; frame < 5; frame += 1) renderer.draw(ctx, { ...night, ambientFrame: frame })
  assert.equal(renderer.lightBuilds, 1, 'five night frames, candles flickering: one map')
  const lamp = world.furniture.find((f) => f.type === 'floor-lamp')!
  const fewer = lights.filter((l) => l.key !== lightKey(lamp))
  renderer.draw(ctx, { ...night, lighting: { ...night.lighting, key: 'night|lamp-off', lights: fewer }, lamps: { on: true, off: new Set([lightKey(lamp)]) } })
  renderer.draw(ctx, { ...night, lighting: { ...night.lighting, key: 'night|lamp-off', lights: fewer }, lamps: { on: true, off: new Set([lightKey(lamp)]) } })
  assert.equal(renderer.lightBuilds, 2, 'a lamp switched off: built again, once')
})

function memoryStorage() {
  const data = new Map<string, unknown>()
  return { data, get: async (k: string) => data.get(k) ?? null, set: async (k: string, v: unknown) => void data.set(k, JSON.parse(JSON.stringify(v))) }
}

test('night: a lamp is switched off in «Оформление», and the choice is kept in the plugin storage', async () => {
  const world = realMap()
  const lamp = world.furniture.find((f) => f.type === 'floor-lamp' && f.room === 'lounge')!
  const key = lightKey(lamp)
  const off = switchLight(emptyDecor(), key, false)
  assert.deepEqual(off.off, [key])
  const storage = memoryStorage()
  await storage.set(DECOR_STORAGE_KEY, serializeDecor(off))
  const back = parseDecor(await storage.get(DECOR_STORAGE_KEY), new Set())
  assert.deepEqual(back.off, [key], 'read back after a restart')
  assert.ok(!collectLights(world, { on: true, off: new Set(back.off), using: new Set(), screens: new Map() }).some((l) => l.key === key), 'dark at night')
  assert.deepEqual(switchLight(back, key, true).off, [], 'and on again')
  assert.deepEqual(parseDecor({ off: [42, '', key, key] }, new Set()).off, [key], 'junk dropped')
  // The panel offers the switch for lights only.
  const panel = (light: { on: boolean } | null) => renderDecorPanel({ title: 'Торшер', subtitle: '', sections: [], light })
  assert.ok(panel({ on: true }).includes('data-act="decorLight"') && panel({ on: true }).includes('выключить'))
  assert.ok(panel({ on: false }).includes('включить'))
  assert.ok(!panel(null).includes('decorLight'))
})

test('night: more lights come as a skin pack, with their own colour of light', async () => {
  const read = async (file: string) => JSON.parse(readFileSync(new URL(`../office/skins/${file}`, import.meta.url).pathname, 'utf8'))
  const { packs, errors } = await loadPacks(read)
  assert.deepEqual(errors, [])
  const pack = packs.find((p) => p.id === 'lights')!
  assert.ok(pack && pack.license === 'MIT')
  assert.ok(pack.variants.length >= 5 && pack.variants.every((v) => v.light?.color))
  const bad = parsePack({ format: 1, id: 'x', name: 'X', variants: [{ id: 'a', name: 'A', target: 'sofa', light: { color: '#fff000' } }, { id: 'b', name: 'B', target: 'floor-lamp', light: { color: 'red', radius: 500 } }] }, 'x.json')
  assert.ok(bad.errors.some((e) => e.includes('variants[0].light') && e.includes('светильник')))
  assert.ok(bad.errors.some((e) => e.includes('variants[1].light.color')))
  assert.ok(bad.errors.some((e) => e.includes('variants[1].light.radius')))
})
