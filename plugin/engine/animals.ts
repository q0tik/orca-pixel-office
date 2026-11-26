// Office animals as data, like skin packs: one JSON file per species in office/animals/ (listed in
// index.json) gives its sprites, coats, speed, the rooms it may go to and its routines (where it
// goes and how long it stays). The engine here only reads that and moves the animals: walkers by
// BFS over the floor, fliers in straight lines; perches on things (a desk, a sill, a shelf, a cage,
// a bot's shoulder). Pure decoration: no Orca data, no tokens. Animals never block anyone (bots
// walk through them) and are drawn under every sign, label and envelope.
import { findPath, type Point } from './path'
import { walkable, type World } from './world'
import type { RoomKind } from './catalog'

export const ANIMAL_FORMAT = 1

/** Where a routine sends an animal. */
export const PLACES = ['anywhere', 'sofa', 'desk', 'window', 'aquarium', 'bowl', 'bed', 'owner-door', 'bot', 'shoulder', 'shelf', 'cage'] as const
export type PlaceKind = (typeof PLACES)[number]
export const POSES = ['sit', 'sleep', 'lie', 'perch'] as const
export type AnimalPose = (typeof POSES)[number] | 'walk' | 'fly'

export type Frame = string[]
export type SpeciesSprites = { legend: Record<string, string>; walk: Frame[]; sit: Frame[]; sleep?: Frame[]; lie?: Frame[]; perch?: Frame[]; fly?: Frame[] }
export type Coat = { id: string; name: string; colors: Record<string, string> }
export type Routine = { id: string; at: PlaceKind; pose: (typeof POSES)[number]; stay: [number, number]; weight: number; follow: boolean }
export type Species = {
  id: string
  name: string
  author: string
  license: string
  moves: 'walk' | 'fly'
  /** Tiles a second. */
  speed: number
  w: number
  h: number
  rooms: RoomKind[]
  coats: Coat[]
  instances: { id: string; name: string; coat: string }[]
  sprites: SpeciesSprites
  routines: Routine[]
}

const COLOR = /^#[0-9a-f]{6}$/i
const ID = /^[a-z0-9][a-z0-9-]*$/
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const ROOM_KINDS: readonly RoomKind[] = ['owner', 'reception', 'clevel', 'specialists', 'team', 'lounge', 'corridor', 'other']

/** One species file; every mistake is a line naming the file and the field. A broken file loads nothing. */
export function parseSpecies(raw: unknown, file: string, paletteKeys: ReadonlySet<string>): { species: Species | null; errors: string[] } {
  const errors: string[] = []
  const at = (field: string, message: string) => errors.push(`${file}: ${field}: ${message}`)
  if (!isObj(raw)) return { species: null, errors: [`${file}: ожидается JSON-объект`] }
  if (raw.format !== ANIMAL_FORMAT) at('format', `должно быть ${ANIMAL_FORMAT}`)
  const id = typeof raw.id === 'string' && ID.test(raw.id) ? raw.id : (at('id', 'латиница в нижнем регистре, цифры и «-»'), '')
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : (at('name', 'нужно название'), '')
  const moves = raw.moves === 'fly' ? 'fly' : raw.moves === 'walk' ? 'walk' : (at('moves', 'ожидается "walk" или "fly"'), 'walk')
  const speed = typeof raw.speed === 'number' && raw.speed > 0 && raw.speed <= 10 ? raw.speed : (at('speed', 'тайлов в секунду, больше 0 и не больше 10'), 1)
  const size = Array.isArray(raw.size) ? raw.size : []
  const [w, h] = size.length === 2 && size.every((n) => Number.isInteger(n) && (n as number) >= 4 && (n as number) <= 24) ? (size as number[]) : (at('size', 'ожидается [ширина, высота], от 4 до 24 пикселей'), [0, 0])
  const rooms: RoomKind[] = []
  if (!Array.isArray(raw.rooms) || raw.rooms.length === 0) at('rooms', `ожидается непустой список из: ${ROOM_KINDS.join(', ')}`)
  else for (const r of raw.rooms) (ROOM_KINDS as readonly unknown[]).includes(r) ? rooms.push(r as RoomKind) : at('rooms', `${JSON.stringify(r)} — есть: ${ROOM_KINDS.join(', ')}`)

  // Coats: the `$name` colours of the legend, per coat.
  const coats: Coat[] = []
  const slots = new Set<string>()
  const legend: Record<string, string> = {}
  const sprites = isObj(raw.sprites) ? raw.sprites : (at('sprites', 'ожидается объект { legend, walk, sit, … }'), {} as Obj)
  if (!isObj(sprites.legend)) at('sprites.legend', 'ожидается объект { "a": "#rrggbb" | "@цветПалитры" | "$цветОкраса" }')
  else {
    for (const [ch, c] of Object.entries(sprites.legend)) {
      if ([...ch].length !== 1 || ch === '.' || ch === ' ') at(`sprites.legend.${ch}`, 'ключ — один символ, кроме «.» и пробела')
      else if (typeof c === 'string' && (COLOR.test(c) || (c.startsWith('@') && paletteKeys.has(c.slice(1))))) legend[ch] = c
      else if (typeof c === 'string' && /^\$[a-z][a-zA-Z0-9]*$/.test(c)) {
        legend[ch] = c
        slots.add(c.slice(1))
      } else at(`sprites.legend.${ch}`, `${JSON.stringify(c)} — ожидается "#rrggbb", "@цветПалитры" или "$цветОкраса"`)
    }
  }
  const frames = (name: string, required: boolean): Frame[] | undefined => {
    const list = sprites[name]
    if (list === undefined) {
      if (required) at(`sprites.${name}`, 'нужен список кадров')
      return undefined
    }
    if (!Array.isArray(list) || list.length === 0) return at(`sprites.${name}`, 'ожидается непустой список кадров'), undefined
    const out: Frame[] = []
    list.forEach((frame, i) => {
      if (!Array.isArray(frame) || frame.length !== h) return at(`sprites.${name}[${i}]`, `ожидается ${h} строк`)
      for (const [j, row] of frame.entries()) {
        if (typeof row !== 'string' || [...row].length !== w) return at(`sprites.${name}[${i}][${j}]`, `ожидается строка из ${w} символов`)
        for (const ch of row) if (ch !== '.' && ch !== ' ' && !(ch in legend)) return at(`sprites.${name}[${i}][${j}]`, `символ «${ch}» не описан в legend`)
      }
      out.push(frame as string[])
    })
    return out
  }
  const walk = frames(moves === 'fly' ? 'fly' : 'walk', true)
  const sit = frames('sit', true)
  const sleep = frames('sleep', false)
  const lie = frames('lie', false)
  const perch = frames('perch', false)
  if (!Array.isArray(raw.coats) || raw.coats.length === 0) at('coats', 'нужен хотя бы один окрас')
  else
    raw.coats.forEach((c, i) => {
      if (!isObj(c) || typeof c.id !== 'string' || !ID.test(c.id) || typeof c.name !== 'string' || !isObj(c.colors)) return at(`coats[${i}]`, 'ожидается { "id", "name", "colors": { … } }')
      const colors: Record<string, string> = {}
      for (const slot of slots) {
        const v = c.colors[slot]
        if (typeof v === 'string' && COLOR.test(v)) colors[slot] = v
        else at(`coats[${i}].colors.${slot}`, 'нужен цвет "#rrggbb" для каждого $цвета легенды')
      }
      coats.push({ id: c.id, name: c.name, colors })
    })
  const instances: Species['instances'] = []
  if (!Array.isArray(raw.instances) || raw.instances.length === 0 || raw.instances.length > 6) at('instances', 'от 1 до 6 зверей этого вида')
  else
    raw.instances.forEach((it, i) => {
      if (!isObj(it) || typeof it.id !== 'string' || !ID.test(it.id) || typeof it.name !== 'string') return at(`instances[${i}]`, 'ожидается { "id", "name", "coat" }')
      const coat = typeof it.coat === 'string' && coats.some((c) => c.id === it.coat) ? it.coat : coats[0]?.id ?? ''
      if (it.coat !== undefined && coat !== it.coat) at(`instances[${i}].coat`, `нет окраса ${JSON.stringify(it.coat)}`)
      instances.push({ id: `${id}-${it.id}`, name: it.name, coat })
    })
  const routines: Routine[] = []
  if (!Array.isArray(raw.routines) || raw.routines.length === 0) at('routines', 'нужна хотя бы одна рутина')
  else
    raw.routines.forEach((r, i) => {
      const f = `routines[${i}]`
      if (!isObj(r)) return at(f, 'ожидается объект')
      if (!(PLACES as readonly unknown[]).includes(r.at)) return at(`${f}.at`, `${JSON.stringify(r.at)} — есть: ${PLACES.join(', ')}`)
      if (!(POSES as readonly unknown[]).includes(r.pose)) return at(`${f}.pose`, `${JSON.stringify(r.pose)} — есть: ${POSES.join(', ')}`)
      const pose = r.pose as Routine['pose']
      if (pose !== 'sit' && !{ sleep, lie, perch }[pose]) return at(`${f}.pose`, `нет кадров sprites.${pose}`)
      const stay = Array.isArray(r.stay) && r.stay.length === 2 && r.stay.every((n) => typeof n === 'number' && n > 0 && n <= 600) && (r.stay[0] as number) <= (r.stay[1] as number) ? (r.stay as [number, number]) : null
      if (!stay) return at(`${f}.stay`, 'ожидается [от, до] в секундах, до 600')
      const weight = r.weight === undefined ? 1 : typeof r.weight === 'number' && r.weight > 0 ? r.weight : (at(`${f}.weight`, 'число больше 0'), 0)
      if (!weight) return
      if ((r.at === 'shoulder' || r.at === 'shelf' || r.at === 'cage') && moves !== 'fly') return at(`${f}.at`, `«${r.at}» — только для летающих (moves: "fly")`)
      routines.push({ id: typeof r.id === 'string' ? r.id : `${r.at}-${i}`, at: r.at as PlaceKind, pose, stay, weight, follow: r.follow === true })
    })
  if (errors.length || !walk || !sit) return { species: null, errors }
  return {
    species: {
      id,
      name,
      author: typeof raw.author === 'string' ? raw.author : '',
      license: typeof raw.license === 'string' ? raw.license : '',
      moves,
      speed,
      w,
      h,
      rooms,
      coats,
      instances,
      sprites: { legend, walk, sit, ...(sleep ? { sleep } : {}), ...(lie ? { lie } : {}), ...(perch ? { perch } : {}) },
      routines
    },
    errors
  }
}

/** office/animals/index.json and every species it lists; a bad file is skipped with its errors. */
export async function loadSpecies(read: (file: string) => Promise<unknown>, paletteKeys: ReadonlySet<string>): Promise<{ species: Species[]; errors: string[] }> {
  let files: unknown
  try {
    files = await read('index.json')
  } catch (error) {
    return { species: [], errors: [`animals/index.json: ${(error as Error).message}`] }
  }
  if (!Array.isArray(files)) return { species: [], errors: ['animals/index.json: ожидается массив имён файлов'] }
  const species: Species[] = []
  const errors: string[] = []
  for (const file of files) {
    if (typeof file !== 'string' || !/^[a-z0-9-]+\.json$/.test(file)) {
      errors.push(`animals/index.json: ${JSON.stringify(file)} — ожидается имя файла вида "cat.json"`)
      continue
    }
    try {
      const parsed = parseSpecies(await read(file), `animals/${file}`, paletteKeys)
      errors.push(...parsed.errors)
      if (parsed.species && species.some((s) => s.id === parsed.species!.id)) errors.push(`animals/${file}: id «${parsed.species.id}» уже есть`)
      else if (parsed.species) species.push(parsed.species)
    } catch (error) {
      errors.push(`animals/${file}: ${(error as Error).message}`)
    }
  }
  return { species, errors }
}

// ── The owner's choices ──────────────────────────────────────────────────────────────────

export const ANIMALS_STORAGE_KEY = 'animals'
export type AnimalChoices = Record<string, { off?: boolean; coat?: string }>

export function parseAnimalChoices(raw: unknown): AnimalChoices {
  const out: AnimalChoices = {}
  if (!isObj(raw)) return out
  for (const [id, v] of Object.entries(raw)) {
    if (!isObj(v)) continue
    const c: { off?: boolean; coat?: string } = {}
    if (v.off === true) c.off = true
    if (typeof v.coat === 'string') c.coat = v.coat
    if (c.off || c.coat) out[id] = c
  }
  return out
}

// ── Places ──────────────────────────────────────────────────────────────────────────────

/** A place to be: the tile to walk (or fly) to, and where the animal ends up drawn (`perch`, `dy`). */
export type Spot = { x: number; y: number; perch?: Point; dy: number; facing: 'left' | 'right'; follow?: string }

export type BotView = { key: string; x: number; y: number; walking: boolean }

const key = (p: Point) => `${p.x},${p.y}`

/** The candidate spots for a place kind, in the rooms the species may go to. */
export function spotsFor(world: World, species: Pick<Species, 'rooms' | 'moves'>, at: PlaceKind, bots: readonly BotView[]): Spot[] {
  const kinds = new Set(species.rooms)
  const roomKind = (x: number, y: number) => world.rooms.find((r) => r.id === world.roomAt[y * world.width + x])?.kind
  const inRooms = (x: number, y: number) => kinds.has(roomKind(x, y) as RoomKind)
  const floor = (x: number, y: number) => walkable(world, x, y) && world.tiles[y * world.width + x] === 'floor'
  const seats = new Set(world.desks.map((d) => key(d.seat)))
  const free = (x: number, y: number) => floor(x, y) && !seats.has(`${x},${y}`) && inRooms(x, y)
  const near = (x: number, y: number): Point | null => {
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) if (free(x + dx, y + dy)) return { x: x + dx, y: y + dy }
    return null
  }
  const items = (types: string[]) => world.furniture.filter((f) => types.includes(f.type) && kinds.has(world.rooms.find((r) => r.id === f.room)?.kind as RoomKind))
  const out: Spot[] = []
  switch (at) {
    case 'anywhere':
      for (let y = 0; y < world.height; y += 2) for (let x = 0; x < world.width; x += 2) if (free(x, y)) out.push({ x, y, dy: 0, facing: (x + y) % 4 ? 'left' : 'right' })
      break
    case 'sofa':
      for (const s of world.spots) if (s.kind === 'sofa' && inRooms(s.x, s.y)) out.push({ x: s.x, y: s.y, dy: -5, facing: 'right' })
      break
    case 'desk':
      for (const d of world.desks) {
        if (!kinds.has(d.roomKind)) continue
        const a = near(d.x + 1, d.y)
        if (a) out.push({ ...a, perch: { x: d.x + 1, y: d.y }, dy: -9, facing: 'left' })
      }
      break
    case 'window':
      for (const f of items(['window'])) {
        const a = { x: f.x + Math.floor(f.w / 2), y: f.y + 1 }
        if (free(a.x, a.y)) out.push({ ...a, perch: { x: a.x, y: f.y }, dy: 2, facing: 'right' })
      }
      break
    case 'aquarium':
      for (const f of items(['aquarium'])) {
        const a = { x: f.x, y: f.y + f.h }
        if (free(a.x, a.y)) out.push({ ...a, dy: 0, facing: 'right' })
      }
      break
    case 'bowl':
      for (const f of items(['pet-bowl'])) {
        const a = near(f.x, f.y)
        if (a) out.push({ ...a, dy: 0, facing: a.x < f.x ? 'right' : 'left' })
      }
      break
    case 'bed':
      for (const f of items(['pet-bed'])) out.push({ x: f.x, y: f.y, dy: -2, facing: 'right' })
      break
    case 'owner-door': {
      const door = world.doors.find((d) => d.owner)
      if (door) for (const [dx, dy] of [[-2, 1], [2, 1], [-1, 2], [1, 2]]) if (free(door.x + dx, door.y + dy)) out.push({ x: door.x + dx, y: door.y + dy, dy: 0, facing: dx < 0 ? 'right' : 'left' })
      break
    }
    case 'bot':
      for (const b of bots) {
        if (b.walking) continue
        const bx = Math.round(b.x)
        const by = Math.round(b.y)
        const a = near(bx, by)
        if (a) out.push({ ...a, dy: 0, facing: a.x < bx ? 'right' : 'left', follow: b.key })
      }
      break
    case 'shoulder':
      for (const b of bots) if (!b.walking && kinds.has(roomKind(Math.round(b.x), Math.round(b.y)) as RoomKind)) out.push({ x: Math.round(b.x), y: Math.round(b.y), perch: { x: Math.round(b.x), y: Math.round(b.y) }, dy: -15, facing: 'right', follow: b.key })
      break
    case 'shelf':
      for (const f of items(['bookshelf'])) out.push({ x: f.x, y: f.y, perch: { x: f.x + (f.w > 1 ? 1 : 0), y: f.y }, dy: -18, facing: 'left' })
      break
    case 'cage':
      for (const f of items(['bird-cage'])) out.push({ x: f.x, y: f.y, perch: { x: f.x, y: f.y }, dy: -9, facing: 'right' })
      break
  }
  return out
}

// ── The zoo ─────────────────────────────────────────────────────────────────────────────

export type AnimalView = {
  id: string
  species: string
  coat: string
  /** Tiles, fractional while moving; `dy` lifts the sprite (art pixels) onto a perch. */
  x: number
  y: number
  dy: number
  pose: AnimalPose
  facing: 'left' | 'right'
  /** Which frame of the pose's frames. */
  frame: number
  /** Drawn over this bot (a parrot on its shoulder). */
  over?: string
  doing: string
}

type State = {
  id: string
  species: Species
  coat: string
  x: number
  y: number
  dy: number
  path: Point[]
  progress: number
  /** Flying: from where, to where, how far along. */
  flight: { from: Point; to: Point; fromDy: number; toDy: number; t: number; length: number } | null
  routine: Routine | null
  spot: Spot | null
  /** When the stay ends (ms), and when a follower looks for its bot again. */
  until: number
  check: number
  facing: 'left' | 'right'
  walked: number
}

const DOING: Record<PlaceKind, string> = {
  anywhere: 'гуляет',
  sofa: 'на диване',
  desk: 'на столе',
  window: 'на подоконнике',
  aquarium: 'смотрит на рыбок',
  bowl: 'у миски',
  bed: 'на лежанке',
  'owner-door': 'у двери CEO',
  bot: 'рядом с ботом',
  shoulder: 'на плече у бота',
  shelf: 'на шкафу',
  cage: 'в клетке'
}

export class Zoo {
  private readonly states = new Map<string, State>()
  private last = 0

  constructor(
    private readonly world: World,
    private readonly random: () => number = Math.random
  ) {}

  /** Which animals are in the office and in what coat. New ones appear at a free spot of their first routine. */
  sync(species: readonly Species[], choices: AnimalChoices, now: number): void {
    const want = new Set<string>()
    for (const sp of species) {
      for (const it of sp.instances) {
        if (choices[it.id]?.off) continue
        want.add(it.id)
        const coat = sp.coats.some((c) => c.id === choices[it.id]?.coat) ? choices[it.id]!.coat! : it.coat
        const s = this.states.get(it.id)
        if (s) {
          s.coat = coat
          s.species = sp
          continue
        }
        const first = this.pickSpot(sp, sp.routines[0], [], it.id)
        const start = first ?? this.anyFloor(sp)
        if (!start) continue
        const at = start.perch ?? start
        // No spot for its first routine yet (no bots in the office): a short pause, then another try.
        const until = first ? now + this.stay(sp.routines[0]) : now + 3000
        this.states.set(it.id, { id: it.id, species: sp, coat, x: at.x, y: at.y, dy: start.dy, path: [], progress: 0, flight: null, routine: first ? sp.routines[0] : null, spot: start, until, check: now, facing: start.facing, walked: 0 })
      }
    }
    for (const id of [...this.states.keys()]) if (!want.has(id)) this.states.delete(id)
  }

  private stay(r: Routine): number {
    return (r.stay[0] + (r.stay[1] - r.stay[0]) * this.random()) * 1000
  }

  private anyFloor(sp: Species): Spot | null {
    const all = spotsFor(this.world, sp, 'anywhere', [])
    return all.length ? all[Math.floor(this.random() * all.length)] : null
  }

  /** A free spot for a routine: not where another animal is or goes. */
  private pickSpot(sp: Species, r: Routine, bots: readonly BotView[], self: string): Spot | null {
    const taken = new Set<string>()
    for (const s of this.states.values()) {
      if (s.id === self || !s.spot) continue
      taken.add(key(s.spot.perch ?? s.spot))
    }
    const list = spotsFor(this.world, sp, r.at, bots).filter((s) => !taken.has(key(s.perch ?? s)))
    return list.length ? list[Math.floor(this.random() * list.length)] : null
  }

  private nextRoutine(sp: Species): Routine {
    const total = sp.routines.reduce((a, r) => a + r.weight, 0)
    let roll = this.random() * total
    for (const r of sp.routines) {
      roll -= r.weight
      if (roll <= 0) return r
    }
    return sp.routines[sp.routines.length - 1]
  }

  /** Off to a new spot: walkers by BFS (then a hop onto the perch), fliers straight there. */
  private go(s: State, spot: Spot, r: Routine, now: number): void {
    const prev = s.spot
    s.routine = r
    s.spot = spot
    s.until = now + this.stay(r)
    s.check = now + 4000
    const goal = spot.perch ?? spot
    if (s.species.moves === 'fly') {
      const from = { x: s.x, y: s.y }
      const length = Math.max(0.5, Math.hypot(goal.x - from.x, goal.y - from.y))
      s.flight = { from, to: goal, fromDy: s.dy, toDy: spot.dy, t: 0, length }
      s.path = []
      return
    }
    // Get down from a perch first (onto the tile it hopped up from), then walk.
    if (prev?.perch) {
      s.x = prev.x
      s.y = prev.y
    }
    const start = { x: Math.round(s.x), y: Math.round(s.y) }
    s.dy = 0
    const path = findPath(this.world, start, { x: spot.x, y: spot.y })
    s.path = path ?? []
    s.progress = 0
    if (!path) {
      s.x = spot.x
      s.y = spot.y
    }
  }

  /** One step of time; returns whether anything moved or changed pose. */
  tick(now: number, bots: readonly BotView[]): boolean {
    const dt = this.last ? Math.min(500, now - this.last) : 0
    this.last = now
    let changed = false
    const botAt = new Map(bots.map((b) => [b.key, b]))
    for (const s of this.states.values()) {
      const step = (s.species.speed * dt) / 1000
      if (s.flight) {
        const f = s.flight
        f.t = Math.min(1, f.t + step / f.length)
        s.x = f.from.x + (f.to.x - f.from.x) * f.t
        s.y = f.from.y + (f.to.y - f.from.y) * f.t
        // An arc: up in the middle of the flight.
        s.dy = f.fromDy + (f.toDy - f.fromDy) * f.t - Math.sin(Math.PI * f.t) * Math.min(24, 6 + f.length * 2)
        if (f.to.x !== f.from.x) s.facing = f.to.x > f.from.x ? 'right' : 'left'
        s.walked += step
        if (f.t >= 1) {
          s.flight = null
          s.dy = s.spot?.dy ?? 0
          s.facing = s.spot?.facing ?? s.facing
        }
        changed = true
        continue
      }
      if (s.path.length) {
        let budget = step
        while (budget > 0 && s.path.length) {
          const next = s.path[0]
          if (next.x !== s.x) s.facing = next.x > s.x ? 'right' : 'left'
          const d = Math.min(budget, 1 - s.progress)
          s.progress += d
          s.walked += d
          budget -= d
          if (s.progress >= 1 - 1e-9) {
            s.x = next.x
            s.y = next.y
            s.progress = 0
            s.path.shift()
          }
        }
        if (!s.path.length && s.spot) {
          // Arrived: hop onto the perch, if there is one.
          if (s.spot.perch) {
            s.x = s.spot.perch.x
            s.y = s.spot.perch.y
          }
          s.dy = s.spot.dy
          s.facing = s.spot.facing
        }
        changed = true
        continue
      }
      // Staying. A follower keeps to its bot; a shoulder rides along.
      if (s.spot?.follow) {
        const b = botAt.get(s.spot.follow)
        if (!b) s.until = now
        else if (s.routine?.at === 'shoulder') {
          if (b.walking) {
            s.until = now
          } else if (Math.round(b.x) !== s.x || Math.round(b.y) !== s.y) {
            s.x = Math.round(b.x)
            s.y = Math.round(b.y)
            changed = true
          }
        } else if (s.routine?.follow && now >= s.check) {
          s.check = now + 2000
          const d = Math.abs(b.x - s.x) + Math.abs(b.y - s.y)
          if (d > 2.5) {
            const again = spotsFor(this.world, s.species, 'bot', [{ ...b, walking: false }])[0]
            if (again) {
              const until = s.until
              this.go(s, again, s.routine, now)
              s.until = until
              changed = true
            }
          }
        }
      }
      if (now >= s.until) {
        const r = this.nextRoutine(s.species)
        const spot = this.pickSpot(s.species, r, bots, s.id)
        if (spot) this.go(s, spot, r, now)
        else s.until = now + 5000
        changed = true
      }
    }
    return changed
  }

  /** Whether anything is on its way (the timer must run). */
  moving(): boolean {
    for (const s of this.states.values()) if (s.path.length || s.flight) return true
    return this.states.size > 0
  }

  /** The earliest moment some animal leaves its spot. */
  nextAt(): number {
    let at = Infinity
    for (const s of this.states.values()) at = Math.min(at, s.path.length || s.flight ? 0 : s.until)
    return at
  }

  views(now: number, ambientFrame: number): AnimalView[] {
    return [...this.states.values()].map((s) => {
      const next = s.path[0]
      const x = next ? s.x + (next.x - s.x) * s.progress : s.x
      const y = next ? s.y + (next.y - s.y) * s.progress : s.y
      const moving = !!next || !!s.flight
      const pose: AnimalPose = moving ? (s.species.moves === 'fly' ? 'fly' : 'walk') : s.routine?.pose ?? 'sit'
      const frames = pose === 'walk' || pose === 'fly' ? s.species.sprites.walk : s.species.sprites[pose] ?? s.species.sprites.sit
      const frame = moving ? Math.floor(s.walked * 4) % frames.length : Math.floor(ambientFrame / 3) % frames.length
      const over = !moving && s.routine?.at === 'shoulder' ? s.spot?.follow : undefined
      return { id: s.id, species: s.species.id, coat: s.coat, x, y, dy: s.dy, pose, facing: s.facing, frame, ...(over ? { over } : {}), doing: moving ? (s.species.moves === 'fly' ? 'летает' : 'идёт') : DOING[s.routine?.at ?? 'anywhere'] }
    })
  }

  /** Test helper: the routine an animal is on. */
  routineOf(id: string): Routine | null {
    return this.states.get(id)?.routine ?? null
  }
}

/** The frames of a pose, for the renderer (walkers walk, fliers fly with the same list). */
export function framesOf(sp: Species, pose: AnimalPose): Frame[] {
  if (pose === 'walk' || pose === 'fly') return sp.sprites.walk
  return sp.sprites[pose] ?? sp.sprites.sit
}

/** Colour of a legend entry for a coat: `$slot` from the coat, `@name` from the palette, `#hex` as is. */
export function legendColor(value: string, coat: Coat | undefined, palette: Readonly<Record<string, unknown>>): string | null {
  if (value.startsWith('$')) return coat?.colors[value.slice(1)] ?? null
  if (value.startsWith('@')) return (palette[value.slice(1)] as string | undefined) ?? null
  return value
}
