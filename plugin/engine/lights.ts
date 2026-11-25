// Night light without tokens (v7.3). From the evening on the whole office darkens evenly in a cold
// blue-violet; a room where someone is (a bot, an employee, a trainee) switches its light on and gets
// an even warm light, wall to wall, with no pools; empty rooms stay dark; the corridor is dimly and
// evenly lit. The light fades in and out over ~0.7 s. Every lamp lights what is round it, stopped by
// walls, a little through doorways. Light is not painted on top: it lifts the night's dark off the scene
// (a `multiply` map, never above day), so floors, furniture and people show their own colours.
// Everything here is plain data and arithmetic; the shade is one value per tile, built again only
// when a room's light changes.
import { FURNITURE, TILE, type FurnitureType } from './catalog'
import type { PlacedFurniture, World } from './world'

/** How one kind of thing shines. Offsets are art pixels from its footprint's top-left. */
export type LightSpec = {
  color: string
  /** Reach in art pixels: at most ACCENT_MAX (two tiles). */
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
  // Lamps light what is round them: a desk lamp its desk and a couple of tiles, a wall lamp its wall and
  // the floor under it, a floor lamp by the sofa the sofa and its table. Walls stop it (see buildGlow).
  'floor-lamp': { color: '#ffc879', radius: 60, strength: 0.95, dx: 8, dy: -6, when: 'night' },
  'wall-lamp': { color: '#ffd38a', radius: 46, strength: 0.9, dx: 8, dy: 10, when: 'night' },
  'desk-lamp': { color: '#ffd27a', radius: 42, strength: 0.9, dx: 11, dy: 2, when: 'night' },
  candles: { color: '#ffa94d', radius: 36, strength: 0.85, dx: 8, dy: 3, flicker: true, when: 'night' },
  'ceo-desk': { color: '#ffd27a', radius: 48, strength: 0.9, dx: 41, dy: 12, when: 'night' },
  'night-light': { color: '#ffd9a0', radius: 26, strength: 0.7, dx: 8, dy: 9, when: 'night' },
  garland: { color: '#ffcf70', radius: 16, strength: 0.5, dx: 8, dy: 6, when: 'night' },
  'neon-sign': { color: '#ff6fc8', radius: 30, strength: 0.6, dx: 16, dy: 8, when: 'night' },
  aquarium: { color: '#5fd6ff', radius: 30, strength: 0.55, dx: 16, dy: -3, when: 'night' },
  'server-rack': { color: '#5df08a', radius: 12, strength: 0.4, dx: 11, dy: -4, when: 'night' },
  microwave: { color: '#ffd56a', radius: 26, strength: 0.75, dx: 8, dy: -5, when: 'use' },
  'coffee-machine': { color: '#ffb35c', radius: 22, strength: 0.65, dx: 8, dy: -4, when: 'use' },
  fridge: { color: '#dff2ff', radius: 30, strength: 0.75, dx: 8, dy: 0, when: 'use' }
}

/** The farthest a light reaches: four tiles (it never crosses a wall, see buildGlow). */
export const ACCENT_MAX = 4 * TILE

/** Looks of a light that change its colour (a rainbow garland, a pink or a blue neon). */
export const VARIANT_LIGHT: Record<string, Partial<LightSpec>> = {
  'garland:rainbow': { color: '#d9b0ff' },
  'neon-sign:heart': { color: '#ff5f8a' },
  'neon-sign:247': { color: '#5ff0ff' },
  'desk-lamp:': { color: '#e8f0a0' },
  'night-light:star': { color: '#fff2a8' },
  'wall-lamp:bulb': { color: '#fff0c0' }
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
    // A pack may ask for more, but a light reaches four tiles at most.
    const radius = Math.min(ACCENT_MAX, typeof look?.light?.radius === 'number' ? Math.max(4, look.light.radius) : spec.radius)
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
  // Lit screens: a small cool glow on the desk and on the face of whoever works there.
  for (const desk of world.desks) {
    const kind = inputs.screens.get(desk.id) ?? 'off'
    if (kind === 'off') continue
    const saver = kind.startsWith('saver')
    const x = desk.x * TILE + TILE
    const y = desk.facing === 'up' ? desk.y * TILE - 2 : desk.y * TILE - 4
    out.push({ key: `screen:${desk.id}`, x, y, radius: saver ? 12 : 26, color: SCREEN_LIGHT[kind], strength: saver ? 0.3 : 0.6, flicker: false, room: desk.room })
  }
  return out
}

/** A short signature of the lights: equal signatures, equal maps. */
export function lightsSignature(lights: readonly Light[]): string {
  return lights.map((l) => `${l.key}@${l.x},${l.y},${l.radius},${l.color},${l.strength}`).join('|')
}

// ── Light by rooms ───────────────────────────────────────────────────────────────────────

/** A tone over the office: a colour and how strongly it covers. */
export type Darkness = { color: string; alpha: number }

/** How long a room takes to switch its light on or off. */
export const ROOM_FADE_MS = 700
/** The corridor's light: dim and even, whoever is there. */
export const CORRIDOR_LEVEL = 0.45

/** Rooms with someone in them (a bot, an employee or a trainee standing, sitting or walking there). */
export function occupiedRooms(world: World, people: readonly { x: number; y: number }[]): Set<string> {
  const out = new Set<string>()
  for (const p of people) {
    const x = Math.round(p.x)
    const y = Math.round(p.y)
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue
    const room = world.roomAt[y * world.width + x]
    if (room && world.tiles[y * world.width + x] === 'floor') out.add(room)
  }
  return out
}

/** Where each room's light should go now: on (1) with someone in it, off (0) without, the corridor dim. */
export function roomTargets(world: World, occupied: ReadonlySet<string>): Map<string, number> {
  return new Map(world.rooms.map((r) => [r.id, r.kind === 'corridor' ? CORRIDOR_LEVEL : occupied.has(r.id) ? 1 : 0]))
}

/** Each room's light level, fading towards its target over ROOM_FADE_MS (no jumps). */
export class RoomLights {
  private readonly levels = new Map<string, number>()
  private targets = new Map<string, number>()
  private at: number | null = null

  /** New targets; the first call (or `snap`) puts every room straight there. */
  set(targets: ReadonlyMap<string, number>, now: number, snap = false): void {
    this.step(now)
    const first = this.levels.size === 0
    this.targets = new Map(targets)
    if (first || snap) for (const [k, v] of targets) this.levels.set(k, v)
  }

  /** Moves every level towards its target by the time passed. */
  step(now: number): void {
    const dt = this.at === null ? 0 : Math.max(0, now - this.at)
    this.at = now
    const d = dt / ROOM_FADE_MS
    for (const [k, target] of this.targets) {
      const v = this.levels.get(k) ?? target
      this.levels.set(k, v < target ? Math.min(target, v + d) : Math.max(target, v - d))
    }
  }

  /** Whether some room is still fading. */
  moving(): boolean {
    for (const [k, t] of this.targets) if (Math.abs((this.levels.get(k) ?? t) - t) > 1e-6) return true
    return false
  }

  get now(): ReadonlyMap<string, number> {
    return this.levels
  }

  /** The levels as a short string: equal strings, equal shade. */
  signature(): string {
    return [...this.levels].map(([k, v]) => `${k}:${Math.round(v * 64)}`).sort().join(',')
  }
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// ── The lamps' own light, stopped by walls ───────────────────────────────────────────────

/** Through an open doorway light passes only a little: the doorway itself, then the room beyond. */
export const DOOR_PASS = 0.35
export const BEYOND_DOOR = 0.25

/**
 * How much of a light reaches each tile: 1 in its own room, a little through a doorway, nothing through
 * a wall. A walk over floor and doors from the light's tile (a wall lamp starts on the floor under it);
 * the face of a top wall gets what the floor below it gets.
 */
export function lightReach(world: World, light: Pick<Light, 'x' | 'y' | 'radius'>): Map<number, number> {
  const W = world.width
  const H = world.height
  const reach = new Map<number, number>()
  let tx = Math.floor(light.x / TILE)
  let ty = Math.floor(light.y / TILE)
  const kind = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 'void' : world.tiles[y * W + x])
  if (kind(tx, ty) !== 'floor' && kind(tx, ty + 1) === 'floor') ty += 1
  if (kind(tx, ty) !== 'floor' && kind(tx, ty) !== 'door') return reach
  const maxTiles = Math.ceil(light.radius / TILE) + 1
  reach.set(ty * W + tx, 1)
  const queue: [number, number][] = [[tx, ty]]
  while (queue.length) {
    const [x, y] = queue.shift()!
    const m = reach.get(y * W + x)!
    const here = kind(x, y)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx
      const ny = y + dy
      if (Math.abs(nx - tx) > maxTiles || Math.abs(ny - ty) > maxTiles) continue
      const k = kind(nx, ny)
      if (k !== 'floor' && k !== 'door') continue
      const next = k === 'door' ? m * DOOR_PASS : here === 'door' ? m * BEYOND_DOOR : m
      const i = ny * W + nx
      if ((reach.get(i) ?? 0) >= next - 1e-9) continue
      reach.set(i, next)
      queue.push([nx, ny])
    }
  }
  // The face of a top wall shows the light of the floor below it.
  for (const [i, m] of [...reach]) {
    const x = i % W
    const y = Math.floor(i / W)
    if (kind(x, y) === 'floor' && kind(x, y - 1) === 'wall') reach.set((y - 1) * W + x, Math.max(reach.get((y - 1) * W + x) ?? 0, m))
  }
  return reach
}

/** One cell of the light map, in art pixels: fine enough for smooth light, small enough to build fast. */
export const LIGHT_CELL = 2
/** A room with its light on is a little dimmer than day, so a lamp in it still shows. */
export const ROOM_LIT = 0.72

/** The lamps' light per cell: `l` 0..1 (sources saturate, never add up past 1) and its tint. */
export type LampField = { w: number; h: number; l: Float32Array; tr: Float32Array; tg: Float32Array; tb: Float32Array }

/**
 * How much the lamps light each cell (0..1), stopped by walls (lightReach), a little through doorways,
 * fading smoothly with the distance. Overlapping lamps combine as 1 − (1 − a)(1 − b): never above 1.
 * Between tile centres the reach is blended, so a doorway fades instead of stepping; next to a wall it
 * stops at the wall. Built once per change of the lamps (a lamp switched, a screen on or off, an
 * appliance taken), not when a room's light fades.
 */
export function lampField(world: World, lights: readonly Light[]): LampField {
  const C = LIGHT_CELL
  const w = Math.ceil((world.width * TILE) / C)
  const h = Math.ceil((world.height * TILE) / C)
  const W = world.width
  const H = world.height
  const dark = new Float32Array(w * h).fill(1)
  const tr = new Float32Array(w * h)
  const tg = new Float32Array(w * h)
  const tb = new Float32Array(w * h)
  const tw = new Float32Array(w * h)
  for (const light of lights) {
    const reach = lightReach(world, light)
    if (!reach.size) continue
    const [r, g, b] = rgb(light.color)
    const top = Math.max(r, g, b, 1)
    const R = Math.min(ACCENT_MAX, light.radius)
    const x0 = Math.max(0, Math.floor((light.x - R) / C))
    const x1 = Math.min(w - 1, Math.ceil((light.x + R) / C))
    const y0 = Math.max(0, Math.floor((light.y - R) / C))
    const y1 = Math.min(h - 1, Math.ceil((light.y + R) / C))
    const gx0 = Math.max(0, Math.floor((x0 * C) / TILE) - 1)
    const gy0 = Math.max(0, Math.floor((y0 * C) / TILE) - 1)
    const gw = Math.min(W - 1, Math.floor((x1 * C) / TILE) + 1) - gx0 + 1
    const gh = Math.min(H - 1, Math.floor((y1 * C) / TILE) + 1) - gy0 + 1
    const grid = new Float32Array(gw * gh)
    for (const [i, m] of reach) {
      const gx = (i % W) - gx0
      const gy = Math.floor(i / W) - gy0
      if (gx >= 0 && gy >= 0 && gx < gw && gy < gh) grid[gy * gw + gx] = m
    }
    const at = (tx: number, ty: number) => {
      const gx = tx - gx0
      const gy = ty - gy0
      return gx < 0 || gy < 0 || gx >= gw || gy >= gh ? 0 : grid[gy * gw + gx]
    }
    for (let cy = y0; cy <= y1; cy += 1) {
      const py = cy * C + C / 2
      const dy = (py - light.y) * 1.1
      const fy = py / TILE - 0.5
      const iy = Math.floor(fy)
      const ay = fy - iy
      for (let cx = x0; cx <= x1; cx += 1) {
        const px = cx * C + C / 2
        const dx = px - light.x
        const dd = dx * dx + dy * dy
        if (dd >= R * R) continue
        const own = at(Math.floor(px / TILE), Math.floor(py / TILE))
        if (own <= 0) continue
        const fx = px / TILE - 0.5
        const ix = Math.floor(fx)
        const ax = fx - ix
        let v00 = at(ix, iy)
        let v10 = at(ix + 1, iy)
        let v01 = at(ix, iy + 1)
        let v11 = at(ix + 1, iy + 1)
        if (v00 <= 0) v00 = own
        if (v10 <= 0) v10 = own
        if (v01 <= 0) v01 = own
        if (v11 <= 0) v11 = own
        const m = (v00 * (1 - ax) + v10 * ax) * (1 - ay) + (v01 * (1 - ax) + v11 * ax) * ay
        const li = Math.min(1, light.strength * Math.pow(1 - Math.sqrt(dd) / R, 1.3) * m)
        const i = cy * w + cx
        dark[i] *= 1 - li
        tr[i] += (r / top) * li
        tg[i] += (g / top) * li
        tb[i] += (b / top) * li
        tw[i] += li
      }
    }
  }
  const l = new Float32Array(w * h)
  for (let i = 0; i < w * h; i += 1) {
    l[i] = 1 - dark[i]
    if (tw[i] > 0) {
      tr[i] /= tw[i]
      tg[i] /= tw[i]
      tb[i] /= tw[i]
    }
  }
  return { w, h, l, tr, tg, tb }
}

/**
 * The light map, one RGBA value per cell, laid over the office with `multiply`: every channel a factor
 * between the night's (light off) and the lit tone (light on), never above 1, so nothing at night is
 * brighter than by day; where light falls the real colours of floors, furniture and people show. A room's
 * light (its level, the same over the whole room) and the lamps' light combine as 1 − (1 − a)(1 − b).
 * A wall takes the room its face looks into; the void outside is left alone.
 */
export function buildLightMap(world: World, levels: ReadonlyMap<string, number>, field: LampField, night: Darkness, lit: Darkness): Uint8ClampedArray {
  const W = world.width
  const H = world.height
  const C = LIGHT_CELL
  const { w, h } = field
  const out = new Uint8ClampedArray(w * h * 4)
  const [dr, dg, db] = rgb(night.color)
  const [lr, lg, lb] = rgb(lit.color)
  const levelAt = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= W || y >= H) return -1
    const i = y * W + x
    if (world.tiles[i] !== 'floor') return -1
    return levels.get(world.roomAt[i] ?? '') ?? 0
  }
  // The room light of every tile (walls: the room their face looks into), or -1 for the void.
  const tileLevel = new Float32Array(W * H)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x
      if (world.tiles[i] === 'void') {
        tileLevel[i] = -1
        continue
      }
      let l = levelAt(x, y)
      if (l < 0) l = levelAt(x, y + 1) >= 0 ? levelAt(x, y + 1) : Math.max(levelAt(x - 1, y), levelAt(x + 1, y), levelAt(x, y - 1))
      if (l < 0) l = Math.max(0, levelAt(x - 1, y + 1), levelAt(x + 1, y + 1), levelAt(x - 1, y - 1), levelAt(x + 1, y - 1))
      tileLevel[i] = l
    }
  }
  for (let cy = 0; cy < h; cy += 1) {
    const ty = Math.floor((cy * C) / TILE)
    for (let cx = 0; cx < w; cx += 1) {
      const level = tileLevel[ty * W + Math.floor((cx * C) / TILE)]
      if (level < 0) continue
      const i = cy * w + cx
      const room = level * ROOM_LIT
      const lamp = field.l[i]
      const L = 1 - (1 - room) * (1 - lamp)
      // Lit by lamps: their own warm (or a screen's cool) tint, half way to the room's lit tone.
      const share = lamp > 0 ? lamp / (room + lamp) : 0
      const tr = lr * (1 - share * 0.35) + 255 * field.tr[i] * share * 0.35
      const tg = lg * (1 - share * 0.35) + 255 * field.tg[i] * share * 0.35
      const tb = lb * (1 - share * 0.35) + 255 * field.tb[i] * share * 0.35
      out[i * 4] = Math.min(255, dr + (tr - dr) * L)
      out[i * 4 + 1] = Math.min(255, dg + (tg - dg) * L)
      out[i * 4 + 2] = Math.min(255, db + (tb - db) * L)
      out[i * 4 + 3] = 255
    }
  }
  return out
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
