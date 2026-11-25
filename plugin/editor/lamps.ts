// The pictures of the night light (v7.2): lamps, candles, a garland, neon signs, a night light, the
// microwave, and what the screens show. Every picture paints with two brushes: `p` for what is lit
// by the room, `g` for what shines by itself (a lit shade, a flame, a screen). The renderer draws a
// thing once as it is and, at night, its `g` pixels again over the dark, so they glow.
import type { ScreenKind } from '../engine/lights'
import { P } from './palette'

export type Brush = (x: number, y: number, w: number, h: number, color: string) => void

const T = 16

function hash(...values: number[]): number {
  let h = 2166136261
  for (const v of values) {
    h ^= v
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** A floor lamp: a shade on a pole (``), an arc with a hanging globe (`arc`), a paper lantern (`paper`). */
export function floorLamp(p: Brush, g: Brush, lit: boolean, variant?: string): void {
  const shade = lit ? g : p
  const glow = lit ? P.lampLit : P.lampShade
  p(4, 13, 8, 2, P.lampPole)
  p(5, 12, 6, 1, P.lampPole)
  if (variant === 'arc') {
    p(4, -12, 2, 25, P.lampPole)
    p(5, -15, 5, 2, P.lampPole)
    p(9, -14, 2, 3, P.lampPole)
    shade(7, -11, 7, 5, glow)
    shade(8, -12, 5, 1, glow)
    if (lit) g(8, -6, 5, 1, P.lampBulb)
    return
  }
  if (variant === 'paper') {
    p(7, 2, 2, 11, P.lampPole)
    shade(4, -10, 8, 12, lit ? P.lampLit : P.paper)
    shade(3, -8, 10, 8, lit ? P.lampLit : P.paper)
    p(4, -6, 8, 1, lit ? P.lampBrass : P.paperLine)
    p(4, -2, 8, 1, lit ? P.lampBrass : P.paperLine)
    if (lit) g(6, -7, 4, 4, P.lampBulb)
    return
  }
  p(7, -5, 2, 18, P.lampPole)
  // The shade, wider at the bottom.
  for (let r = 0; r < 9; r += 1) {
    const w = 8 + Math.floor(r / 2)
    shade(8 - Math.floor(w / 2), -15 + r, w, 1, glow)
  }
  p(4, -6, 8, 1, P.lampBrass)
  if (lit) g(5, -5, 6, 1, P.lampBulb)
}

/** A wall lamp on the wall tile: a shade on a bracket (``), a globe (`globe`), a bare bulb (`bulb`). */
export function wallLamp(p: Brush, g: Brush, lit: boolean, variant?: string): void {
  const shade = lit ? g : p
  if (variant === 'globe') {
    p(7, 11, 2, 3, P.lampBrass)
    p(5, 13, 6, 1, P.lampBrass)
    shade(5, 4, 6, 7, lit ? P.lampLit : P.lampShade)
    shade(4, 5, 8, 5, lit ? P.lampLit : P.lampShade)
    if (lit) g(6, 6, 3, 2, P.lampBulb)
    return
  }
  if (variant === 'bulb') {
    p(8, 1, 1, 6, P.garlandWire)
    p(7, 7, 3, 2, P.lampPole)
    shade(7, 9, 3, 3, lit ? P.lampBulb : P.steel)
    shade(8, 12, 1, 1, lit ? P.lampLit : P.steel)
    return
  }
  p(7, 10, 2, 3, P.lampBrass)
  p(5, 12, 6, 2, P.lampBrass)
  for (let r = 0; r < 6; r += 1) shade(5 - Math.floor(r / 3), 4 + r, 6 + Math.floor(r / 3) * 2, 1, lit ? P.lampLit : P.lampShade)
  if (lit) g(5, 10, 6, 1, P.lampBulb)
}

/** A lamp on a desk, by its right edge: a banker's lamp (``) or one on an arm (`arm`). */
export function deskLamp(p: Brush, g: Brush, lit: boolean, variant?: string): void {
  if (variant === 'arm') {
    p(11, 6, 4, 2, P.lampPole)
    p(13, -5, 1, 11, P.lampPole)
    p(9, -6, 5, 1, P.lampPole)
    p(7, -7, 4, 3, P.lampPole)
    if (lit) g(7, -4, 4, 1, P.lampBulb)
    return
  }
  p(10, 6, 5, 2, P.lampBrass)
  p(12, 0, 1, 6, P.lampBrass)
  ;(lit ? g : p)(9, -3, 7, 3, P.bankerGreen)
  p(9, -3, 7, 1, P.leafHi)
  if (lit) g(10, 0, 5, 1, P.lampBulb)
}

/** A flame that trembles with the ambient frame: a tall or short tip, swaying a pixel. */
function flame(g: Brush, x: number, top: number, frame: number, seed: number): void {
  const v = hash(seed, frame) % 4
  const sway = v === 3 ? 1 : v === 2 ? -1 : 0
  const tall = v !== 1
  g(x + sway, top - (tall ? 3 : 2), 1, tall ? 2 : 1, P.flameTip)
  g(x, top - 1, 1, 1, P.flameCore)
  if (tall) g(x + sway, top - 4, 1, 1, P.flameTip)
}

/** Candles on a table: three of them (``) or one in a jar (`jar`). */
export function candles(p: Brush, g: Brush, lit: boolean, frame: number, variant?: string): void {
  if (variant === 'jar') {
    p(4, 0, 8, 8, P.glass)
    p(5, 1, 6, 7, P.glassHi)
    p(5, 4, 6, 4, P.candle)
    p(5, 4, 6, 1, P.candleLo)
    p(8, 2, 1, 2, P.wick)
    if (lit) {
      flame(g, 8, 3, frame, 7)
      g(5, 4, 6, 1, P.flameCore)
    }
    return
  }
  const sticks: [number, number][] = [
    [3, 5],
    [7, 8],
    [11, 4]
  ]
  sticks.forEach(([x, h], i) => {
    p(x, 8 - h, 2, h, P.candle)
    p(x + 1, 8 - h, 1, h, P.candleLo)
    p(x, 8 - h - 1, 1, 1, P.wick)
    if (lit) flame(g, x, 8 - h - 1, frame, i * 13 + 1)
  })
  p(2, 8, 12, 1, P.lampBrass)
}

/** A string of little lights along a wall; at night they twinkle, a rainbow string in turn. */
export function garland(p: Brush, g: Brush, lit: boolean, W: number, frame: number, variant?: string): void {
  const colors = variant === 'rainbow' ? [P.neonA, P.ledAmber, P.ledGreen, P.ledBlue] : [P.garlandWarm]
  for (let x = 0; x < W; x += 1) {
    const sag = Math.round(2 * Math.sin((x / 16) * Math.PI) ** 2)
    p(x, 3 + sag, 1, 1, P.garlandWire)
  }
  for (let x = 2, i = 0; x < W - 1; x += 4, i += 1) {
    const sag = Math.round(2 * Math.sin((x / 16) * Math.PI) ** 2)
    const color = colors[i % colors.length]
    if (!lit) {
      p(x, 4 + sag, 2, 2, P.garlandOff)
      continue
    }
    const dim = hash(i, Math.floor(frame / 3)) % 7 === 0
    g(x, 4 + sag, 2, 2, dim ? P.garlandOff : color)
    if (!dim) g(x, 6 + sag, 2, 1, color)
  }
}

const NEON_FONT: Record<string, string[]> = {
  '2': ['111', '001', '111', '100', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '7': ['111', '001', '010', '010', '010'],
  '/': ['001', '001', '010', '100', '100']
}

/** A neon sign: a coffee cup (``), a heart (`heart`) or «24/7» (`247`); now and then it blinks. */
export function neonSign(p: Brush, g: Brush, lit: boolean, frame: number, variant?: string): void {
  p(1, 2, 30, 13, P.ink)
  p(1, 2, 30, 1, P.metalLo)
  const blink = lit && hash(Math.floor(frame / 2), 41) % 23 === 0
  const on = lit && !blink
  const tube = on ? g : p
  const a = on ? (variant === '247' ? P.neonB : P.neonA) : P.neonOff
  const b = on ? (variant === 'heart' ? P.neonA : P.neonB) : P.neonOff
  if (variant === 'heart') {
    const rows = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000']
    rows.forEach((row, y) => [...row].forEach((c, x) => c === '1' && tube(12 + x, 5 + y, 1, 1, a)))
    tube(5, 7, 4, 1, b)
    tube(24, 7, 4, 1, b)
    return
  }
  if (variant === '247') {
    let x = 4
    for (const ch of '24/7') {
      NEON_FONT[ch].forEach((row, y) => [...row].forEach((c, dx) => c === '1' && tube(x + dx * 2, 4 + y * 2, 2, 2, ch === '/' ? b : a)))
      x += 7
    }
    return
  }
  // A cup with steam over it.
  tube(9, 8, 10, 1, a)
  tube(9, 8, 1, 5, a)
  tube(18, 8, 1, 5, a)
  tube(10, 13, 8, 1, a)
  tube(19, 9, 2, 1, a)
  tube(21, 9, 1, 3, a)
  tube(19, 11, 2, 1, a)
  const s = on ? frame % 2 : 0
  tube(11 + s, 4, 1, 3, b)
  tube(14 - s, 3, 1, 4, b)
  tube(17 + s, 4, 1, 3, b)
}

/** A little night light on the floor by the cat's bed: a moon (``) or a star (`star`). */
export function nightLight(p: Brush, g: Brush, lit: boolean, variant?: string): void {
  p(5, 12, 6, 3, P.plasticLo)
  p(6, 12, 4, 1, P.plastic)
  const b = lit ? g : p
  if (variant === 'star') {
    b(7, 3, 2, 9, lit ? P.moon : P.moonLo)
    b(4, 6, 8, 2, lit ? P.moon : P.moonLo)
    b(5, 8, 2, 2, lit ? P.moon : P.moonLo)
    b(9, 8, 2, 2, lit ? P.moon : P.moonLo)
    return
  }
  const rows = ['0111000', '1110000', '1100000', '1100000', '1110000', '0111100', '0011110']
  rows.forEach((row, y) => [...row].forEach((c, x) => c === '1' && b(5 + x, 4 + y, 1, 1, lit ? P.moon : P.moonLo)))
}

/** The microwave on its counter; in use its window glows, the plate turns and it hums (it shakes a pixel). */
export function microwave(p: Brush, g: Brush, active: boolean, frame: number): void {
  const j = active && frame % 2 ? 1 : 0
  p(1 + j, -12, 14, 13, P.microwaveLo)
  p(2 + j, -11, 12, 11, P.microwave)
  p(2 + j, -11, 12, 1, P.white)
  p(3 + j, -10, 8, 8, P.microwaveGlass)
  p(12 + j, -10, 1, 8, P.microwaveLo)
  p(12 + j, -4, 1, 1, P.metal)
  if (active) {
    g(3 + j, -10, 8, 8, P.microwaveLit)
    const t = frame % 4
    const plate: [number, number][] = [
      [5, -5],
      [6, -5],
      [7, -5],
      [6, -6]
    ]
    const [px, py] = plate[t]
    g(4 + j, -4, 6, 1, P.microwavePlate)
    g(px + j, py, 2, 2, P.flameTip)
    g(12 + j, -9, 1, 1, P.logOk)
    // The hum: little waves over the box.
    if (frame % 2) {
      g(4, -15, 2, 1, P.microwaveLit)
      g(9, -16, 2, 1, P.microwaveLit)
    } else {
      g(6, -16, 2, 1, P.microwaveLit)
      g(11, -15, 2, 1, P.microwaveLit)
    }
  } else {
    p(4 + j, -9, 2, 1, P.glass)
    p(12 + j, -9, 1, 1, P.metalLo)
  }
}

/** The fridge with its door open and the light on inside (drawn over the closed one). */
export function fridgeOpen(p: Brush, g: Brush): void {
  p(1, -16, 14, 31, P.steel)
  g(2, -15, 11, 28, P.fridgeLit)
  for (const y of [-9, -2, 5]) g(2, y, 11, 1, P.fridgeShelf)
  g(3, -13, 3, 4, P.markerRed)
  g(7, -12, 2, 3, P.leafHi)
  g(4, -6, 4, 4, P.gold)
  g(9, -5, 3, 3, P.white)
  g(3, 1, 5, 4, P.markerBlue)
  // The door, swung open towards us on the right.
  p(13, -16, 3, 31, P.plastic)
  p(15, -15, 1, 29, P.plasticLo)
}

// ── Screens ──────────────────────────────────────────────────────────────────────────────

/** Where a desk's screens are (footprint pixels): the monitor of a desk facing up, three on `multi`, the laptop's lid logo facing down. */
export function screenRects(item: { w: number; facing: 'up' | 'down'; variant?: string }): { x: number; y: number; w: number; h: number; lid?: boolean }[] {
  const W = item.w * T
  if (item.facing === 'down') {
    const lx = Math.floor(W / 2) - 6
    return [{ x: lx + 4, y: 0, w: 4, h: 3, lid: true }]
  }
  if (item.variant === 'multi') {
    return [0, 1, 2].map((i) => ({ x: i * 11 - (i === 2 ? 1 : 0) + 1, y: (i === 1 ? -12 : -9) + 1, w: 8, h: 7 }))
  }
  const mx = Math.floor(W / 2) - 8
  return [{ x: mx + 1, y: -10, w: 14, h: 9 }]
}

/** Frames a screen cycles through (the ambient frame, every other one). */
export const SCREEN_FRAMES = 48

/** What a screen shows, filling w×h: scrolling code, logs, a growing chart, a chat, a screensaver. */
export function drawScreen(g: Brush, kind: ScreenKind, w: number, h: number, frame: number, lid = false): void {
  const f = frame % SCREEN_FRAMES
  if (lid) {
    // The back of a laptop: its logo glows in the colour of what is on the screen.
    const color = kind === 'logs' ? P.logOk : kind === 'chart' ? P.chartBar : kind === 'chat' ? P.chatMe : kind.startsWith('saver') ? P.saverStar : P.codeA
    if (kind === 'off') return
    g(1, 0, 2, 1, color)
    g(1, 1, 2, 2, color)
    return
  }
  switch (kind) {
    case 'off':
      return
    case 'code': {
      g(0, 0, w, h, P.screenOn)
      const step = Math.floor(f / 2)
      for (let r = 0; r * 2 < h - 1; r += 1) {
        const line = step + r
        const indent = (hash(line, 3) % 3) * 2
        const len = 2 + (hash(line, 5) % Math.max(2, w - indent - 3))
        const color = [P.screenLine, P.codeA, P.codeB, P.codeC, P.screenLineDim][hash(line, 9) % 5]
        g(1 + indent, 1 + r * 2, Math.min(len, w - 2 - indent), 1, color)
      }
      if (f % 4 < 2) g(w - 3, h - 2, 1, 1, P.white)
      return
    }
    case 'logs': {
      g(0, 0, w, h, P.logBg)
      for (let r = 0; r < h; r += 1) {
        const line = f + r
        const v = hash(line, 17) % 12
        const color = v === 0 ? P.logErr : v < 3 ? P.logWarn : P.logOk
        g(1, r, 1, 1, color)
        if (r % 1 === 0) g(3, r, Math.min(w - 4, 2 + (hash(line, 23) % (w - 3))), 1, v === 0 ? P.logErr : P.screenLineDim)
      }
      return
    }
    case 'chart': {
      g(0, 0, w, h, P.chartBg)
      const bars = Math.max(3, Math.floor((w - 1) / 2))
      const t = Math.floor(f / 3)
      for (let i = 0; i < bars; i += 1) {
        const v = 1 + ((hash(i, t >> 2) % (h - 2)) + i) % (h - 2)
        const grow = i === bars - 1 ? Math.min(v, 1 + (t % 4)) : v
        g(1 + i * 2, h - 1 - grow, 1, grow, P.chartBar)
      }
      g(1, h - 1, w - 2, 1, P.chartLine)
      return
    }
    case 'chat': {
      g(0, 0, w, h, P.chatBg)
      const shift = Math.floor(f / 4)
      for (let r = 0; r * 3 < h + 3; r += 1) {
        const msg = shift + r
        const mine = hash(msg, 2) % 2 === 0
        const len = 3 + (hash(msg, 11) % Math.max(2, w - 6))
        const y = h - 2 - r * 3 + ((f % 4) > 2 ? -1 : 0)
        if (y < 0) continue
        g(mine ? w - 1 - len : 1, y, len, 2, mine ? P.chatMe : P.chatThem)
      }
      return
    }
    case 'saver-logo': {
      g(0, 0, w, h, P.saverBg)
      // A little logo drifting and bouncing off the edges.
      const lw = 3
      const lh = 2
      const spanX = Math.max(1, w - lw)
      const spanY = Math.max(1, h - lh)
      const bounce = (t: number, span: number) => {
        const m = t % (span * 2)
        return m < span ? m : span * 2 - m
      }
      const x = bounce(f, spanX)
      const y = bounce(f + 2, spanY)
      const colors = [P.codeA, P.chartBar, P.neonA, P.codeB]
      g(x, y, lw, lh, colors[Math.floor(f / spanX) % colors.length])
      return
    }
    case 'saver-stars': {
      g(0, 0, w, h, P.saverBg)
      const cx = Math.floor(w / 2)
      const cy = Math.floor(h / 2)
      for (let s = 0; s < 5; s += 1) {
        const life = 6
        const t = (f + s * 3) % life
        const ang = (hash(s, Math.floor((f + s * 3) / life)) % 8) * (Math.PI / 4)
        const x = Math.round(cx + Math.cos(ang) * t * (w / 10))
        const y = Math.round(cy + Math.sin(ang) * t * (h / 10))
        if (x >= 0 && x < w && y >= 0 && y < h) g(x, y, 1, 1, t > 3 ? P.white : P.saverStar)
      }
      return
    }
  }
}
