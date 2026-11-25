// Night light without tokens: where light comes from and how far it reaches. From the evening on
// the office darkens, and every lamp, candle, neon sign, lit screen and appliance in use cuts a soft
// pixel pool out of the dark: on the floor and the walls of its own room, never through a wall.
// Everything here is plain data and arithmetic. The light map is a small grid (one cell per two
// art pixels) computed once per change: the theme or the hour, a lamp switched on or off in
// «Оформление», a screen going on or off, an appliance taken or left. Flicker is not in the map: the
// renderer adds it from the one ambient timer.
import { FURNITURE, TILE, type FurnitureType } from './catalog'
import type { PlacedFurniture, World } from './world'

/** How one kind of thing shines. Offsets are art pixels from its footprint's top-left. */
export type LightSpec = {
  color: string
  /** Reach in art pixels. */
  radius: number
  /** 0..1: how much of the dark it takes away at its centre. */
  strength: number
  dx: number
  dy: number
  /** Candles and fire: the halo trembles. */
  flicker?: boolean
  /** `night`: lit from the evening on; `use`: only while a bot uses it (microwave, fridge). */
  when: 'night' | 'use'
}

/** A light in the building now (art pixels). */
export type Light = { key: string; x: number; y: number; radius: number; color: string; strength: number; flicker: boolean; room: string | null }

export const LIGHT_SPECS: Partial<Record<FurnitureType, LightSpec>> = {
  'floor-lamp': { color: '#ffc879', radius: 52, strength: 0.9, dx: 8, dy: -10, when: 'night' },
  'wall-lamp': { color: '#ffd38a', radius: 46, strength: 0.85, dx: 8, dy: 12, when: 'night' },
  'desk-lamp': { color: '#ffd27a', radius: 34, strength: 0.8, dx: 8, dy: 4, when: 'night' },
  candles: { color: '#ffa94d', radius: 30, strength: 0.7, dx: 8, dy: 4, flicker: true, when: 'night' },
  garland: { color: '#ffcf70', radius: 22, strength: 0.45, dx: 8, dy: 6, when: 'night' },
  'neon-sign': { color: '#ff6fc8', radius: 42, strength: 0.7, dx: 16, dy: 8, when: 'night' },
  'night-light': { color: '#ffd9a0', radius: 26, strength: 0.6, dx: 8, dy: 10, when: 'night' },
  'ceo-desk': { color: '#ffd27a', radius: 60, strength: 0.9, dx: 41, dy: 10, when: 'night' },
  aquarium: { color: '#5fd6ff', radius: 36, strength: 0.55, dx: 16, dy: -2, when: 'night' },
  'server-rack': { color: '#5df08a', radius: 20, strength: 0.4, dx: 8, dy: 2, when: 'night' },
  microwave: { color: '#ffd56a', radius: 34, strength: 0.75, dx: 8, dy: -3, when: 'use' },
  'coffee-machine': { color: '#ffb35c', radius: 28, strength: 0.6, dx: 8, dy: -4, when: 'use' },
  fridge: { color: '#dff2ff', radius: 40, strength: 0.85, dx: 8, dy: 0, when: 'use' }
}

/** Looks of a light that change its colour (a rainbow garland, a pink or a blue neon). */
export const VARIANT_LIGHT: Record<string, Partial<LightSpec>> = {
  'garland:rainbow': { color: '#d9b0ff' },
  'neon-sign:heart': { color: '#ff5f8a' },
  'neon-sign:247': { color: '#5ff0ff' },
  'desk-lamp:': { color: '#e8f0a0' },
  'night-light:star': { color: '#fff2a8' },
  'wall-lamp:bulb': { color: '#fff0c0', radius: 40 }
}

/** Things that are lights (on or off), for «Оформление» and the renderer. */
export function isLight(type: FurnitureType): boolean {
  return LIGHT_SPECS[type] !== undefined
}

/** Lights the owner can switch off in «Оформление»: lamps, candles, garlands, signs. */
export const SWITCHABLE: ReadonlySet<FurnitureType> = new Set<FurnitureType>(['floor-lamp', 'wall-lamp', 'desk-lamp', 'candles', 'garland', 'neon-sign', 'night-light'])

const keys = new WeakMap<object, string>()

/** The stable name of one piece of furniture (the same as «Оформление» uses); remembered per item. */
export function lightKey(item: Pick<PlacedFurniture, 'room' | 'type' | 'x' | 'y'>): string {
  let key = keys.get(item)
  if (key === undefined) {
    key = `${item.room}:${item.type}:${item.x},${item.y}`
    keys.set(item, key)
  }
  return key
}

// ── Appliances in use ────────────────────────────────────────────────────────────────────

export const APPLIANCES: ReadonlySet<FurnitureType> = new Set<FurnitureType>(['microwave', 'coffee-machine', 'fridge'])

/** The tile a bot stands on to use a thing: in front of it (as «Жизнь» plans its stops). */
export function standTile(item: Pick<PlacedFurniture, 'x' | 'y' | 'w' | 'h'>): { x: number; y: number } {
  return { x: item.x + Math.floor((item.w - 1) / 2), y: item.y + item.h }
}

/** Appliances a bot is using now: it stands still on its tile, facing it. */
export function appliancesInUse(world: World, actors: readonly { walking: boolean; target: { x: number; y: number; facing: string } }[]): Set<string> {
  const out = new Set<string>()
  for (const item of world.furniture) {
    if (!APPLIANCES.has(item.type)) continue
    const at = standTile(item)
    if (actors.some((a) => !a.walking && a.target.x === at.x && a.target.y === at.y && a.target.facing === 'up')) out.add(lightKey(item))
  }
  return out
}

// ── Screens ──────────────────────────────────────────────────────────────────────────────

/** What a monitor shows: work by role or office, a screensaver when its owner is away, or nothing. */
export type ScreenKind = 'code' | 'logs' | 'chart' | 'chat' | 'saver-logo' | 'saver-stars' | 'off'

export const SCREEN_LIGHT: Record<ScreenKind, string> = {
  code: '#8fd0ff',
  logs: '#7dffa0',
  chart: '#a8ffb0',
  chat: '#ffc6e8',
  'saver-logo': '#9fb4ff',
  'saver-stars': '#c8d4ff',
  off: '#000000'
}

/** What an office's own furniture suggests for its screens: logs by the server racks, charts by a sales chart. */
export function roomScreen(world: World, room: string | null): ScreenKind | null {
  if (!room) return null
  let byRoom = officeScreens.get(world)
  if (!byRoom) {
    byRoom = new Map()
    for (const f of world.furniture) {
      if (f.type === 'server-rack') byRoom.set(f.room, 'logs')
      else if ((f.type === 'chart' || f.type === 'trophy') && byRoom.get(f.room) !== 'logs') byRoom.set(f.room, 'chart')
    }
    officeScreens.set(world, byRoom)
  }
  return byRoom.get(room) ?? null
}
const officeScreens = new WeakMap<World, Map<string, ScreenKind>>()

/** Work on the screen: logs for a CTO, charts for sales and money, a chat for an assistant; else what the office suggests, else code. */
export function workScreen(role: string, office: ScreenKind | null): ScreenKind {
  const r = role.toLowerCase()
  if (/cto|tech|dev|eng|sre|ops/.test(r)) return 'logs'
  if (/cso|sales|cmo|market|cfo|fin/.test(r)) return 'chart'
  if (/assist|secret|ассист/.test(r)) return 'chat'
  return office ?? 'code'
}

/** A desk's screen: lit with work while its bot works there, a screensaver while it is away, off when nobody's. */
export function screenOf(desk: { working: boolean; owned: boolean; role: string; office: ScreenKind | null; key: string }): ScreenKind {
  if (desk.working) return workScreen(desk.role, desk.office)
  if (!desk.owned) return 'off'
  let h = 0
  for (const ch of desk.key) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % 2 ? 'saver-stars' : 'saver-logo'
}

// ── Collecting the lights ────────────────────────────────────────────────────────────────

export type LightInputs = {
  /** Lights are on (evening, night). */
  on: boolean
  /** Lamps the owner switched off in «Оформление» (item keys). */
  off: ReadonlySet<string>
  /** Appliances in use (item keys). */
  using: ReadonlySet<string>
  /** Desk id → what its screen shows. */
  screens: ReadonlyMap<string, ScreenKind>
  /** The look of an item may change its light (a pack's variant: a lavender candle). */
  look?: (item: PlacedFurniture) => { variant?: string; light?: Partial<Pick<LightSpec, 'color' | 'radius'>> } | null
}

const hexOk = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)

/** Every light shining now; empty by day. */
export function collectLights(world: World, inputs: LightInputs): Light[] {
  if (!inputs.on) return []
  const out: Light[] = []
  for (const item of world.furniture) {
    const base = LIGHT_SPECS[item.type]
    if (!base) continue
    const key = lightKey(item)
    if (base.when === 'use' && !inputs.using.has(key)) continue
    if (base.when === 'night' && inputs.off.has(key)) continue
    const look = inputs.look?.(item) ?? null
    const variant = look?.variant ?? item.variant ?? ''
    const spec = { ...base, ...VARIANT_LIGHT[`${item.type}:${variant}`] }
    const color = hexOk(look?.light?.color) ? look!.light!.color! : spec.color
    const radius = typeof look?.light?.radius === 'number' ? Math.max(8, Math.min(96, look.light.radius)) : spec.radius
    const ox = item.x * TILE
    const oy = item.y * TILE
    if (item.type === 'garland') {
      // A light per tile along the string; a rainbow string alternates its colours.
      const rainbow = ['#ff7a7a', '#ffd36b', '#7dff9a', '#7ac8ff', '#d9a0ff']
      for (let i = 0; i < item.w; i += 1) {
        out.push({ key: `${key}#${i}`, x: ox + i * TILE + spec.dx, y: oy + spec.dy, radius, color: variant === 'rainbow' && !look?.light?.color ? rainbow[i % rainbow.length] : color, strength: spec.strength, flicker: false, room: item.room })
      }
      continue
    }
    out.push({ key, x: ox + spec.dx, y: oy + spec.dy, radius, color, strength: spec.strength, flicker: !!spec.flicker, room: item.room })
  }
  // Lit screens: a cool glow on the desk and on the face of whoever works there.
  for (const desk of world.desks) {
    const kind = inputs.screens.get(desk.id) ?? 'off'
    if (kind === 'off') continue
    const saver = kind.startsWith('saver')
    const x = desk.x * TILE + TILE
    const y = desk.facing === 'up' ? desk.y * TILE - 4 : desk.y * TILE - 2
    out.push({ key: `screen:${desk.id}`, x, y, radius: saver ? 18 : 32, color: SCREEN_LIGHT[kind], strength: saver ? 0.35 : 0.7, flicker: false, room: desk.room })
  }
  return out
}

/** A short signature of the lights: equal signatures, equal maps. */
export function lightsSignature(lights: readonly Light[]): string {
  return lights.map((l) => `${l.key}@${l.x},${l.y},${l.radius},${l.color},${l.strength}`).join('|')
}

// ── The light map ────────────────────────────────────────────────────────────────────────

/** One cell of the map is this many art pixels: the pools come out in soft pixel rings. */
export const LIGHT_CELL = 2
/** Rings of a pool: the light falls off in this many steps. */
export const LIGHT_BANDS = 5

export type Darkness = { color: string; alpha: number }

export type LightMap = {
  /** Cells across and down. */
  w: number
  h: number
  /** RGBA per cell, drawn over the office: the dark with the pools cut out. */
  shade: Uint8ClampedArray
  /** RGBA per cell, added on top: the warm colour of the light. */
  glow: Uint8ClampedArray
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** How strong a pool is at distance d: 1 at the centre, in LIGHT_BANDS steps, 0 past its radius. */
export function falloff(d: number, radius: number): number {
  const t = 1 - d / radius
  if (t <= 0) return 0
  return Math.ceil(t * LIGHT_BANDS) / LIGHT_BANDS
}

/**
 * The dark with every pool cut out of it, and the warm glow of each light. A light reaches only the
 * floor and walls of its own room (its rectangle, walls included); corridors are rooms too.
 */
export function buildLightMap(world: World, lights: readonly Light[], dark: Darkness): LightMap {
  const w = Math.ceil((world.width * TILE) / LIGHT_CELL)
  const h = Math.ceil((world.height * TILE) / LIGHT_CELL)
  const lit = new Float32Array(w * h)
  const glowW = new Float32Array(w * h)
  const glowR = new Float32Array(w * h)
  const glowG = new Float32Array(w * h)
  const glowB = new Float32Array(w * h)
  const rooms = new Map(world.rooms.map((r) => [r.id, r]))
  for (const light of lights) {
    const room = light.room ? rooms.get(light.room) : undefined
    const minX = Math.max(0, Math.floor((light.x - light.radius) / LIGHT_CELL), room ? Math.floor((room.x * TILE) / LIGHT_CELL) : 0)
    const maxX = Math.min(w - 1, Math.floor((light.x + light.radius) / LIGHT_CELL), room ? Math.ceil(((room.x + room.w) * TILE) / LIGHT_CELL) - 1 : w - 1)
    const minY = Math.max(0, Math.floor((light.y - light.radius) / LIGHT_CELL), room ? Math.floor((room.y * TILE) / LIGHT_CELL) : 0)
    const maxY = Math.min(h - 1, Math.floor((light.y + light.radius) / LIGHT_CELL), room ? Math.ceil(((room.y + room.h) * TILE) / LIGHT_CELL) - 1 : h - 1)
    const [r, g, b] = rgb(light.color)
    for (let cy = minY; cy <= maxY; cy += 1) {
      for (let cx = minX; cx <= maxX; cx += 1) {
        const px = cx * LIGHT_CELL + LIGHT_CELL / 2
        const py = cy * LIGHT_CELL + LIGHT_CELL / 2
        const f = falloff(Math.hypot(px - light.x, (py - light.y) * 1.15), light.radius)
        if (f <= 0) continue
        const i = cy * w + cx
        const v = f * light.strength
        lit[i] += v
        glowW[i] += v
        glowR[i] += r * v
        glowG[i] += g * v
        glowB[i] += b * v
      }
    }
  }
  const [dr, dg, db] = rgb(dark.color)
  const shade = new Uint8ClampedArray(w * h * 4)
  const glow = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i += 1) {
    const l = Math.min(1, lit[i])
    // The dark, thinned where light falls and warmed towards the light's own colour (a deep amber, not grey).
    const lr = glowW[i] > 0 ? glowR[i] / glowW[i] : dr
    const lg = glowW[i] > 0 ? glowG[i] / glowW[i] : dg
    const lb = glowW[i] > 0 ? glowB[i] / glowW[i] : db
    shade[i * 4] = dr + (lr * 0.45 - dr) * l
    shade[i * 4 + 1] = dg + (lg * 0.3 - dg) * l
    shade[i * 4 + 2] = db + (lb * 0.15 - db) * l
    shade[i * 4 + 3] = Math.round(255 * dark.alpha * (1 - 0.8 * l))
    if (glowW[i] > 0) {
      glow[i * 4] = lr
      glow[i * 4 + 1] = lg
      glow[i * 4 + 2] = lb
      glow[i * 4 + 3] = Math.round(255 * Math.min(0.2, glowW[i] * 0.14) * Math.min(1, dark.alpha * 2))
    }
  }
  return { w, h, shade, glow }
}

/** Keeps the last map and builds a new one only when its key changes (counted, for tests and the debug line). */
export class LightCache<T> {
  private key: string | null = null
  private value: T | null = null
  builds = 0

  /** Forget the last one: the next `get` builds again (new colours, a new look). */
  reset(): void {
    this.key = null
    this.value = null
  }

  get(key: string, build: () => T): T {
    if (this.key === key && this.value !== null) return this.value
    this.key = key
    this.value = build()
    this.builds += 1
    return this.value
  }
}

/** Whether a piece of furniture hangs on a wall (wall lights are drawn live, not baked into the building). */
export function onWall(type: FurnitureType): boolean {
  return FURNITURE[type].mount === 'wall'
}
