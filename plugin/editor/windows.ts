// The city behind the windows at night, alive: lit windows of the houses go out and come on at their
// own random times, rarely and never together; stars twinkle a little; now and then a car drives past
// or a plane flies over. All from the window's own seed and the office's one ambient frame (5 a
// second): nothing polls, nothing has its own timer. And what stands in front of a window covers it.
import { FURNITURE } from '../engine/catalog'
import type { PlacedFurniture } from '../engine/world'
import { FURNITURE_HEADROOM, nightWindow, T, type Paint } from './art'

function hash(...values: number[]): number {
  let h = 2166136261
  for (const v of values) {
    h ^= v
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** A window's seed: from where it hangs, so neighbours differ. */
export function windowSeed(item: Pick<PlacedFurniture, 'x' | 'y'>): number {
  return hash(item.x, item.y, 977) % 100000
}

/** One pixel that differs from the still night view this frame. `glow`: it shines (drawn as is); else it is lit by the room. */
export type WindowOp = { x: number; y: number; color: 'cityDark' | 'cityLight' | 'sky' | 'carHead' | 'carTail' | 'planeRed' | 'planeWhite'; glow: boolean }

/**
 * What changes behind a window `width` pixels wide at ambient frame `frame`:
 * - a lit window of a house goes out now and then (each its own period, 6–30 s, its own phase), an unlit
 *   one sometimes comes on;
 * - a star dims for a moment;
 * - every 25–60 s a car drives along the street, its headlight and tail light, for ~2.5 s;
 * - every 1–3 min a plane crosses the sky, blinking red and white, for ~8 s.
 */
export function windowOps(width: number, seed: number, frame: number): WindowOp[] {
  const view = nightWindow(width, seed)
  const ops: WindowOp[] = []
  const toggles = (k: number, rarity: number) => {
    const period = 30 + (hash(seed, k, 1) % 120)
    const phase = hash(seed, k, 2) % period
    const slot = Math.floor((frame + phase) / period)
    return hash(seed, k, slot, 3) % rarity === 0
  }
  view.lights.forEach(([x, y], k) => {
    if (toggles(k, 6)) ops.push({ x, y, color: 'cityDark', glow: false })
  })
  view.unlit.forEach(([x, y], k) => {
    if (toggles(k + 1000, 9)) ops.push({ x, y, color: 'cityLight', glow: true })
  })
  view.stars.forEach(([x, y], k) => {
    const beat = 2 + (k % 3)
    if (hash(seed, k, Math.floor(frame / beat), 4) % 6 === 0) ops.push({ x, y, color: 'sky', glow: false })
  })
  // A car on the street at the foot of the houses.
  const carCycle = 125 + (hash(seed, 9) % 175)
  const carT = (frame + (hash(seed, 10) % carCycle)) % carCycle
  const carLen = 12
  if (carT < carLen) {
    const right = hash(seed, 11) % 2 === 0
    const span = width - 6
    const pos = Math.round((carT / (carLen - 1)) * span)
    const x = 3 + (right ? pos : span - pos)
    ops.push({ x, y: 12, color: 'carHead', glow: true })
    const tail = right ? x - 1 : x + 1
    if (tail >= 2 && tail < width - 2) ops.push({ x: tail, y: 12, color: 'carTail', glow: true })
  }
  // A plane across the sky, blinking.
  const planeCycle = 300 + (hash(seed, 12) % 600)
  const planeT = (frame + (hash(seed, 13) % planeCycle)) % planeCycle
  const planeLen = 40
  if (planeT < planeLen) {
    const x = 2 + Math.round((planeT / (planeLen - 1)) * (width - 5))
    const y = 5 + (hash(seed, 14) % 2)
    ops.push({ x, y, color: planeT % 4 < 2 ? 'planeRed' : 'planeWhite', glow: true })
  }
  // Nothing on the frame bars, nothing outside the glass.
  return ops.filter((o) => o.x >= 2 && o.x < width - 2 && o.x % 16 !== 15 && o.x % 16 !== 0 && o.y >= 5 && o.y <= 12 && o.y !== 8)
}

/**
 * The pixels of a window (local: `x` across it, `y` 0..15 down its wall tile) that something standing in
 * front of it covers: every floor thing whose picture reaches up over it, drawn with `paint` (the office's
 * own art, in its current look). Night lights are drawn only where this is clear.
 */
export function windowCover(win: Pick<PlacedFurniture, 'x' | 'y' | 'w'>, furniture: readonly PlacedFurniture[], paint: (p: Paint, item: PlacedFurniture) => void): Set<string> {
  const covered = new Set<string>()
  const box = { x: win.x * T, y: win.y * T, w: win.w * T, h: T }
  for (const item of furniture) {
    if (FURNITURE[item.type].mount !== 'floor' || item.type === 'rug') continue
    const ib = { x: item.x * T, y: item.y * T - FURNITURE_HEADROOM, w: item.w * T, h: item.h * T + FURNITURE_HEADROOM }
    if (ib.x >= box.x + box.w || ib.x + ib.w <= box.x || ib.y >= box.y + box.h || ib.y + ib.h <= box.y) continue
    const ox = item.x * T - box.x
    const oy = item.y * T - box.y
    paint((x, y, w, h) => {
      for (let yy = y; yy < y + h; yy += 1) {
        for (let xx = x; xx < x + w; xx += 1) {
          const lx = ox + xx
          const ly = oy + yy
          if (lx >= 0 && ly >= 0 && lx < box.w && ly < T) covered.add(`${lx},${ly}`)
        }
      }
    }, item)
  }
  return covered
}
