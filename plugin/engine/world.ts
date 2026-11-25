// The building from office/map.json: room stamps placed on a plan, corridors, doors, furniture and
// named spots, checked and turned into one tile grid. A new room or department is an edit of the
// JSON only; every mistake comes back as a readable line naming where it is.
import {
  FLOORS,
  FURNITURE,
  ROOM_KINDS,
  SPOT_KINDS,
  WALLS,
  isFurnitureType,
  type Blocking,
  type FloorKind,
  type FurnitureType,
  type RoomKind,
  type SpotKind,
  type WallStyle
} from './catalog'

export type Facing = 'up' | 'down' | 'left' | 'right'
export type TileKind = 'void' | 'wall' | 'floor' | 'door'

export type Room = {
  id: string
  kind: RoomKind
  label: string
  x: number
  y: number
  w: number
  h: number
  floor: FloorKind
  /** How the face of its top wall is painted. */
  wall: WallStyle
}

export type PlacedFurniture = {
  type: FurnitureType
  /** Absolute tile of the top-left corner. */
  x: number
  y: number
  w: number
  h: number
  facing: 'up' | 'down'
  room: string
  /** Desks only: `<room>.<id>`. */
  id?: string
  /** A free word for the picture (a counter's look, a plant's kind). */
  variant?: string
}

export type DeskSeat = {
  /** `<room id>.<desk id>`, what office/seating.json names. */
  id: string
  room: string
  roomKind: RoomKind
  /** A preferred role (`CTO`): a bot with that role takes this desk first. */
  role: string | null
  facing: 'up' | 'down'
  /** The desk's top-left tile. */
  x: number
  y: number
  /** The chair tile the bot walks to. */
  seat: { x: number; y: number }
}

export type Spot = { kind: SpotKind; x: number; y: number; room: string | null; facing: Facing }

export type Door = { x: number; y: number; owner: boolean; orientation: 'h' | 'v'; room: string | null }

export type World = {
  name: string
  width: number
  height: number
  tiles: TileKind[]
  floors: (FloorKind | null)[]
  /** Room id of each floor tile (walls: the room that drew them first). */
  roomAt: (string | null)[]
  /** Per tile: what furniture does to walking. */
  blocking: Blocking[]
  rooms: Room[]
  doors: Door[]
  furniture: PlacedFurniture[]
  desks: DeskSeat[]
  spots: Spot[]
}

export type ParseResult = { world: World | null; errors: string[] }

type Obj = Record<string, unknown>

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

class Errors {
  list: string[] = []
  add(path: string, message: string): void {
    if (this.list.length < 50) this.list.push(`${path}: ${message}`)
  }
}

function int(errors: Errors, obj: Obj, key: string, path: string, opts: { min?: number; optional?: boolean } = {}): number | null {
  const value = obj[key]
  if (value === undefined && opts.optional) return null
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    errors.add(path, `поле «${key}» должно быть целым числом`)
    return null
  }
  if (opts.min !== undefined && value < opts.min) {
    errors.add(path, `поле «${key}» должно быть не меньше ${opts.min}`)
    return null
  }
  return value
}

function str(errors: Errors, obj: Obj, key: string, path: string, optional = false): string | null {
  const value = obj[key]
  if (value === undefined && optional) return null
  if (typeof value !== 'string' || value.trim() === '') {
    errors.add(path, `поле «${key}» должно быть непустой строкой`)
    return null
  }
  return value
}

function oneOf<T extends string>(errors: Errors, obj: Obj, key: string, path: string, allowed: readonly T[], fallback?: T): T | null {
  const value = obj[key]
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    errors.add(path, `поле «${key}» = ${JSON.stringify(value)}, ожидается одно из: ${allowed.join(', ')}`)
    return null
  }
  return value as T
}

function list(errors: Errors, obj: Obj, key: string, path: string): unknown[] {
  const value = obj[key]
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    errors.add(path, `поле «${key}» должно быть массивом`)
    return []
  }
  return value
}

const ID = /^[a-z0-9][a-z0-9_-]*$/i

/** A room as the plan places it: a stamp (or an inline corridor) at a position. */
type RoomSource = {
  id: string
  path: string
  kind: RoomKind
  label: string
  x: number
  y: number
  w: number
  h: number
  floor: FloorKind
  wall: WallStyle
  furniture: unknown[]
  spots: unknown[]
  furniturePath: string
}

export function parseMap(raw: unknown): ParseResult {
  const errors = new Errors()
  if (!isObj(raw)) return { world: null, errors: ['map.json: ожидается JSON-объект'] }
  if (raw.version !== 1) errors.add('map.json', 'поле «version» должно быть 1')
  const name = typeof raw.name === 'string' ? raw.name : 'Office'
  const stamps = isObj(raw.stamps) ? raw.stamps : (errors.add('map.json', 'нет объекта «stamps» (штампы комнат)'), {})
  const plan = isObj(raw.plan) ? raw.plan : (errors.add('map.json', 'нет объекта «plan» (план здания)'), {})

  const sources: RoomSource[] = []
  const ids = new Set<string>()
  const claimId = (id: string, path: string): boolean => {
    if (!ID.test(id)) {
      errors.add(path, `id «${id}»: только латиница, цифры, «-» и «_»`)
      return false
    }
    if (ids.has(id)) {
      errors.add(path, `id «${id}» уже занят другой комнатой`)
      return false
    }
    ids.add(id)
    return true
  }

  list(errors, plan, 'rooms', 'plan').forEach((entry, index) => {
    const path = `plan.rooms[${index}]`
    if (!isObj(entry)) return errors.add(path, 'ожидается объект')
    const id = str(errors, entry, 'id', path)
    const stampName = str(errors, entry, 'stamp', path)
    const x = int(errors, entry, 'x', path, { min: 0 })
    const y = int(errors, entry, 'y', path, { min: 0 })
    if (id === null || stampName === null || x === null || y === null || !claimId(id, path)) return
    const stamp = stamps[stampName]
    if (!isObj(stamp)) return errors.add(path, `нет штампа «${stampName}» в stamps`)
    const stampPath = `stamps.${stampName}`
    const w = int(errors, stamp, 'w', stampPath, { min: 3 })
    const h = int(errors, stamp, 'h', stampPath, { min: 3 })
    const kind = oneOf(errors, stamp, 'kind', stampPath, ROOM_KINDS, 'other')
    const floor = oneOf(errors, stamp, 'floor', stampPath, FLOORS, 'wood')
    const wall = oneOf(errors, stamp, 'wall', stampPath, WALLS, 'plain')
    if (w === null || h === null || kind === null || floor === null || wall === null) return
    const label = typeof entry.label === 'string' ? entry.label : typeof stamp.label === 'string' ? stamp.label : ''
    sources.push({
      id,
      path,
      kind,
      label,
      x,
      y,
      w,
      h,
      floor,
      wall,
      furniture: list(errors, stamp, 'furniture', stampPath),
      spots: list(errors, stamp, 'spots', stampPath),
      furniturePath: stampPath
    })
  })

  list(errors, plan, 'corridors', 'plan').forEach((entry, index) => {
    const path = `plan.corridors[${index}]`
    if (!isObj(entry)) return errors.add(path, 'ожидается объект')
    const id = str(errors, entry, 'id', path)
    const x = int(errors, entry, 'x', path, { min: 0 })
    const y = int(errors, entry, 'y', path, { min: 0 })
    const w = int(errors, entry, 'w', path, { min: 3 })
    const h = int(errors, entry, 'h', path, { min: 3 })
    const floor = oneOf(errors, entry, 'floor', path, FLOORS, 'concrete')
    const wall = oneOf(errors, entry, 'wall', path, WALLS, 'plain')
    if (id === null || x === null || y === null || w === null || h === null || floor === null || wall === null || !claimId(id, path)) return
    sources.push({
      id,
      path,
      kind: 'corridor',
      label: typeof entry.label === 'string' ? entry.label : '',
      x,
      y,
      w,
      h,
      floor,
      wall,
      furniture: list(errors, entry, 'furniture', path),
      spots: list(errors, entry, 'spots', path),
      furniturePath: path
    })
  })

  if (sources.length === 0) {
    errors.add('plan', 'в плане нет ни одной комнаты')
    return { world: null, errors: errors.list }
  }

  const width = Math.max(...sources.map((room) => room.x + room.w))
  const height = Math.max(...sources.map((room) => room.y + room.h))
  if (width > 256 || height > 256) {
    errors.add('plan', `здание ${width}×${height} тайлов, предел 256×256`)
    return { world: null, errors: errors.list }
  }
  const size = width * height
  const tiles: TileKind[] = new Array(size).fill('void')
  const floors: (FloorKind | null)[] = new Array(size).fill(null)
  const roomAt: (string | null)[] = new Array(size).fill(null)
  const blocking: Blocking[] = new Array(size).fill('none')
  const at = (x: number, y: number) => y * width + x

  // Rooms: walls on the border (two rooms may share one), floor inside.
  for (const room of sources) {
    for (let y = room.y; y < room.y + room.h; y += 1) {
      for (let x = room.x; x < room.x + room.w; x += 1) {
        const border = x === room.x || y === room.y || x === room.x + room.w - 1 || y === room.y + room.h - 1
        const i = at(x, y)
        if (border) {
          if (tiles[i] === 'floor') {
            errors.add(room.path, `стена комнаты «${room.id}» в (${x},${y}) заходит внутрь «${roomAt[i]}»`)
            continue
          }
          if (tiles[i] === 'void') roomAt[i] = room.id
          tiles[i] = 'wall'
        } else {
          if (tiles[i] !== 'void') {
            errors.add(room.path, `комната «${room.id}» в (${x},${y}) пересекается с «${roomAt[i]}»`)
            continue
          }
          tiles[i] = 'floor'
          floors[i] = room.floor
          roomAt[i] = room.id
        }
      }
    }
  }

  const rooms: Room[] = sources.map(({ id, kind, label, x, y, w, h, floor, wall }) => ({ id, kind, label, x, y, w, h, floor, wall }))

  // Doors: a wall tile with floor on both sides (above/below, or left/right).
  const doors: Door[] = []
  list(errors, plan, 'doors', 'plan').forEach((entry, index) => {
    const path = `plan.doors[${index}]`
    if (!isObj(entry)) return errors.add(path, 'ожидается объект')
    const x = int(errors, entry, 'x', path, { min: 0 })
    const y = int(errors, entry, 'y', path, { min: 0 })
    if (x === null || y === null) return
    if (x >= width || y >= height || tiles[at(x, y)] !== 'wall') return errors.add(path, `дверь (${x},${y}) не на стене`)
    const floorAt = (fx: number, fy: number) =>
      fx >= 0 && fy >= 0 && fx < width && fy < height && tiles[at(fx, fy)] === 'floor'
    const horizontal = floorAt(x, y - 1) && floorAt(x, y + 1)
    const vertical = floorAt(x - 1, y) && floorAt(x + 1, y)
    if (!horizontal && !vertical) return errors.add(path, `дверь (${x},${y}) никуда не ведёт: по обе стороны должен быть пол`)
    tiles[at(x, y)] = 'door'
    const inner = horizontal ? roomAt[at(x, y - 1)] : roomAt[at(x - 1, y)]
    doors.push({ x, y, owner: entry.owner === true, orientation: horizontal ? 'h' : 'v', room: inner })
  })

  const furniture: PlacedFurniture[] = []
  const desks: DeskSeat[] = []
  const spots: Spot[] = []
  const deskIds = new Set<string>()

  for (const room of sources) {
    room.furniture.forEach((entry, index) => {
      const path = `${room.furniturePath}.furniture[${index}]`
      if (!isObj(entry)) return errors.add(path, 'ожидается объект')
      if (!isFurnitureType(entry.type)) {
        return errors.add(path, `неизвестный тип мебели ${JSON.stringify(entry.type)}; есть: ${Object.keys(FURNITURE).join(', ')}`)
      }
      const type = entry.type
      const spec = FURNITURE[type]
      const lx = int(errors, entry, 'x', path, { min: 0 })
      const ly = int(errors, entry, 'y', path, { min: 0 })
      if (lx === null || ly === null) return
      let w: number = spec.w
      let h: number = spec.h
      const sizable = 'sizable' in spec ? spec.sizable : undefined
      if (entry.w !== undefined || entry.h !== undefined) {
        if (!sizable) return errors.add(path, `у «${type}» размер фиксированный (${spec.w}×${spec.h}), уберите w/h`)
        w = int(errors, entry, 'w', path, { optional: true }) ?? w
        h = int(errors, entry, 'h', path, { optional: true }) ?? h
        if (w < sizable.minW || w > sizable.maxW || h < sizable.minH || h > sizable.maxH) {
          return errors.add(path, `размер «${type}» ${w}×${h} вне пределов ${sizable.minW}–${sizable.maxW} × ${sizable.minH}–${sizable.maxH}`)
        }
      }
      const facings: readonly ('up' | 'down')[] = 'facings' in spec ? spec.facings : ['down']
      const facing = oneOf(errors, entry, 'facing', path, facings, facings[0])
      if (facing === null) return
      const x = room.x + lx
      const y = room.y + ly
      const fits = (inside: (tx: number, ty: number) => boolean) => {
        for (let ty = y; ty < y + h; ty += 1) for (let tx = x; tx < x + w; tx += 1) if (!inside(tx, ty)) return false
        return true
      }
      if (spec.mount === 'wall') {
        if (ly !== 0) return errors.add(path, `«${type}» висит на стене: y должен быть 0 (верхняя стена комнаты)`)
        if (!fits((tx, ty) => tx > room.x && tx < room.x + room.w - 1 && tiles[at(tx, ty)] === 'wall')) {
          return errors.add(path, `«${type}» в (${lx},${ly}) не помещается на верхней стене «${room.id}»`)
        }
      } else if (!fits((tx, ty) => tx < width && ty < height && tiles[at(tx, ty)] === 'floor' && roomAt[at(tx, ty)] === room.id)) {
        return errors.add(path, `«${type}» в (${lx},${ly}) размером ${w}×${h} выходит за пол комнаты «${room.id}»`)
      }
      let id: string | undefined
      if ('needsId' in spec && spec.needsId) {
        const localId = str(errors, entry, 'id', path)
        if (localId === null) return
        id = `${room.id}.${localId}`
        if (deskIds.has(id)) return errors.add(path, `стол «${id}» уже есть`)
      }
      if (spec.mount === 'floor' && spec.blocking !== 'none') {
        let clash: string | null = null
        fits((tx, ty) => {
          if (blocking[at(tx, ty)] !== 'none') clash = `(${tx - room.x},${ty - room.y})`
          return true
        })
        if (clash) return errors.add(path, `«${type}» в ${clash} стоит на другой мебели`)
      }
      // A desk's chair tile must be free floor of the same room.
      let seat: { x: number; y: number } | null = null
      if (type === 'desk') {
        seat = { x, y: facing === 'up' ? y + 1 : y - 1 }
        const si = at(seat.x, seat.y)
        if (seat.y < 0 || seat.y >= height || tiles[si] !== 'floor' || roomAt[si] !== room.id || blocking[si] !== 'none') {
          return errors.add(path, `у стола «${id}» нет места для стула в (${seat.x - room.x},${seat.y - room.y})`)
        }
      }
      if (spec.mount === 'floor' && spec.blocking !== 'none') {
        fits((tx, ty) => {
          blocking[at(tx, ty)] = spec.blocking
          return true
        })
      }
      const placed: PlacedFurniture = { type, x, y, w, h, facing, room: room.id }
      if (id) placed.id = id
      if (typeof entry.variant === 'string') placed.variant = entry.variant
      furniture.push(placed)
      if (type === 'desk' && id && seat) {
        deskIds.add(id)
        const role = typeof entry.role === 'string' && entry.role.trim() ? entry.role.trim() : null
        desks.push({ id, room: room.id, roomKind: room.kind, role, facing, x, y, seat })
      }
      if (type === 'sofa') {
        for (let tx = x; tx < x + w; tx += 1) spots.push({ kind: 'sofa', x: tx, y, room: room.id, facing: 'down' })
      }
    })
  }

  // Desk chairs block nobody but must stay clear of other furniture placed after the desk.
  for (const desk of desks) {
    if (blocking[at(desk.seat.x, desk.seat.y)] !== 'none') errors.add(`стол «${desk.id}»`, 'на месте стула стоит мебель')
  }

  const readSpot = (entry: unknown, path: string, offsetX: number, offsetY: number, room: string | null) => {
    if (!isObj(entry)) return errors.add(path, 'ожидается объект')
    const kind = oneOf(errors, entry, 'kind', path, SPOT_KINDS.filter((k) => k !== 'sofa'))
    const lx = int(errors, entry, 'x', path, { min: 0 })
    const ly = int(errors, entry, 'y', path, { min: 0 })
    const facing = oneOf(errors, entry, 'facing', path, ['up', 'down', 'left', 'right'] as const, 'down')
    if (kind === null || lx === null || ly === null || facing === null) return
    const x = offsetX + lx
    const y = offsetY + ly
    const i = at(x, y)
    if (x >= width || y >= height || tiles[i] !== 'floor' || blocking[i] !== 'none') {
      return errors.add(path, `место «${kind}» в (${lx},${ly}) не на свободном полу`)
    }
    spots.push({ kind, x, y, room: room ?? roomAt[i], facing })
  }
  for (const room of sources) room.spots.forEach((entry, index) => readSpot(entry, `${room.furniturePath}.spots[${index}]`, room.x, room.y, room.id))
  list(errors, plan, 'spots', 'plan').forEach((entry, index) => readSpot(entry, `plan.spots[${index}]`, 0, 0, null))

  // What the status → place table needs must exist.
  if (!rooms.some((room) => room.kind === 'owner')) errors.add('plan', 'нет кабинета овнера (комната с kind "owner")')
  if (!doors.some((door) => door.owner)) errors.add('plan.doors', 'нет двери кабинета овнера ("owner": true)')
  if (!spots.some((spot) => spot.kind === 'owner-wait')) errors.add('plan.spots', 'нет ни одного места «owner-wait» у двери овнера')
  if (!spots.some((spot) => spot.kind === 'sofa' || spot.kind === 'kitchen')) errors.add('map.json', 'нет ни дивана, ни мест «kitchen»: отдыхать негде')
  if (desks.length === 0) errors.add('map.json', 'нет ни одного стола (desk)')

  const world: World = { name, width, height, tiles, floors, roomAt, blocking, rooms, doors, furniture, desks, spots }

  // Everyone must be able to walk everywhere: every chair and spot is reachable from the owner's door.
  if (errors.list.length === 0) {
    const start = spots.find((spot) => spot.kind === 'owner-wait')!
    const reach = reachable(world, start)
    for (const desk of desks) if (!reach.has(at(desk.seat.x, desk.seat.y))) errors.add(`стол «${desk.id}»`, 'до стула не дойти от двери овнера (нет двери или проход загорожен)')
    for (const spot of spots) if (!reach.has(at(spot.x, spot.y))) errors.add(`место «${spot.kind}» (${spot.x},${spot.y})`, 'не дойти от двери овнера')
  }
  return errors.list.length ? { world: null, errors: errors.list } : { world, errors: [] }
}

/** Whether a walk may step on this tile: floor and doors, not furniture; seats only as the goal. */
export function walkable(world: World, x: number, y: number, goal = false): boolean {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false
  const i = y * world.width + x
  const tile = world.tiles[i]
  if (tile !== 'floor' && tile !== 'door') return false
  const block = world.blocking[i]
  return block === 'none' || (block === 'seat' && goal)
}

/** Every tile index reachable on foot from `from` (seats count as reachable ends). */
function reachable(world: World, from: { x: number; y: number }): Set<number> {
  const seen = new Set<number>([from.y * world.width + from.x])
  const queue: [number, number][] = [[from.x, from.y]]
  while (queue.length) {
    const [x, y] = queue.shift()!
    for (const [dx, dy] of STEPS) {
      const nx = x + dx
      const ny = y + dy
      const i = ny * world.width + nx
      if (seen.has(i)) continue
      if (walkable(world, nx, ny)) {
        seen.add(i)
        queue.push([nx, ny])
      } else if (walkable(world, nx, ny, true)) {
        seen.add(i)
      }
    }
  }
  return seen
}

export const STEPS: readonly [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0]
]

export function roomOf(world: World, id: string | null): Room | undefined {
  return world.rooms.find((room) => room.id === id)
}
