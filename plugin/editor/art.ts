// All the pixel art of the office, drawn in code with rectangles on an art-pixel grid (one tile is
// 16×16). Nothing here touches a canvas: every function paints through `Paint`, so the renderer
// can bake the result into cached bitmaps and the tests can read it back pixel by pixel.
// Colours come only from editor/palette.ts.
import type { FloorKind, FurnitureType, WallStyle } from '../engine/catalog'
import type { Facing, PlacedFurniture } from '../engine/world'
import { defaultAppearance, pantsFor, type Accessory, type Appearance } from './appearance'
import { coatOf, paintPart, type CharacterSkin, type Dressed, type OwnerColors } from './characters'
import { HAIRS, P, SHIRTS, SKINS } from './palette'
import { candles, deskLamp, floorLamp, fridgeOpen, garland, microwave, neonSign, nightLight, wallLamp } from './lamps'

export type Paint = (x: number, y: number, w: number, h: number, color: string) => void

export const T = 16
/** Furniture bitmaps leave this much room above their footprint (tall things reach up the wall). */
export const FURNITURE_HEADROOM = 20
export const CHAR_W = 16
export const CHAR_H = 26

function hash(...values: number[]): number {
  let h = 2166136261
  for (const value of values) h = Math.imul(h ^ (value | 0), 16777619)
  h ^= h >>> 13
  return Math.imul(h, 2246822507) >>> 0
}

export function hashText(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

// ── Floors ───────────────────────────────────────────────────────────────────────────────

export function drawFloor(p: Paint, kind: FloorKind, tx: number, ty: number): void {
  switch (kind) {
    case 'wood':
      return planks(p, tx, ty, P.wood, P.woodAlt, P.woodSeam, P.woodHi)
    case 'parquet':
      return parquet(p, tx, ty)
    case 'carpet-red':
      return carpet(p, tx, ty, P.carpetRed, P.carpetRedAlt, P.carpetRedHi)
    case 'carpet-blue':
      return carpet(p, tx, ty, P.carpetBlue, P.carpetBlueAlt, P.carpetBlueHi)
    case 'carpet-green':
      return carpet(p, tx, ty, P.carpetGreen, P.carpetGreenAlt, P.carpetGreenHi)
    case 'tile':
      return tiles(p, tx, ty)
    case 'concrete':
      return concrete(p, tx, ty)
    case 'marble':
      return marble(p, tx, ty)
    case 'raised':
      return raised(p, tx, ty)
  }
}

/** Big polished slabs with grey veins. */
function marble(p: Paint, tx: number, ty: number): void {
  p(0, 0, 16, 16, (tx + ty) % 2 === 0 ? P.marble : P.marbleAlt)
  p(15, 0, 1, 16, P.marbleSeam)
  p(0, 15, 16, 1, P.marbleSeam)
  const h = hash(tx, ty, 5)
  if (h % 4 !== 0) return
  // A thin diagonal vein across one slab in four.
  let x = 2 + (h >>> 3) % 6
  for (let y = 2; y < 14; y += 1) {
    if (hash(tx, ty, y) % 2 === 0) x += 1
    if (x < 14) p(x, y, 1, 1, P.marbleVein)
  }
}

/** A server room's raised floor: square panels, every few of them a vented one. */
function raised(p: Paint, tx: number, ty: number): void {
  p(0, 0, 16, 16, P.raised)
  p(0, 0, 16, 1, P.raisedAlt)
  p(15, 0, 1, 16, P.raisedSeam)
  p(0, 15, 16, 1, P.raisedSeam)
  if (hash(tx, ty, 11) % 4 === 0) {
    for (let y = 3; y < 13; y += 3) for (let x = 3; x < 13; x += 3) p(x, y, 2, 2, P.raisedHole)
  } else {
    p(2, 2, 1, 1, P.raisedSeam)
    p(12, 12, 1, 1, P.raisedSeam)
  }
}

function planks(p: Paint, tx: number, ty: number, a: string, b: string, seam: string, hi: string): void {
  for (let r = 0; r < 4; r += 1) {
    const row = ty * 4 + r
    const shift = (row * 7) % 16
    const cut = (16 - shift) % 16
    const left = hash(tx, row) % 2 === 0 ? a : b
    const right = hash(tx + 1, row) % 2 === 0 ? a : b
    p(0, r * 4, 16, 4, left)
    if (cut > 0) p(cut, r * 4, 16 - cut, 4, right)
    p(0, r * 4 + 3, 16, 1, seam)
    if (cut > 0) p(cut, r * 4, 1, 3, seam)
    if (hash(tx, row, 3) % 3 === 0) p((hash(tx, row, 9) % 10) + 2, r * 4 + 1, 3, 1, hi)
  }
}

function parquet(p: Paint, tx: number, ty: number): void {
  for (let by = 0; by < 2; by += 1) {
    for (let bx = 0; bx < 2; bx += 1) {
      const x = bx * 8
      const y = by * 8
      const across = (tx * 2 + bx + ty * 2 + by) % 2 === 0
      p(x, y, 8, 8, P.parquet)
      for (let i = 0; i < 4; i += 1) {
        const color = i % 2 === 0 ? P.parquet : P.parquetAlt
        if (across) p(x, y + i * 2, 8, 2, color)
        else p(x + i * 2, y, 2, 8, color)
      }
      if (across) p(x, y + 7, 8, 1, P.parquetSeam)
      else p(x + 7, y, 1, 8, P.parquetSeam)
    }
  }
}

function carpet(p: Paint, tx: number, ty: number, base: string, alt: string, hi: string): void {
  p(0, 0, 16, 16, base)
  for (let y = 0; y < 16; y += 2) {
    for (let x = (y / 2) % 2 === 0 ? 0 : 2; x < 16; x += 4) {
      const gx = tx * 16 + x
      const gy = ty * 16 + y
      p(x, y, 1, 1, hash(gx, gy) % 5 === 0 ? hi : alt)
    }
  }
}

function tiles(p: Paint, tx: number, ty: number): void {
  for (let by = 0; by < 2; by += 1) {
    for (let bx = 0; bx < 2; bx += 1) {
      const dark = (tx * 2 + bx + ty * 2 + by) % 2 === 1
      p(bx * 8, by * 8, 8, 8, dark ? P.tileAlt : P.tile)
      p(bx * 8 + 7, by * 8, 1, 8, P.tileSeam)
      p(bx * 8, by * 8 + 7, 8, 1, P.tileSeam)
    }
  }
}

function concrete(p: Paint, tx: number, ty: number): void {
  p(0, 0, 16, 16, (tx + ty) % 2 === 0 ? P.concrete : P.concreteAlt)
  p(15, 0, 1, 16, P.concreteSeam)
  p(0, 15, 16, 1, P.concreteSeam)
  for (let i = 0; i < 3; i += 1) {
    const h = hash(tx, ty, i)
    p(h % 14, (h >>> 4) % 14, 1, 1, P.concreteDot)
  }
}

// ── Walls and doors ──────────────────────────────────────────────────────────────────────

/**
 * A wall tile. `face`: floor is right below, so we see the lit face of the wall with its skirting
 * board; otherwise only the dark cap from above, outlined where floor touches it.
 */
export function drawWall(p: Paint, face: boolean, floorAround: { n: boolean; e: boolean; w: boolean }, tx: number, style: WallStyle = 'plain'): void {
  if (face) {
    const [base, shade, dark] = wallColors(style)
    p(0, 0, 16, 4, P.wallCap)
    p(0, 3, 16, 1, P.wallCapEdge)
    p(0, 4, 16, 10, base)
    p(0, 4, 16, 1, shade)
    if (style === 'stripes') {
      // Wallpaper: warm stripes and a dado rail.
      for (let x = 1; x < 16; x += 4) p(x, 5, 2, 8, P.wallStripeAlt)
      p(0, 10, 16, 1, P.wallStripeDark)
    } else if (style === 'bare') {
      // Bare plaster: fresh patches and a strip of masking tape.
      const h = hash(tx, 17)
      p(h % 9, 6 + (h >>> 4) % 4, 5, 3, P.wallBarePatch)
      if (h % 3 === 0) p(2, 5, 6, 1, P.tape)
    } else if (tx % 2 === 0) p(15, 5, 1, 9, shade)
    p(0, 13, 16, 1, dark)
    p(0, 14, 16, 1, P.wallBase)
    p(0, 15, 16, 1, P.wallBaseDark)
    return
  }
  p(0, 0, 16, 16, P.wallCap)
  if (floorAround.n) p(0, 0, 16, 1, P.wallCapEdge)
  if (floorAround.w) p(0, 0, 1, 16, P.wallCapEdge)
  if (floorAround.e) p(15, 0, 1, 16, P.wallCapEdge)
}

function wallColors(style: WallStyle): [string, string, string] {
  switch (style) {
    case 'navy':
      return [P.wallNavy, P.wallNavyShade, P.wallNavyDark]
    case 'rose':
      return [P.wallRose, P.wallRoseShade, P.wallRoseDark]
    case 'sage':
      return [P.wallSage, P.wallSageShade, P.wallSageDark]
    case 'stripes':
      return [P.wallStripe, P.wallStripeAlt, P.wallStripeDark]
    case 'bare':
      return [P.wallBare, P.wallBareDark, P.wallBareDark]
    default:
      return [P.wallFace, P.wallFaceShade, P.wallFaceDark]
  }
}

/** An open doorway: the floor shows through, with the frame's posts. */
export function drawDoor(p: Paint, orientation: 'h' | 'v', owner: boolean): void {
  const post = owner ? P.ownerDoor : P.doorFrame
  const postHi = owner ? P.gold : P.doorFrameHi
  if (orientation === 'h') {
    p(0, 0, 2, 16, post)
    p(14, 0, 2, 16, post)
    p(1, 0, 1, 16, postHi)
    p(14, 0, 1, 16, postHi)
    p(2, 0, 12, 2, P.wallCap)
    p(2, 14, 12, 2, owner ? P.ownerDoor : P.wallBaseDark)
    if (owner) p(4, 15, 8, 1, P.gold)
  } else {
    p(0, 0, 16, 2, post)
    p(0, 14, 16, 2, post)
    p(0, 1, 16, 1, postHi)
  }
}

// ── Things on walls ──────────────────────────────────────────────────────────────────────

/** Wall decoration across `w` tiles, drawn on the wall face (rows 4..13 of the tile). */
export function drawWallItem(p: Paint, item: Pick<PlacedFurniture, 'type' | 'w'> & { variant?: string }, state: FurnitureState = {}): void {
  const width = item.w * T
  switch (item.type) {
    case 'wall-lamp':
    case 'garland':
    case 'neon-sign':
      // Lights on walls are drawn live by the renderer (lit or not); the same picture.
      return drawFurniture(p, { ...item, h: 1, facing: 'down' }, state)
    case 'window': {
      // `g` paints what shines at night (stars, lit windows of the city); with `glowOnly` only that.
      const g = p
      const b: Paint = state.glowOnly ? () => {} : p
      b(1, 4, width - 2, 10, P.frame)
      if (state.inside) {
        // A window into the next room: through the glass its floor, a streak of reflection; no sky.
        if (state.glowOnly) return
        const floor = state.beyond ?? P.concrete
        b(2, 5, width - 4, 8, floor)
        for (let i = 0; i < 4; i += 1) b(4 + i, 9 - i, 1, 1, P.glassHi)
        b(width - 9, 11, 3, 1, P.glassHi)
        for (let x = 16; x < width - 1; x += 16) b(x - 1, 5, 2, 8, P.frame)
        b(2, 8, width - 4, 1, P.frame)
        b(0, 13, width, 1, P.frameLo)
        return
      }
      b(2, 5, width - 4, 8, P.sky)
      if (state.night) {
        // Night: a deep blue sky with stars over the dark blocks of the city and their lit windows.
        const view = nightWindow(width, state.seed ?? 0)
        for (const [x, y, h] of view.blocks) b(x, y, 1, h, P.cityDark)
        for (const [x, y] of view.stars) g(x, y, 1, 1, P.star)
        for (const [x, y] of view.lights) g(x, y, 1, 1, P.cityLight)
      } else {
        b(2, 10, width - 4, 3, P.glass)
        b(4, 6, 3, 1, P.glassHi)
        b(5, 7, 1, 1, P.glassHi)
      }
      for (let x = 16; x < width - 1; x += 16) b(x - 1, 5, 2, 8, P.frame)
      b(2, 8, width - 4, 1, P.frame)
      b(0, 13, width, 1, P.frameLo)
      return
    }
    case 'whiteboard': {
      p(2, 4, width - 4, 9, P.steelLo)
      p(3, 5, width - 6, 7, P.board)
      if (item.variant === 'arch') {
        // The architecture: three boxes and the arrows between them.
        p(5, 6, 6, 3, P.markerBlue)
        p(6, 7, 4, 1, P.board)
        p(20, 6, 7, 3, P.markerGreen)
        p(21, 7, 5, 1, P.board)
        p(12, 9, 8, 3, P.markerRed)
        p(13, 10, 6, 1, P.board)
        p(11, 7, 9, 1, P.ink)
        p(8, 9, 1, 2, P.ink)
        p(9, 10, 3, 1, P.ink)
        p(23, 9, 1, 2, P.ink)
        p(20, 10, 3, 1, P.ink)
        p(4, 12, width - 8, 1, P.steel)
        return
      }
      p(5, 6, 8, 1, P.markerBlue)
      p(5, 8, 12, 1, P.markerBlue)
      p(18, 6, 6, 4, P.markerRed)
      p(19, 7, 4, 2, P.board)
      p(7, 10, 6, 1, P.markerGreen)
      p(4, 12, width - 8, 1, P.steel)
      return
    }
    case 'tv': {
      p(2, 4, width - 4, 9, P.metalLo)
      p(3, 5, width - 6, 7, P.screenOff)
      p(4, 6, 4, 1, P.metal)
      p(width / 2 - 2, 13, 4, 1, P.metalLo)
      return
    }
    case 'clock': {
      // The face only: the hands show the real time and are drawn over it (drawClockHands).
      p(4, 4, 8, 9, P.ink)
      p(3, 5, 10, 7, P.ink)
      p(4, 5, 8, 7, P.white)
      p(5, 4, 6, 9, P.white)
      p(7, 4, 1, 1, P.metal)
      p(7, 12, 1, 1, P.metal)
      p(3, 8, 1, 1, P.metal)
      p(11, 8, 1, 1, P.metal)
      return
    }
    case 'mirror': {
      p(4, 4, 8, 10, P.gold)
      p(3, 5, 10, 8, P.gold)
      p(5, 5, 6, 8, P.mirrorGlass)
      p(4, 6, 8, 6, P.mirrorGlass)
      p(6, 6, 1, 3, P.white)
      p(7, 6, 1, 1, P.white)
      p(5, 13, 6, 1, P.goldDark)
      return
    }
    case 'chart': {
      // A sales poster: bars going up and the arrow over them (decoration, it shows no data).
      p(2, 4, width - 4, 10, P.frameLo)
      p(3, 5, width - 6, 8, P.board)
      const bars = [2, 3, 3, 5, 6, 7]
      bars.forEach((hgt, i) => p(6 + i * 4, 12 - hgt, 3, hgt, i === bars.length - 1 ? P.markerGreen : P.markerBlue))
      p(5, 12, width - 10, 1, P.ink)
      p(7, 9, 2, 1, P.markerRed)
      p(9, 8, 4, 1, P.markerRed)
      p(13, 7, 6, 1, P.markerRed)
      p(19, 6, 6, 1, P.markerRed)
      p(24, 5, 2, 1, P.markerRed)
      return
    }
    case 'sign': {
      // «СДАЁТСЯ» on a white plate with a red border.
      p(0, 4, width, 10, P.markerRed)
      p(1, 5, width - 2, 8, P.white)
      drawText(p, 'СДАЁТСЯ', Math.floor((width - textWidth('СДАЁТСЯ')) / 2), 7, P.markerRed)
      return
    }
    case 'notice-board': {
      // Cork with two cards; the numbers on them are real and drawn over it (drawNoticeNumbers).
      p(1, 4, width - 2, 10, P.darkWood)
      p(2, 5, width - 4, 8, P.cork)
      p(3, 11, 2, 1, P.corkLo)
      p(25, 6, 2, 1, P.corkLo)
      p(3, 5, 12, 8, P.noteYellow)
      p(17, 5, 12, 8, P.noteGreen)
      p(8, 5, 2, 1, P.markerRed)
      p(22, 5, 2, 1, P.markerRed)
      return
    }
    case 'picture': {
      p(3, 5, 10, 8, P.darkWood)
      p(4, 6, 8, 6, P.sky)
      p(4, 9, 8, 3, P.leaf)
      p(6, 8, 4, 1, P.leafHi)
      p(9, 7, 2, 1, P.gold)
      return
    }
    default:
      return
  }
}

// ── Furniture on the floor ───────────────────────────────────────────────────────────────

export type FurnitureState = {
  /** Desks: whether the bot at it is working right now (its screen is on). */
  screenOn?: boolean
  /** Desks: whether someone sits on the chair (then its back is hidden behind them). */
  occupied?: boolean
  /** Desks: sheets in the paper stack, which grows while its bot works long (0: the usual papers). */
  papers?: number
  /** Living things (server LEDs, fish, steam, bubbles): the ambient frame; 0 when still. */
  frame?: number
  /** Lights (lamps, candles, signs, the CEO's lamp, racks, the aquarium): shining now (evening, night, not switched off). */
  lit?: boolean
  /** Appliances: a bot is using it (the microwave hums, the fridge is open, the coffee machine pours). */
  active?: boolean
  /** Only what shines by itself, for drawing again over the dark at night. */
  glowOnly?: boolean
  /** Windows: it is night (a dark blue sky, stars, the lights of the city). */
  night?: boolean
  /** Windows: the window's own seed, so no two windows show the same city. */
  seed?: number
  /** Windows: it looks into the next room (no sky, no city), whose floor shows through in `beyond`. */
  inside?: boolean
  beyond?: string
}

const NOTHING: Paint = () => {}

/** Furniture whose picture changes with the ambient frame. */
export const ANIMATED: ReadonlySet<FurnitureType> = new Set<FurnitureType>(['server-rack', 'aquarium', 'coffee-machine', 'water-cooler', 'candles', 'garland', 'neon-sign', 'microwave'])

/** The main colour of a floor kind (what a window into that room shows through its glass). */
export function floorTone(kind: FloorKind | null | undefined): string {
  switch (kind) {
    case 'wood':
      return P.wood
    case 'parquet':
      return P.parquet
    case 'carpet-red':
      return P.carpetRed
    case 'carpet-blue':
      return P.carpetBlue
    case 'carpet-green':
      return P.carpetGreen
    case 'tile':
      return P.tile
    case 'marble':
      return P.marble
    case 'raised':
      return P.raised
    default:
      return P.concrete
  }
}

/**
 * What a window shows at night (pixels of the wall tile row, `width` wide): the dark blocks of the city
 * (x, top, height), its lit windows and the stars, from the window's own seed. Nothing on the frame bars.
 */
export function nightWindow(width: number, seed: number): { blocks: [number, number, number][]; lights: [number, number][]; unlit: [number, number][]; stars: [number, number][] } {
  const glass = (x: number) => x >= 2 && x < width - 2 && x % 16 !== 15 && x % 16 !== 0
  const blocks: [number, number, number][] = []
  const lights: [number, number][] = []
  const unlit: [number, number][] = []
  const stars: [number, number][] = []
  for (let x = 2; x < width - 2; x += 1) {
    const h = 1 + (hash(Math.floor(x / 3), 11, width, seed) % 3)
    blocks.push([x, 13 - h, h])
    if (!glass(x) || h < 2) continue
    if (hash(x, 5, seed) % 3 === 0) lights.push([x, 13 - h + 1])
    else unlit.push([x, 13 - h + 1])
  }
  for (let x = 3; x < width - 3; x += 1) if (glass(x) && hash(x, 7, width, seed) % 5 === 0) stars.push([x, 5 + (hash(x, 3, seed) % 3)])
  return { blocks, lights, unlit, stars }
}

/** Whether a thing in this state has pixels that shine by themselves (drawn again over the dark). */
export function glows(type: FurnitureType, state: FurnitureState): boolean {
  if (type === 'microwave' || type === 'fridge' || type === 'coffee-machine') return !!state.active
  return !!state.lit && LIT_TYPES.has(type)
}
const LIT_TYPES: ReadonlySet<FurnitureType> = new Set<FurnitureType>(['floor-lamp', 'wall-lamp', 'desk-lamp', 'candles', 'garland', 'neon-sign', 'night-light', 'ceo-desk', 'server-rack', 'aquarium', 'device-stand'])

/**
 * One floor item, its footprint's top-left at (0,0); tall things draw up to
 * FURNITURE_HEADROOM pixels above it. Desk chairs are drawn by `drawDeskChair`.
 */
export function drawFurniture(brush: Paint, item: Pick<PlacedFurniture, 'type' | 'w' | 'h' | 'facing' | 'variant'>, state: FurnitureState = {}): void {
  const W = item.w * T
  const H = item.h * T
  const frame = state.frame ?? 0
  // `g` paints what shines by itself; with `glowOnly` nothing else is painted.
  const g = brush
  const p = state.glowOnly ? NOTHING : brush
  const lit = !!state.lit
  switch (item.type) {
    case 'desk':
      if (item.facing === 'up') deskUp(p, W, !!state.screenOn, item.variant, (state.papers ?? 0) > 0)
      else deskDown(p, W, !!state.screenOn, item.variant, (state.papers ?? 0) > 0)
      paperStack(p, state.papers ?? 0, W - 10, 8)
      return
    case 'ceo-desk':
      ceoDesk(p)
      if (lit) {
        g(37, 8, 8, 3, P.lampLit)
        g(38, 11, 6, 1, P.lampBulb)
      }
      return
    case 'chair':
      return chair(p, item.facing === 'down' ? 'down' : 'up', false)
    case 'armchair':
      return armchair(p)
    case 'kitchen-table':
      return table(p, W, H, P.parquet, P.white, P.parquetAlt)
    case 'coffee-table':
      return coffeeTable(p, W)
    case 'sofa':
      return sofa(p, W)
    case 'counter':
      return counter(p, W)
    case 'sink':
      counter(p, W)
      p(3, -1, 10, 4, P.steelLo)
      p(4, 0, 8, 2, P.steel)
      p(7, -4, 2, 3, P.steelLo)
      p(7, -4, 4, 1, P.steelLo)
      return
    case 'stove':
      counter(p, W)
      p(1, -2, 14, 6, P.burner)
      p(3, -1, 4, 2, P.metal)
      p(9, -1, 4, 2, P.metal)
      p(4, -1, 2, 1, P.flame)
      p(5, 6, 6, 1, P.steel)
      return
    case 'coffee-machine':
      counter(p, W)
      p(3, -10, 10, 12, P.metalLo)
      p(4, -9, 8, 3, P.metal)
      p(5, -5, 6, 4, P.ink)
      p(6, -3, 4, 3, P.white)
      p(7, -2, 2, 1, P.coffee)
      p(10, -8, 1, 1, P.blocked)
      if (state.active) {
        // Pouring: the display and the spout light up, a stream runs into the cup.
        g(5, -8, 4, 1, P.logOk)
        g(10, -8, 1, 1, P.ledGreen)
        g(5, -5, 6, 1, P.ledAmber)
        g(7, -4, 2, 1 + (frame % 2), P.coffee)
        g(6, -3, 4, 1, P.flameCore)
        steam(p, frame + 1)
      }
      steam(p, frame)
      return
    case 'fridge':
      if (state.active) return fridgeOpen(p, g)
      p(1, -16, 14, 31, P.steel)
      p(2, -15, 12, 29, P.plastic)
      p(2, -5, 12, 1, P.steelLo)
      p(11, -12, 1, 5, P.steelLo)
      p(11, -2, 1, 7, P.steelLo)
      p(2, 13, 12, 1, P.plasticLo)
      p(4, -13, 3, 2, P.markerRed)
      p(7, -11, 2, 2, P.gold)
      return
    case 'plant':
      return plant(p, false, item.variant)
    case 'big-plant':
      return plant(p, true, item.variant)
    case 'bookshelf':
      return bookshelf(p, W)
    case 'water-cooler':
      p(3, 2, 10, 13, P.plastic)
      p(3, 14, 10, 1, P.plasticLo)
      p(4, 6, 3, 2, P.markerBlue)
      p(9, 6, 3, 2, P.markerRed)
      p(4, -9, 8, 11, P.water)
      p(5, -8, 2, 8, P.waterHi)
      p(5, -10, 6, 1, P.markerBlue)
      gurgle(p, frame)
      return
    case 'printer':
      p(1, 2, 14, 11, P.plasticLo)
      p(1, 2, 14, 2, P.plastic)
      p(3, -1, 10, 4, P.paper)
      p(3, 8, 10, 2, P.metalLo)
      p(11, 5, 2, 1, P.working)
      p(1, 13, 14, 2, P.metal)
      return
    case 'rug':
      return rug(p, W, H, item.variant)
    case 'loveseat':
      return loveseat(p, W)
    case 'server-rack':
      return serverRack(p, lit ? g : p, frame)
    case 'trophy':
      return trophy(p)
    case 'flowers':
      return flowers(p)
    case 'boxes':
      return boxes(p)
    case 'ladder':
      return ladder(p)
    case 'paint':
      return paint(p)
    case 'aquarium':
      return aquarium(p, lit ? g : p, W, frame)
    case 'floor-lamp':
      return floorLamp(p, g, lit, item.variant)
    case 'wall-lamp':
      return wallLamp(p, g, lit, item.variant)
    case 'desk-lamp':
      return deskLamp(p, g, lit, item.variant)
    case 'candles':
      return candles(p, g, lit, frame, item.variant)
    case 'garland':
      return garland(p, g, lit, W, frame, item.variant)
    case 'neon-sign':
      return neonSign(p, g, lit, frame, item.variant)
    case 'night-light':
      return nightLight(p, g, lit, item.variant)
    case 'microwave':
      counter(p, W)
      return microwave(p, g, !!state.active, frame)
    case 'device-stand':
      return deviceStand(p, lit ? g : p)
    case 'pet-bowl':
      p(3, 10, 10, 4, P.steelLo)
      p(4, 9, 8, 2, P.steel)
      p(5, 9, 6, 1, P.coffee)
      p(6, 8, 2, 1, P.cardboard)
      p(4, 14, 8, 1, P.metalLo)
      return
    case 'bird-cage':
      // A stand, a round cage of gold bars, a swing inside.
      p(7, 6, 2, 8, P.darkWood)
      p(4, 13, 8, 2, P.darkWoodLo)
      p(3, -16, 10, 1, P.goldDark)
      p(5, -18, 6, 2, P.gold)
      p(7, -19, 2, 1, P.goldDark)
      for (let x = 3; x < 13; x += 3) p(x, -15, 1, 19, P.gold)
      p(12, -15, 1, 19, P.gold)
      p(3, 4, 10, 2, P.goldDark)
      p(5, -4, 6, 1, P.darkWood)
      return
    case 'pet-bed':
      p(1, 8, 14, 7, P.petBed)
      p(2, 7, 12, 1, P.petBedHi)
      p(0, 9, 1, 5, P.petBed)
      p(15, 9, 1, 5, P.petBed)
      p(3, 10, 10, 3, P.petBedHi)
      return
    default:
      return
  }
}

/** A QA lab's device stand: a cabinet with a rack, phones and tablets on its two shelves, screens on. */
function deviceStand(p: Paint, screen: Paint): void {
  p(1, 6, 30, 9, P.metalLo)
  p(2, 7, 28, 7, P.metal)
  p(4, 9, 10, 1, P.metalLo)
  p(18, 9, 10, 1, P.metalLo)
  p(1, 14, 30, 1, P.ink)
  p(2, -15, 2, 21, P.metalLo)
  p(28, -15, 2, 21, P.metalLo)
  p(2, -15, 28, 1, P.metalHi)
  p(2, -4, 28, 2, P.metalLo)
  const device = (x: number, y: number, w: number, h: number, ui: string[]) => {
    p(x, y, w, h, P.ink)
    screen(x + 1, y + 1, w - 2, h - 2, P.screenOn)
    ui.forEach((c, i) => screen(x + 1, y + 1 + i * 2, Math.max(1, w - 2 - (i % 2)), 1, c))
  }
  // Top shelf: two phones and a tablet; bottom: a tablet and a phone on the cabinet.
  device(5, -13, 4, 8, [P.codeA, P.chartBar, P.chatMe])
  device(11, -13, 4, 8, [P.neonA, P.screenLine, P.codeB])
  device(17, -12, 9, 7, [P.chatMe, P.chatThem, P.logOk])
  device(6, -1, 8, 7, [P.chartBar, P.codeA, P.screenLine])
  device(18, -2, 4, 8, [P.logOk, P.codeC, P.chatMe])
}

/** The paper stack on a desk: one sheet more for every few minutes its bot keeps working. */
function paperStack(p: Paint, sheets: number, x: number, bottom: number): void {
  for (let i = 0; i < Math.min(sheets, 12); i += 1) {
    const shift = hash(i, 31) % 2
    p(x + shift, bottom - i, 7, 1, i % 3 === 2 ? P.paperLine : P.paper)
  }
}

/** Steam over the coffee machine: puffs rising and fading with the frame. */
function steam(p: Paint, frame: number): void {
  for (let k = 0; k < 3; k += 1) {
    const t = (frame + k * 3) % 8
    if (t > 4) continue
    const x = 6 + ((t + k) % 3) - 1
    p(x, -12 - t * 2, t < 4 ? 2 : 1, t < 4 ? 2 : 1, P.steam)
  }
}

/** Now and then the cooler's bottle gurgles: bubbles go up for a few frames. */
function gurgle(p: Paint, frame: number): void {
  const t = frame % 75
  if (t >= 8) return
  for (let k = 0; k < 3; k += 1) {
    const y = 0 - ((t + k * 3) % 9)
    if (y > -9) p(6 + k * 2 - (k === 2 ? 1 : 0), y, 1 + (k % 2), 1 + (k % 2), P.waterHi)
  }
}

function loveseat(p: Paint, W: number): void {
  p(0, -6, W, 9, P.leatherLo)
  p(1, -5, W - 2, 7, P.leather)
  p(1, -5, W - 2, 1, P.leatherHi)
  p(0, 2, W, 11, P.leatherLo)
  for (let x = 0; x < W; x += T) {
    p(x + 2, 3, 12, 8, P.leather)
    p(x + 2, 3, 12, 1, P.leatherHi)
  }
  p(0, -1, 3, 14, P.leatherHi)
  p(W - 3, -1, 3, 14, P.leatherHi)
  p(W - 10, -3, 5, 4, P.cushion)
  p(1, 13, 2, 2, P.ink)
  p(W - 3, 13, 2, 2, P.ink)
}

/** A tall rack of servers; its LEDs blink with the frame. */
function serverRack(p: Paint, leds: Paint, frame: number): void {
  p(1, -19, 14, 34, P.rackLo)
  p(2, -18, 12, 31, P.rack)
  p(2, -18, 12, 1, P.rackHi)
  for (let row = 0; row < 7; row += 1) {
    const y = -16 + row * 4
    p(3, y, 10, 3, P.rackLo)
    p(4, y + 1, 5, 1, P.rackHi)
    for (let led = 0; led < 2; led += 1) {
      const v = hash(row, led, Math.floor(frame / (1 + ((row + led) % 3)))) % 5
      const color = v === 0 ? P.rackHi : v === 4 ? P.ledAmber : row === 0 && led === 0 ? P.ledBlue : P.ledGreen
      leds(10 + led * 2, y + 1, 1, 1, color)
    }
  }
  p(1, 13, 14, 2, P.rackLo)
}

function trophy(p: Paint): void {
  p(2, 3, 12, 12, P.darkWood)
  p(2, 3, 12, 1, P.darkWoodHi)
  p(3, 14, 10, 1, P.darkWoodLo)
  p(6, 8, 4, 2, P.gold)
  // The cup on its pedestal.
  p(5, 0, 6, 3, P.goldDark)
  p(7, -4, 2, 4, P.goldDark)
  p(4, -11, 8, 7, P.gold)
  p(5, -5, 6, 1, P.goldDark)
  p(2, -10, 2, 1, P.gold)
  p(2, -10, 1, 4, P.gold)
  p(12, -10, 2, 1, P.gold)
  p(13, -10, 1, 4, P.gold)
  p(5, -10, 2, 3, P.white)
}

function flowers(p: Paint): void {
  p(5, 7, 6, 7, P.glass)
  p(5, 7, 6, 1, P.glassHi)
  p(6, 13, 4, 1, P.steelLo)
  p(7, -2, 1, 9, P.leafLo)
  p(9, 0, 1, 7, P.leafLo)
  p(5, 1, 1, 6, P.leafLo)
  p(3, 2, 3, 2, P.leaf)
  p(10, 3, 3, 2, P.leaf)
  p(5, -5, 4, 4, P.flowerPink)
  p(6, -4, 2, 2, P.gold)
  p(9, -3, 3, 3, P.flowerRed)
  p(3, -2, 3, 3, P.flowerPink)
  p(10, -2, 1, 1, P.gold)
}

function boxes(p: Paint): void {
  p(1, 2, 14, 13, P.cardboardLo)
  p(1, 2, 14, 2, P.cardboard)
  p(2, 4, 12, 10, P.cardboard)
  p(7, 2, 2, 12, P.cardboardTape)
  p(3, -8, 11, 10, P.cardboardLo)
  p(4, -8, 9, 2, P.cardboard)
  p(4, -6, 9, 7, P.cardboard)
  p(8, -8, 2, 9, P.cardboardTape)
  p(4, 8, 3, 2, P.ink)
}

function ladder(p: Paint): void {
  p(3, -18, 2, 33, P.steel)
  p(11, -18, 2, 33, P.steelLo)
  for (let y = -14; y < 14; y += 6) p(4, y, 8, 1, P.steelLo)
  p(3, -19, 10, 2, P.metal)
  p(9, -16, 3, 3, P.white)
}

function paint(p: Paint): void {
  p(2, 6, 9, 9, P.steel)
  p(2, 6, 9, 2, P.white)
  p(3, 7, 7, 1, P.markerBlue)
  p(4, 9, 1, 3, P.markerBlue)
  p(2, 14, 9, 1, P.steelLo)
  // The roller leaning on it.
  p(11, -2, 2, 14, P.darkWood)
  p(9, -5, 6, 3, P.markerBlue)
  p(1, 13, 3, 2, P.markerBlue)
}

/** A fish tank on its stand; the fish swim back and forth with the frame. */
/** The cabinet is lit by the room; at night the tank (`g`) glows. */
function aquarium(cab: Paint, p: Paint, W: number, frame: number): void {
  cab(0, 5, W, 10, P.darkWood)
  cab(0, 5, W, 1, P.darkWoodHi)
  cab(2, 8, 4, 4, P.darkWoodLo)
  cab(W - 6, 8, 4, 4, P.darkWoodLo)
  cab(1, -12, W - 2, 17, P.steelLo)
  p(2, -11, W - 4, 15, P.aquaWater)
  p(2, -11, W - 4, 2, P.glassHi)
  p(2, 0, W - 4, 4, P.aquaWaterLo)
  p(2, 2, W - 4, 2, P.sand)
  p(5, -6, 1, 8, P.leaf)
  p(6, -4, 1, 6, P.leafHi)
  p(W - 8, -7, 1, 9, P.leaf)
  p(W - 7, -5, 1, 7, P.leafLo)
  const fish = (offset: number, y: number, color: string, span: number) => {
    const t = (frame + offset) % (span * 2)
    const right = t < span
    const x = 3 + (right ? t : span * 2 - 1 - t)
    p(x, y, 3, 2, color)
    p(right ? x - 1 : x + 3, y, 1, 2, color)
    p(right ? x + 2 : x, y, 1, 1, P.ink)
  }
  fish(0, -7, P.fishOrange, W - 10)
  fish(9, -3, P.fishYellow, W - 10)
  fish(17, -9, P.fishOrange, W - 10)
  const b = frame % 6
  p(W - 12, -2 - b * 2, 1, 1, P.glassHi)
}

/**
 * Facing up: the bot sits below the desk with its back to us. Its head covers the middle of the desk,
 * so the monitor stands on the left, where its screen stays in view; the keyboard is in front of the bot.
 */
function deskUp(p: Paint, W: number, on: boolean, variant?: string, stack = false): void {
  if (variant === 'multi') return deskMulti(p, W, on, stack)
  p(1, 12, 2, 4, P.deskLeg)
  p(W - 3, 12, 2, 4, P.deskLeg)
  p(0, 2, W, 8, P.deskTop)
  p(0, 2, W, 1, P.deskTopHi)
  p(0, 10, W, 3, P.deskFront)
  p(0, 12, W, 1, P.deskDark)
  monitor(p, 0, -11, 11, 11, on)
  p(4, 0, 3, 4, P.metalLo)
  p(2, 3, 7, 1, P.metalLo)
  // Keyboard and mouse in front of the bot, papers and a mug on the right.
  p(10, 5, 12, 3, P.keyboardLo)
  p(11, 5, 10, 2, P.keyboard)
  p(23, 6, 2, 2, P.keyboard)
  if (!stack) {
    p(24, 3, 5, 4, P.paper)
    p(25, 4, 3, 1, P.paperLine)
  }
  p(W - 4, 2, 3, 4, P.white)
  p(W - 4, 2, 3, 1, P.coffee)
}

/** A monitor's bezel and screen (lit or dark) in the box x, y, w, h; its screen is the box less a pixel. */
function monitor(p: Paint, x: number, y: number, w: number, h: number, on: boolean): void {
  p(x, y, w, h, P.metalLo)
  p(x + 1, y + 1, w - 2, h - 2, on ? P.screenOn : P.screenOff)
  if (on) for (let r = 0; r * 2 < h - 3; r += 1) p(x + 2, y + 2 + r * 2, 2 + ((r * 3) % (w - 4)), 1, r % 2 ? P.screenLineDim : P.screenLine)
  else p(x + w - 3, y + 2, 1, 1, P.metal)
}

/** The tech office: a monitor either side of the bot and a small third one on a pole above its head. */
function deskMulti(p: Paint, W: number, on: boolean, stack: boolean): void {
  p(1, 12, 2, 4, P.deskLeg)
  p(W - 3, 12, 2, 4, P.deskLeg)
  p(0, 2, W, 8, P.deskTop)
  p(0, 2, W, 1, P.deskTopHi)
  p(0, 10, W, 3, P.deskFront)
  p(0, 12, W, 1, P.deskDark)
  monitor(p, 0, -9, 10, 9, on)
  p(4, 0, 2, 3, P.metalLo)
  monitor(p, W - 10, -9, 10, 9, on)
  p(W - 6, 0, 2, 3, P.metalLo)
  // The top monitor stands on a pole down to the desk (behind the bot's head while it works).
  monitor(p, 11, -20, 10, 5, on)
  p(15, -15, 2, 18, P.metalLo)
  p(13, 2, 6, 2, P.metalLo)
  p(10, 5, 12, 3, P.keyboardLo)
  p(11, 5, 10, 2, P.keyboard)
  p(23, 6, 2, 2, P.keyboard)
  if (!stack) p(W - 8, 3, 5, 4, P.paper)
}

/** Facing down: the bot sits behind the desk facing us, a laptop lid towards us. */
function deskDown(p: Paint, W: number, on: boolean, variant?: string, stack = false): void {
  p(1, 12, 2, 4, P.deskLeg)
  p(W - 3, 12, 2, 4, P.deskLeg)
  p(0, 1, W, 9, variant === 'tidy' ? P.white : P.deskTop)
  p(0, 1, W, 1, variant === 'tidy' ? P.plastic : P.deskTopHi)
  p(0, 10, W, 3, P.deskFront)
  p(0, 12, W, 1, P.deskDark)
  const lx = Math.floor(W / 2) - 6
  p(lx, -2, 12, 7, P.metal)
  p(lx + 1, -1, 10, 5, P.metalHi)
  p(lx + 5, 1, 2, 2, on ? P.working : P.metalLo)
  p(lx - 1, 5, 14, 2, P.metalLo)
  if (variant === 'phone') {
    // A desk phone with its handset on the left, a pile of contracts on the right.
    p(1, 3, 7, 5, P.ink)
    p(1, 2, 7, 2, P.metalLo)
    p(3, 5, 3, 2, P.metal)
    p(4, 5, 1, 1, P.ledGreen)
    p(W - 8, 3, 6, 5, P.paper)
    p(W - 7, 4, 4, 1, P.markerBlue)
    p(W - 7, 6, 3, 1, P.paperLine)
    return
  }
  if (variant === 'tidy') {
    // An open planner, a pen and a cup of pencils.
    p(1, 3, 8, 5, P.markerRed)
    p(2, 3, 3, 4, P.paper)
    p(5, 3, 3, 4, P.paper)
    p(2, 4, 2, 1, P.paperLine)
    p(6, 5, 2, 1, P.paperLine)
    p(W - 6, 2, 3, 5, P.markerBlue)
    p(W - 6, 0, 1, 2, P.gold)
    p(W - 4, 1, 1, 1, P.markerRed)
    return
  }
  p(W - 7, 3, 3, 4, P.white)
  if (variant === 'boxed') {
    // Not unpacked yet: a box on the corner.
    p(W - 10, -4, 9, 9, P.cardboardLo)
    p(W - 9, -4, 7, 8, P.cardboard)
    p(W - 6, -4, 1, 8, P.cardboardTape)
    return
  }
  if (!stack) p(3, 4, 6, 4, P.paper)
}

/** The office chair at a desk's seat tile. With someone on it, only the seat shows. */
export function drawDeskChair(p: Paint, facing: 'up' | 'down', occupied: boolean): void {
  chair(p, facing, occupied)
}

function chair(p: Paint, facing: 'up' | 'down', occupied: boolean): void {
  // Wheels and the column.
  p(3, 14, 2, 2, P.ink)
  p(11, 14, 2, 2, P.ink)
  p(7, 11, 2, 4, P.chairLo)
  p(4, 13, 8, 1, P.chairLo)
  p(3, 6, 10, 6, P.chair)
  p(4, 6, 8, 1, P.chairHi)
  if (occupied) return
  if (facing === 'up') {
    // Its back towards us, below the seat.
    p(3, 9, 10, 4, P.chairLo)
    p(4, 9, 8, 1, P.chairHi)
  } else {
    p(3, 0, 10, 7, P.chairLo)
    p(4, 1, 8, 5, P.chair)
    p(4, 1, 8, 1, P.chairHi)
  }
}

function armchair(p: Paint): void {
  p(1, 1, 14, 6, P.leatherLo)
  p(2, 2, 12, 4, P.leather)
  p(1, 5, 3, 9, P.leatherHi)
  p(12, 5, 3, 9, P.leatherHi)
  p(4, 6, 8, 7, P.leather)
  p(4, 6, 8, 1, P.leatherHi)
  p(1, 13, 14, 2, P.leatherLo)
}

/** The owner's desk: a dark wood desk and, behind it, the big armchair that stays empty. */
function ceoDesk(p: Paint): void {
  // The armchair (top row of the footprint), high back reaching up.
  p(15, -6, 18, 16, P.leatherLo)
  p(16, -5, 16, 14, P.leather)
  p(17, -4, 14, 2, P.leatherHi)
  for (let y = -1; y < 8; y += 4) {
    p(19, y, 2, 2, P.leatherLo)
    p(27, y, 2, 2, P.leatherLo)
  }
  p(13, 4, 4, 10, P.leatherHi)
  p(31, 4, 4, 10, P.leatherHi)
  p(17, 8, 14, 6, P.leather)
  p(17, 8, 14, 1, P.leatherHi)
  p(18, 13, 1, 2, P.gold)
  p(29, 13, 1, 2, P.gold)
  // The desk (second row), in front of the chair.
  p(0, 15, 48, 9, P.darkWoodHi)
  p(0, 15, 48, 1, P.deskTopHi)
  p(0, 24, 48, 7, P.darkWood)
  p(0, 30, 48, 1, P.darkWoodLo)
  p(0, 24, 48, 1, P.gold)
  p(4, 26, 10, 4, P.darkWoodLo)
  p(34, 26, 10, 4, P.darkWoodLo)
  p(8, 27, 2, 1, P.gold)
  p(38, 27, 2, 1, P.gold)
  // Monitor (its back to us: the owner would face the door), papers, lamp, nameplate.
  p(4, 8, 12, 9, P.metalLo)
  p(5, 9, 10, 7, P.metal)
  p(9, 16, 2, 2, P.metalLo)
  p(22, 17, 8, 5, P.paper)
  p(23, 18, 6, 1, P.paperLine)
  p(23, 20, 4, 1, P.paperLine)
  p(40, 10, 2, 8, P.goldDark)
  p(37, 8, 8, 3, P.gold)
  p(19, 25, 10, 4, P.gold)
  p(20, 26, 8, 2, P.goldDark)
  // «CEO» in 1-pixel letters on the plate.
  p(21, 26, 1, 2, P.ink)
  p(23, 26, 1, 2, P.ink)
  p(25, 26, 2, 2, P.ink)
}

function table(p: Paint, W: number, H: number, top: string, hi: string, front: string): void {
  p(1, H - 3, 2, 3, P.deskLeg)
  p(W - 3, H - 3, 2, 3, P.deskLeg)
  p(0, 1, W, H - 5, top)
  p(0, 1, W, 1, hi)
  p(0, H - 4, W, 2, front)
  p(0, H - 2, W, 1, P.deskDark)
  for (let x = 4; x < W - 6; x += 16) {
    p(x, 6, 6, 4, P.white)
    p(x + 1, 7, 4, 2, P.plasticLo)
  }
}

function coffeeTable(p: Paint, W: number): void {
  p(1, 12, 2, 3, P.darkWoodLo)
  p(W - 3, 12, 2, 3, P.darkWoodLo)
  p(0, 4, W, 7, P.darkWoodHi)
  p(0, 4, W, 1, P.deskTopHi)
  p(0, 11, W, 2, P.darkWood)
  p(4, 6, 6, 4, P.markerBlue)
  p(5, 7, 4, 1, P.paper)
  p(W - 8, 5, 3, 3, P.white)
  p(W - 8, 5, 3, 1, P.coffee)
}

/** A sofa facing us: back, seat cushions (one per tile: one bot each), arms. */
function sofa(p: Paint, W: number): void {
  p(0, -6, W, 9, P.sofaLo)
  p(1, -5, W - 2, 7, P.sofa)
  p(1, -5, W - 2, 1, P.sofaHi)
  p(0, 2, W, 11, P.sofaLo)
  for (let x = 0; x < W; x += T) {
    p(x + 2, 3, 12, 8, P.sofa)
    p(x + 2, 3, 12, 1, P.sofaHi)
  }
  p(0, -1, 3, 14, P.sofaHi)
  p(W - 3, -1, 3, 14, P.sofaHi)
  p(4, -3, 5, 4, P.cushion)
  p(1, 13, 2, 2, P.ink)
  p(W - 3, 13, 2, 2, P.ink)
}

function counter(p: Paint, W: number): void {
  p(0, -3, W, 6, P.plastic)
  p(0, -3, W, 1, P.white)
  p(0, 3, W, 1, P.plasticLo)
  p(0, 4, W, 11, P.deskFront)
  p(0, 15, W, 1, P.deskDark)
  for (let x = 0; x < W; x += T) {
    p(x, 4, 1, 11, P.deskDark)
    p(x + 7, 6, 2, 1, P.steel)
  }
}

function plant(p: Paint, big: boolean, variant?: string): void {
  const top = big ? -16 : -6
  p(4, 9, 8, 6, P.pot)
  p(4, 9, 8, 1, P.potLo)
  p(5, 14, 6, 1, P.potLo)
  if (variant === 'cactus') {
    p(6, top + 4, 4, 13 - top - 4, P.leaf)
    p(7, top + 5, 1, 8, P.leafHi)
    return
  }
  p(7, top + 4, 2, 9 - top - 4, P.leafLo)
  p(2, top + 6, 6, 5, P.leaf)
  p(8, top + 3, 6, 6, P.leaf)
  p(4, top, 6, 6, P.leaf)
  p(5, top + 1, 2, 2, P.leafHi)
  p(10, top + 4, 2, 2, P.leafHi)
  p(3, top + 7, 2, 2, P.leafHi)
  if (big) {
    p(1, top + 12, 6, 5, P.leaf)
    p(9, top + 11, 6, 5, P.leaf)
    p(2, top + 13, 2, 2, P.leafHi)
    p(11, top + 12, 2, 2, P.leafHi)
    p(5, top + 16, 6, 4, P.leafLo)
  } else {
    p(3, 6, 10, 3, P.leafLo)
  }
}

function bookshelf(p: Paint, W: number): void {
  p(0, -18, W, 33, P.darkWood)
  p(1, -17, W - 2, 31, P.darkWoodLo)
  for (let shelf = 0; shelf < 3; shelf += 1) {
    const y = -16 + shelf * 10
    let x = 2
    let n = shelf * 3
    while (x < W - 3) {
      const width = 2 + (hash(shelf, x) % 2)
      const height = 6 + (hash(x, shelf) % 3)
      p(x, y + 9 - height, width, height, P.books[n % P.books.length])
      x += width + (hash(n, 7) % 3 === 0 ? 1 : 0)
      n += 1
    }
    p(1, y + 9, W - 2, 1, P.darkWoodHi)
  }
  p(0, 14, W, 1, P.darkWoodLo)
}

function rug(p: Paint, W: number, H: number, variant?: string): void {
  const [base, line] =
    variant === 'blue' ? [P.rugBlue, P.rugCream] : variant === 'cream' ? [P.rugCream, P.goldDark] : [P.rugRed, P.rugCream]
  p(1, 1, W - 2, H - 2, base)
  p(3, 3, W - 6, 1, line)
  p(3, H - 4, W - 6, 1, line)
  p(3, 3, 1, H - 6, line)
  p(W - 4, 3, 1, H - 6, line)
  for (let y = 8; y < H - 8; y += 8) for (let x = 8; x < W - 8; x += 8) p(x, y, 2, 2, line)
  for (let x = 2; x < W - 2; x += 3) {
    p(x, 0, 1, 1, line)
    p(x, H - 1, 1, 1, line)
  }
}

// ── People ───────────────────────────────────────────────────────────────────────────────

/**
 * How a figure is drawn. `skin` is the colour of the hands (and of a person's face), `shoe` of the
 * shoes (the palette's by default). A character (`dressed`) brings its own head, tail and chest;
 * `owner` keeps the colours chosen in «Внешность» for the parts of it that borrow them («%skin»…).
 */
export type Look = {
  skin: string
  hair: string
  hairStyle: number
  shirt: string
  shade: string
  pants: string
  accessory: Accessory
  shoe?: string
  dressed?: Dressed
  owner?: OwnerColors
}

/**
 * The colours and shapes of an appearance (editor/appearance.ts), from the palette presets; with a
 * character from the skin packs, its body colours and parts. A character that is gone (its pack was
 * removed) leaves a person.
 */
export function lookOf(a: Appearance, key: string, characters?: ReadonlyMap<string, CharacterSkin>): Look {
  const [shirt, shade] = SHIRTS[a.outfit] ?? SHIRTS[0]
  const person: Look = { shirt, shade, skin: SKINS[a.skin] ?? SKINS[0], hair: HAIRS[a.hair] ?? HAIRS[0], hairStyle: a.hairStyle, pants: pantsFor(key), accessory: a.accessory }
  const skin = a.character ? characters?.get(a.character) : undefined
  if (!skin) return person
  const dressed: Dressed = { skin, coat: coatOf(skin, a.coat) }
  const owner: OwnerColors = { skin: person.skin, hair: person.hair, shirt: person.shirt, shade: person.shade, pants: person.pants }
  const body = (part: keyof CharacterSkin['body'], fallback: string) => {
    const value = skin.body[part]
    if (!value) return fallback
    if (value.startsWith('$')) return dressed.coat.colors[value.slice(1)] ?? fallback
    if (value.startsWith('%')) return owner[value.slice(1) as keyof OwnerColors] ?? fallback
    if (value.startsWith('@')) return (P[value.slice(1) as keyof typeof P] as string | undefined) ?? fallback
    return value
  }
  return {
    ...person,
    skin: body('hands', person.skin),
    shirt: body('shirt', person.shirt),
    shade: body('shade', person.shade),
    pants: body('pants', person.pants),
    ...(skin.body.shoes ? { shoe: body('shoes', P.shoe) } : {}),
    dressed,
    owner
  }
}

/** A stable short name of everything a look draws with (for the sprite caches). */
export function lookId(look: Look): string {
  const d = look.dressed ? `${look.dressed.skin.id}/${look.dressed.coat.id}/${look.owner?.skin}${look.owner?.hair}` : ''
  return `${look.skin}${look.hair}${look.hairStyle}${look.shirt}${look.shade}${look.pants}${look.accessory}${look.shoe ?? ''}${d}`
}

function shoeOf(look: Look): string {
  return look.shoe ?? P.shoe
}

/** A character's part over the figure (a head view, a tail, the chest); nothing for a person. */
function part(p: Paint, look: Look, which: 'front' | 'back' | 'side' | 'sleep' | 'chest' | 'mini' | `tail-${'front' | 'back' | 'side'}`, dx = 0, dy = 0): boolean {
  const d = look.dressed
  if (!d || !look.owner) return false
  const skin = d.skin
  const piece =
    which === 'chest' ? skin.chest : which === 'mini' ? skin.mini : which.startsWith('tail-') ? skin.tail[which.slice(5) as 'front' | 'back' | 'side'] : which === 'sleep' ? skin.head.sleep ?? skin.head.front : skin.head[which as 'front' | 'back' | 'side']
  if (!piece) return false
  // Moved parts (the head leaning back in the chair) are cut at the figure's sides.
  const clipped: Paint = (x, y, w, h, c) => {
    if (x >= 0 && x < CHAR_W) p(x, y, w, h, c)
  }
  paintPart(clipped, piece, d, look.owner, dx, dy)
  return true
}

/** A bot's default look from its key, so it stays the same everywhere and every time. */
export function lookFor(key: string): Look {
  return lookOf(defaultAppearance(key), key)
}

/** Glasses, headphones, a mug or a badge, over the figure drawn so far. */
function accessory(p: Paint, look: Look, view: 'front' | 'back' | 'side', holds = true): void {
  switch (look.accessory) {
    case 'glasses':
      if (view === 'front') {
        p(5, 6, 6, 1, P.ink)
        p(5, 7, 2, 2, P.glass)
        p(9, 7, 2, 2, P.glass)
        p(5, 7, 1, 1, P.glassHi)
        p(9, 7, 1, 1, P.glassHi)
      } else if (view === 'side') {
        p(9, 7, 3, 1, P.ink)
        p(10, 8, 2, 1, P.glass)
      }
      return
    case 'headphones':
      p(4, 1, 8, 1, P.ink)
      if (view === 'side') {
        p(6, 5, 3, 5, P.metalLo)
        p(7, 6, 1, 3, P.metal)
      } else {
        p(3, 2, 1, 4, P.ink)
        p(12, 2, 1, 4, P.ink)
        p(2, 6, 2, 4, P.metalLo)
        p(12, 6, 2, 4, P.metalLo)
      }
      return
    case 'mug':
      if (view === 'front' && holds) {
        p(1, 15, 3, 3, P.white)
        p(1, 15, 3, 1, P.coffee)
        p(0, 16, 1, 1, P.white)
      }
      return
    case 'badge':
      if (view === 'front') {
        p(9, 13, 2, 3, P.white)
        p(9, 13, 2, 1, P.markerBlue)
      }
      return
    default:
      return
  }
}

/**
 * Poses: `walk` (frames 0..3), `stand` (with a mug when facing us), `wait` (one arm up),
 * `type` (sitting at a desk: frames 0..1 move the hands), `sofa` (leaning back, hands behind the head).
 */
export type CharPose = 'walk' | 'stand' | 'wait' | 'type' | 'sofa' | 'read' | 'phone' | 'rock' | 'feet' | 'water' | 'ball' | 'window'

/** Poses whose picture moves (frames 0..3), so the timer redraws them now and then. */
export const MOVING_POSES: ReadonlySet<CharPose> = new Set<CharPose>(['phone', 'rock', 'feet', 'water', 'ball', 'read'])
/** Poses in the office chair, drawn over the desk's chair tile. */
export const CHAIR_POSES: ReadonlySet<CharPose> = new Set<CharPose>(['phone', 'rock', 'feet'])

/** Draws a figure in a CHAR_W × CHAR_H box; its feet touch the bottom row. */
export function drawCharacter(p: Paint, look: Look, pose: CharPose, facing: Facing, frame = 0): void {
  if (pose === 'type') return facing === 'down' ? sitFront(p, look, frame) : sitBack(p, look, frame)
  if (pose === 'sofa') return sofaSit(p, look)
  if (pose === 'phone') return chairPhone(p, look, frame)
  if (pose === 'rock') return chairRock(p, look, frame)
  if (pose === 'feet') return chairFeet(p, look, frame)
  if (pose === 'read') return readLetter(p, look, frame)
  if (pose === 'ball') return kickBall(p, look, frame)
  if (pose === 'water') {
    const q: Paint = facing === 'left' ? (x, y, w, h, c) => p(CHAR_W - x - w, y, w, h, c) : p
    return waterPlant(q, look, frame)
  }
  if (pose === 'window') return drawCharacter(p, look, 'stand', 'up', 0)
  if (facing === 'left') {
    // Mirror the right-facing figure.
    const mirrored: Paint = (x, y, w, h, c) => p(CHAR_W - x - w, y, w, h, c)
    return side(mirrored, look, pose === 'walk' ? frame : 0)
  }
  if (facing === 'right') return side(p, look, pose === 'walk' ? frame : 0)
  const walkFrame = pose === 'walk' ? frame % 4 : 0
  const bob = walkFrame % 2 === 1 ? -1 : 0
  const q: Paint = (x, y, w, h, c) => p(x, y + bob, w, h, c)
  // Facing us the tail is behind the legs; from behind it is in front of everything.
  if (facing === 'down') part(q, look, 'tail-front')
  legsFront(p, look, walkFrame)
  torso(q, look, facing === 'down')
  head(q, look, facing === 'down' ? 'front' : 'back')
  if (pose === 'wait') {
    arm(q, look, 'left', 0)
    // The right arm up: «I need you».
    q(12, 6, 2, 8, look.shirt)
    q(12, 4, 2, 2, look.skin)
  } else if (pose === 'stand' && facing === 'down') {
    arm(q, look, 'left', 0)
    // Holding a mug.
    q(11, 13, 2, 5, look.shade)
    q(9, 14, 3, 3, P.white)
    q(9, 14, 3, 1, P.coffee)
  } else {
    const swing = walkFrame === 1 ? 1 : walkFrame === 3 ? -1 : 0
    arm(q, look, 'left', swing)
    arm(q, look, 'right', -swing)
  }
  if (facing === 'up') part(q, look, 'tail-back')
  // At the kitchen they already hold the office mug.
  accessory(q, look, facing === 'down' ? 'front' : 'back', !(pose === 'stand' && facing === 'down'))
}

function head(p: Paint, look: Look, view: 'front' | 'back' | 'sleep'): void {
  if (part(p, look, view)) return
  if (view === 'sleep') {
    head(p, look, 'front')
    // Eyes closed: two short lines instead of dots.
    p(5, 8, 2, 1, P.eye)
    p(9, 8, 2, 1, P.eye)
    p(6, 7, 1, 1, look.skin)
    p(9, 7, 1, 1, look.skin)
    return
  }
  p(4, 4, 8, 8, look.skin)
  p(4, 11, 8, 1, look.skin)
  if (look.hairStyle === 4) {
    // Shaved: a thin shadow of hair.
    if (view === 'front') {
      p(4, 3, 8, 1, look.hair)
      p(6, 7, 1, 2, P.eye)
      p(9, 7, 1, 2, P.eye)
      p(7, 10, 2, 1, P.mouth)
    } else {
      p(4, 3, 8, 5, look.hair)
    }
    return
  }
  if (look.hairStyle === 3) p(6, 0, 4, 2, look.hair)
  if (view === 'front') {
    p(4, 2, 8, 3, look.hair)
    p(3, 3, 1, 4, look.hair)
    p(12, 3, 1, 4, look.hair)
    if (look.hairStyle === 1) {
      p(3, 5, 2, 7, look.hair)
      p(11, 5, 2, 7, look.hair)
    } else if (look.hairStyle === 2) {
      p(5, 1, 2, 1, look.hair)
      p(9, 1, 2, 1, look.hair)
      p(4, 5, 1, 1, look.hair)
    } else {
      p(4, 5, 2, 1, look.hair)
    }
    p(6, 7, 1, 2, P.eye)
    p(9, 7, 1, 2, P.eye)
    p(7, 10, 2, 1, P.mouth)
  } else {
    p(4, 2, 8, 9, look.hair)
    p(3, 3, 1, 6, look.hair)
    p(12, 3, 1, 6, look.hair)
    if (look.hairStyle === 1) p(4, 11, 8, 2, look.hair)
    if (look.hairStyle === 2) {
      p(5, 1, 2, 1, look.hair)
      p(9, 1, 2, 1, look.hair)
    }
  }
}

function torso(p: Paint, look: Look, front: boolean): void {
  p(4, 12, 8, 7, look.shirt)
  p(4, 12, 1, 7, look.shade)
  p(4, 18, 8, 1, look.shade)
  if (front) p(7, 12, 2, 2, look.shade)
  if (front) part(p, look, 'chest')
}

function arm(p: Paint, look: Look, which: 'left' | 'right', swing: number): void {
  const x = which === 'left' ? 2 : 12
  p(x, 12 + Math.max(0, swing), 2, 6, which === 'left' ? look.shade : look.shirt)
  p(x, 18 + swing, 2, 1, look.skin)
}

function legsFront(p: Paint, look: Look, frame: number): void {
  const leftUp = frame === 1 ? 1 : 0
  const rightUp = frame === 3 ? 1 : 0
  p(5, 19, 6, 2, look.pants)
  p(5, 21, 3, 3 - leftUp, look.pants)
  p(8, 21, 3, 3 - rightUp, look.pants)
  p(4, 24 - leftUp, 4, 2, shoeOf(look))
  p(8, 24 - rightUp, 4, 2, shoeOf(look))
}

function side(p: Paint, look: Look, frame: number): void {
  const step = frame % 4
  const bob = step % 2 === 1 ? -1 : 0
  const q: Paint = (x, y, w, h, c) => p(x, y + bob, w, h, c)
  part(q, look, 'tail-side')
  // Legs: apart on steps 1 and 3, together on 0 and 2.
  if (step % 2 === 1) {
    p(5, 19, 6, 2, look.pants)
    p(4, 21, 3, 3, look.pants)
    p(9, 21, 3, 3, look.pants)
    p(3, 24, 4, 2, shoeOf(look))
    p(9, 24, 5, 2, shoeOf(look))
  } else {
    p(6, 19, 5, 5, look.pants)
    p(6, 24, 6, 2, shoeOf(look))
  }
  q(5, 12, 6, 7, look.shirt)
  q(5, 18, 6, 1, look.shade)
  const swing = step === 1 ? 2 : step === 3 ? -2 : 0
  q(7 + swing, 13, 2, 5, look.shade)
  q(7 + swing, 18, 2, 1, look.skin)
  sideHead(q, look)
  accessory(q, look, 'side')
}

/** The head in profile, facing right; `dx` moves it (leaning back in the chair). */
function sideHead(p: Paint, look: Look, dx = 0): void {
  if (part(p, look, 'side', dx)) return
  p(5 + dx, 4, 7, 8, look.skin)
  p(12 + dx, 7, 1, 2, look.skin)
  p(5 + dx, 2, 7, 3, look.hair)
  p(4 + dx, 3, 3, 6, look.hair)
  if (look.hairStyle === 1) p(4 + dx, 5, 3, 7, look.hair)
  if (look.hairStyle === 2) p(6 + dx, 1, 2, 1, look.hair)
  p(10 + dx, 7, 1, 2, P.eye)
}

// ── Resting in one's own office ──────────────────────────────────────────────────────────

/** Sitting on the office chair facing us, legs bent; `dx` sways the upper body. */
function seated(p: Paint, look: Look, dx = 0, hands = true): void {
  part(p, look, 'tail-front', dx)
  // Legs: thighs towards us, shins down, shoes on the floor.
  p(5, 19, 6, 2, look.pants)
  p(5, 21, 2, 3, look.pants)
  p(9, 21, 2, 3, look.pants)
  p(4, 24, 3, 2, shoeOf(look))
  p(9, 24, 3, 2, shoeOf(look))
  const q: Paint = (x, y, w, h, c) => p(x + dx, y + 1, w, h, c)
  torso(q, look, true)
  if (hands) {
    q(2, 12, 2, 6, look.shade)
    q(12, 12, 2, 6, look.shirt)
  }
  head(q, look, 'front')
  accessory(q, look, 'front', false)
}

function chairPhone(p: Paint, look: Look, frame: number): void {
  seated(p, look, 0, false)
  // Elbows in, the phone in both hands, its screen lit; a thumb taps.
  p(3, 14, 2, 5, look.shade)
  p(11, 14, 2, 5, look.shirt)
  p(5, 17, 6, 4, P.ink)
  p(6, 18, 4, 2, P.screenLine)
  p(5 + (frame % 2) * 4, 18, 2, 1, look.skin)
  p(5, 20, 1, 1, look.skin)
  p(10, 20, 1, 1, look.skin)
}

function chairRock(p: Paint, look: Look, frame: number): void {
  const sway = [0, 1, 0, -1][frame % 4]
  seated(p, look, sway, true)
  // Hands on the knees while the chair tips back and forth.
  p(4 + sway, 19, 2, 1, look.skin)
  p(10 + sway, 19, 2, 1, look.skin)
}

/** Leaning back, legs up on the desk to the right, hands behind the head; a foot taps. */
function chairFeet(p: Paint, look: Look, frame: number): void {
  p(2, 13, 6, 7, look.shirt)
  p(2, 19, 6, 1, look.shade)
  if (look.dressed) sideHead(p, look, -3)
  else {
    p(2, 4, 7, 8, look.skin)
    p(2, 2, 7, 3, look.hair)
    p(1, 3, 2, 6, look.hair)
    if (look.hairStyle === 1) p(1, 5, 2, 7, look.hair)
    p(7, 7, 1, 2, P.eye)
  }
  p(0, 6, 2, 4, look.shade)
  p(8, 11, 2, 2, look.shade)
  // Legs out over the desk, shoes up.
  p(7, 18, 7, 2, look.pants)
  p(12, 16, 2, 3, look.pants)
  p(13, 14 - (frame % 2), 3, 3, shoeOf(look))
  p(3, 20, 4, 3, look.pants)
}

/** A letter just came: holding it open in both hands. */
function readLetter(p: Paint, look: Look, frame: number): void {
  part(p, look, 'tail-front')
  legsFront(p, look, 0)
  torso(p, look, true)
  head(p, look, 'front')
  const lift = frame % 2
  p(3, 13 - lift, 10, 7, P.envelope)
  p(3, 13 - lift, 10, 1, P.mailHandoff)
  p(5, 15 - lift, 6, 1, P.paperLine)
  p(5, 17 - lift, 4, 1, P.paperLine)
  p(2, 15 - lift, 1, 2, look.skin)
  p(13, 15 - lift, 1, 2, look.skin)
}

/** Kicking a ball up from foot to foot. */
function kickBall(p: Paint, look: Look, frame: number): void {
  const f = frame % 4
  part(p, look, 'tail-front')
  legsFront(p, look, f === 1 ? 1 : f === 3 ? 3 : 0)
  torso(p, look, true)
  head(p, look, 'front')
  arm(p, look, 'left', f === 1 ? 1 : 0)
  arm(p, look, 'right', f === 3 ? 1 : 0)
  const y = [21, 15, 21, 15][f]
  const x = f < 2 ? 3 : 10
  p(x, y, 4, 4, P.white)
  p(x + 1, y + 1, 2, 2, P.ink)
}

/** Watering the plant to the right: the can tipped, drops falling. */
function waterPlant(p: Paint, look: Look, frame: number): void {
  side(p, look, 0)
  p(11, 13, 4, 4, P.steel)
  p(11, 13, 4, 1, P.steelLo)
  p(15, 12, 1, 2, P.steelLo)
  p(9, 14, 2, 1, look.skin)
  const d = frame % 4
  p(15, 15 + d * 2, 1, 1, P.water)
  if (d < 2) p(14, 19 + d * 2, 1, 1, P.waterHi)
}

/** At a desk, back to us: head and shoulders over the chair, elbows moving while typing. */
function sitBack(p: Paint, look: Look, frame: number): void {
  p(5, 19, 6, 3, look.pants)
  p(4, 12, 8, 8, look.shirt)
  p(4, 12, 1, 8, look.shade)
  const lift = frame % 2
  p(2, 13 - lift, 2, 5, look.shade)
  p(12, 12 + lift, 2, 5, look.shirt)
  head(p, look, 'back')
  part(p, look, 'tail-back')
  accessory(p, look, 'back')
}

/** At a desk, facing us; the desk in front hides the legs. */
function sitFront(p: Paint, look: Look, frame: number): void {
  torso(p, look, true)
  const lift = frame % 2
  p(2, 13, 2, 5, look.shade)
  p(12, 13, 2, 5, look.shirt)
  p(4, 18 - lift, 2, 1, look.skin)
  p(10, 17 + lift, 2, 1, look.skin)
  head(p, look, 'front')
  accessory(p, look, 'front', false)
}

/** Done: on the sofa, leaning back with the hands behind the head. */
function sofaSit(p: Paint, look: Look): void {
  p(4, 19, 8, 2, look.pants)
  p(5, 21, 2, 3, look.pants)
  p(9, 21, 2, 3, look.pants)
  p(4, 24, 3, 2, shoeOf(look))
  p(9, 24, 3, 2, shoeOf(look))
  p(4, 13, 8, 6, look.shirt)
  p(4, 13, 1, 6, look.shade)
  // Elbows out, hands behind the head.
  p(1, 6, 3, 2, look.shade)
  p(2, 8, 2, 5, look.shade)
  p(12, 6, 3, 2, look.shirt)
  p(12, 8, 2, 5, look.shirt)
  const q: Paint = (x, y, w, h, c) => p(x, y + 1, w, h, c)
  head(q, look, 'sleep')
  accessory(q, look, 'front', false)
}

// ── Speech bubble ────────────────────────────────────────────────────────────────────────

const GLYPHS: Record<'!' | '?', string[]> = {
  '!': ['.##.', '.##.', '.##.', '.##.', '....', '.##.', '.##.'],
  '?': ['.###.', '#...#', '....#', '..##.', '..#..', '.....', '..#..']
}

export const BUBBLE_W = 13
export const BUBBLE_H = 13

/** A speech bubble with «!» or «?», its tail pointing down at the head. */
export function drawBubble(p: Paint, glyph: '!' | '?', color: string): void {
  p(0, 0, 13, 11, color)
  p(1, 1, 11, 9, P.bubble)
  p(5, 11, 3, 1, color)
  p(6, 12, 1, 1, color)
  const rows = GLYPHS[glyph]
  const ox = 4
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx += 1) if (row[dx] === '#') p(ox + dx, 2 + dy, 1, 1, color)
  })
}

// ── Interns (a bot's live workers) and the Needs-you flag ────────────────────────────────

export const INTERN_W = 10
export const INTERN_H = 16

/** A small figure at a little laptop; its laptop light is the colour of the worker's state. */
export function drawIntern(p: Paint, look: Look, stateColor: string): void {
  // Legs and shoes.
  p(3, 12, 4, 2, look.pants)
  p(3, 14, 2, 2, shoeOf(look))
  p(5, 14, 2, 2, shoeOf(look))
  // Body and arms forward to the laptop.
  p(2, 7, 6, 5, look.shirt)
  p(2, 7, 1, 5, look.shade)
  p(7, 9, 2, 1, look.skin)
  // Head: a person's, or the character's small one.
  if (!part(p, look, 'mini')) {
    p(2, 1, 6, 6, look.skin)
    p(2, 0, 6, 2, look.hair)
    p(1, 1, 1, 3, look.hair)
    p(4, 3, 1, 1, P.eye)
    p(6, 3, 1, 1, P.eye)
  }
  // The laptop on the knees.
  p(6, 9, 4, 3, P.metal)
  p(6, 9, 4, 1, P.metalHi)
  p(8, 10, 1, 1, stateColor)
}

export const FLAG_W = 7
export const FLAG_H = 10

/** A little flag on a pole: the bot has items in Needs you. */
export function drawFlag(p: Paint): void {
  p(0, 0, 1, 10, P.ink)
  p(1, 0, 6, 5, P.needsYouLo)
  p(1, 0, 5, 4, P.needsYou)
  p(3, 1, 1, 2, P.white)
}

export const ENVELOPE_W = 11
export const ENVELOPE_H = 8

/** A letter in flight; its band is the colour of the mail type. */
export function drawEnvelope(p: Paint, color: string): void {
  p(0, 0, 11, 8, P.ink)
  p(1, 1, 9, 6, P.envelope)
  p(1, 1, 1, 1, color)
  p(2, 2, 1, 1, color)
  p(3, 3, 1, 1, color)
  p(4, 4, 3, 1, color)
  p(7, 3, 1, 1, color)
  p(8, 2, 1, 1, color)
  p(9, 1, 1, 1, color)
  p(1, 6, 9, 1, color)
}

// ── Real time and real numbers on the walls ──────────────────────────────────────────────

/** The hands of a wall clock (over its face, same tile), from the owner's real time. */
export function drawClockHands(p: Paint, hours: number, minutes: number): void {
  const hand = (turns: number, length: number, color: string) => {
    const a = turns * Math.PI * 2
    for (let i = 1; i <= length; i += 1) p(7 + Math.round(Math.sin(a) * i), 8 - Math.round(Math.cos(a) * i), 1, 1, color)
  }
  hand(minutes / 60, 3, P.ink)
  hand(((hours % 12) + minutes / 60) / 12, 2, P.markerRed)
  p(7, 8, 1, 1, P.ink)
}

/** The two cards of the notice board: bots waiting for the owner, and those at work. */
export function drawNoticeNumbers(p: Paint, waiting: number, working: number): void {
  const num = (n: number) => (n > 99 ? '99' : String(Math.max(0, Math.floor(n))))
  // «!» — wait for you; «▶» — at work.
  p(4, 7, 1, 3, P.ink)
  p(4, 11, 1, 1, P.ink)
  p(18, 7, 1, 5, P.ink)
  p(19, 8, 1, 3, P.ink)
  p(20, 9, 1, 1, P.ink)
  const a = num(waiting)
  const b = num(working)
  drawText(p, a, 14 - textWidth(a), 7, waiting > 0 ? P.markerRed : P.ink)
  drawText(p, b, 28 - textWidth(b), 7, P.ink)
}

/** 3×5 pixel letters: digits and the few letters the signs need. Ё gets its dots above. */
const FONT: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  С: ['111', '100', '100', '100', '111'],
  Д: ['.###', '.#.#', '.#.#', '####', '#..#'],
  А: ['010', '101', '111', '101', '101'],
  Ё: ['111', '100', '110', '100', '111'],
  Т: ['111', '010', '010', '010', '010'],
  Я: ['111', '101', '111', '011', '101']
}

export function textWidth(text: string): number {
  return Math.max(0, [...text].reduce((sum, ch) => sum + glyphWidth(ch) + 1, 0) - 1)
}

const glyphWidth = (ch: string) => FONT[ch]?.[0].length ?? 3

export function drawText(p: Paint, text: string, x: number, y: number, color: string): void {
  let ox = x
  for (const ch of text) {
    const rows = FONT[ch]
    const w = glyphWidth(ch)
    if (!rows) {
      ox += w + 1
      continue
    }
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx += 1) if (row[dx] === '1' || row[dx] === '#') p(ox + dx, y + dy, 1, 1, color)
    })
    if (ch === 'Ё') {
      p(ox, y - 1, 1, 1, color)
      p(ox + 2, y - 1, 1, 1, color)
    }
    ox += w + 1
  }
}

// ── «Жизнь»: the waiting sign and the chat clouds (decoration only) ──────────────────────

export const PLACARD_W = 13
export const PLACARD_H = 17

/** A sign on a stick, held up by a bot that waits for the owner: «?» or «!» in its status colour. */
export function drawPlacard(p: Paint, glyph: '!' | '?', color: string): void {
  p(0, 0, 13, 10, color)
  p(1, 1, 11, 8, P.paper)
  p(6, 10, 1, 7, P.darkWood)
  const rows = glyph === '!' ? ['.#.', '.#.', '.#.', '...', '.#.'] : ['###', '..#', '.##', '...', '.#.']
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < 3; dx += 1) if (row[dx] === '#') p(5 + dx, 2 + dy, 1, 1, color)
  })
}

export const CLOUD_W = 15
export const CLOUD_H = 13

/** A little thought cloud with a pixel icon: what resting bots «talk» about. No words. */
export function drawCloud(p: Paint, icon: string): void {
  p(2, 0, 11, 10, P.bubble)
  p(0, 2, 15, 6, P.bubble)
  p(1, 1, 13, 8, P.bubble)
  p(2, 0, 11, 1, P.paperLine)
  p(0, 2, 1, 6, P.paperLine)
  p(14, 2, 1, 6, P.paperLine)
  p(2, 9, 11, 1, P.paperLine)
  p(4, 10, 2, 2, P.bubble)
  p(3, 12, 1, 1, P.bubble)
  const q: Paint = (x, y, w, h, c) => p(4 + x, 2 + y, w, h, c)
  switch (icon) {
    case 'coffee':
      q(0, 2, 5, 4, P.white)
      q(1, 3, 3, 1, P.coffee)
      q(5, 3, 1, 2, P.white)
      q(1, 0, 1, 1, P.steelLo)
      q(3, 0, 1, 1, P.steelLo)
      return
    case 'talk':
      q(0, 0, 7, 5, P.mailHandoff)
      q(1, 5, 2, 1, P.mailHandoff)
      q(1, 2, 1, 1, P.white)
      q(3, 2, 1, 1, P.white)
      q(5, 2, 1, 1, P.white)
      return
    case 'dots':
      q(0, 3, 1, 1, P.ink)
      q(3, 3, 1, 1, P.ink)
      q(6, 3, 1, 1, P.ink)
      return
    case 'laugh':
      q(1, 0, 5, 6, P.gold)
      q(0, 1, 7, 4, P.gold)
      q(1, 2, 2, 1, P.ink)
      q(4, 2, 2, 1, P.ink)
      q(2, 4, 3, 1, P.blocked)
      return
    case 'chart':
      q(0, 4, 1, 2, P.markerBlue)
      q(2, 3, 1, 3, P.markerBlue)
      q(4, 1, 1, 5, P.markerGreen)
      q(1, 1, 1, 1, P.markerRed)
      q(2, 0, 4, 1, P.markerRed)
      q(6, 0, 1, 2, P.markerRed)
      return
    case 'fish':
      q(1, 2, 4, 3, P.fishOrange)
      q(0, 3, 1, 1, P.fishOrange)
      q(5, 1, 2, 5, P.fishOrange)
      q(2, 3, 1, 1, P.ink)
      return
    default:
      return
  }
}
