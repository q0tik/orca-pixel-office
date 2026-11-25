// «Жизнь» without tokens: decorative routines that always follow the real status. A resting bot
// (done/idle in the lounge) strolls between the coffee machine, the microwave, the fridge, the cooler, the sofa, the aquarium,
// a window and the bookshelf; a bot waiting for the owner paces the reception by the owner's door
// with its sign up. A working bot stays at its desk. Nothing here calls anything: it only picks
// tiles over time, and the cast walks there by BFS. Real events win: a new status, Needs you, a
// failed turn or a letter send the bot straight to the place the status table gives.
import type { RestPose, Target } from './locations'
import { walkable, type Facing, type World } from './world'
import type { FurnitureType } from './catalog'

export type Mode = 'rest' | 'wait'

/** A place to go to: a tile, how to stand there and what the bot is doing (for the tooltip). */
export type Stop = { x: number; y: number; facing: Facing; pose: 'stand' | 'sofa' | 'wait' | RestPose; doing: string }

/** What a resting bot may visit, by the thing it goes to look at. */
const REST_THINGS: Partial<Record<FurnitureType, string>> = {
  'coffee-machine': 'у кофемашины',
  'water-cooler': 'у кулера',
  aquarium: 'смотрит на рыбок',
  bookshelf: 'у книжного шкафа',
  fridge: 'заглянул в холодильник',
  microwave: 'греет обед в микроволновке',
  window: 'смотрит в окно'
}
/** Shared rooms only: nobody strolls into someone's office or the team room. */
const SHARED = new Set(['lounge', 'reception', 'corridor'])

const key = (p: { x: number; y: number }) => `${p.x},${p.y}`

/** The stops of a building: rest stops in shared rooms, wait stops in the reception by the owner's door. */
export function stopsOf(world: World): { rest: Stop[]; wait: Stop[]; home: Map<string, Stop[]> } {
  const rooms = new Map(world.rooms.map((r) => [r.id, r]))
  const seats = new Set(world.desks.map((d) => key(d.seat)))
  const free = (x: number, y: number) => walkable(world, x, y) && world.tiles[y * world.width + x] === 'floor' && !seats.has(`${x},${y}`)
  const rest: Stop[] = []
  const seen = new Set<string>()
  const add = (list: Stop[], stop: Stop) => {
    if (seen.has(key(stop))) return
    seen.add(key(stop))
    list.push(stop)
  }
  for (const item of world.furniture) {
    const doing = REST_THINGS[item.type]
    if (!doing || !SHARED.has(rooms.get(item.room)?.kind ?? '')) continue
    const x = item.x + Math.floor((item.w - 1) / 2)
    const y = item.type === 'window' ? item.y + 1 : item.y + item.h
    if (free(x, y)) add(rest, { x, y, facing: 'up', pose: 'stand', doing })
  }
  for (const spot of world.spots) {
    if (spot.kind === 'kitchen') add(rest, { x: spot.x, y: spot.y, facing: spot.facing, pose: 'stand', doing: 'на кухне' })
    if (spot.kind === 'sofa') add(rest, { x: spot.x, y: spot.y, facing: 'down', pose: 'sofa', doing: 'сидит на диване' })
  }
  // Waiting: the reception tiles not far from the owner's door, and the aquarium there.
  const wait: Stop[] = []
  const door = world.doors.find((d) => d.owner)
  const reception = world.rooms.find((r) => r.kind === 'reception')
  seen.clear()
  if (door && reception) {
    for (const spot of world.spots.filter((s) => s.kind === 'owner-wait')) add(wait, { x: spot.x, y: spot.y, facing: 'up', pose: 'wait', doing: 'ждёт у двери CEO' })
    for (let y = reception.y + 1; y < reception.y + reception.h - 1; y += 1) {
      for (let x = reception.x + 1; x < reception.x + reception.w - 1; x += 1) {
        const far = Math.abs(x - door.x) + Math.abs(y - door.y)
        if (far > 7 || !free(x, y)) continue
        add(wait, { x, y, facing: far > 3 ? 'left' : 'up', pose: 'wait', doing: 'ходит по приёмной с табличкой' })
      }
    }
    for (const item of world.furniture) {
      if (item.type !== 'aquarium' || item.room !== reception.id) continue
      const s = { x: item.x, y: item.y + item.h }
      if (free(s.x, s.y)) wait.push({ ...s, facing: 'up', pose: 'wait', doing: 'ждёт и смотрит на рыбок' })
    }
  }
  return { rest, wait, home: homeStops(world, free) }
}

/**
 * Resting in one's own office (a `clevel` room with its desk): in the chair with the phone,
 * rocking, feet up; watering a plant there, looking out of its window, kicking a ball about.
 */
function homeStops(world: World, free: (x: number, y: number) => boolean): Map<string, Stop[]> {
  const out = new Map<string, Stop[]>()
  for (const room of world.rooms.filter((r) => r.kind === 'clevel')) {
    const desk = world.desks.find((d) => d.room === room.id)
    if (!desk) continue
    const list: Stop[] = [
      { ...desk.seat, facing: 'down', pose: 'phone', doing: 'у себя в кабинете, в телефоне' },
      { ...desk.seat, facing: 'down', pose: 'rock', doing: 'у себя, качается на стуле' },
      { ...desk.seat, facing: 'down', pose: 'feet', doing: 'у себя, закинул ноги на стол' }
    ]
    const inRoom = (x: number, y: number) => world.roomAt[y * world.width + x] === room.id && free(x, y)
    for (const f of world.furniture.filter((i) => i.room === room.id)) {
      if (f.type === 'plant' || f.type === 'big-plant' || f.type === 'flowers') {
        // Stand beside it, the can towards it.
        if (inRoom(f.x - 1, f.y)) list.push({ x: f.x - 1, y: f.y, facing: 'right', pose: 'water', doing: 'у себя, поливает цветок' })
        else if (inRoom(f.x + 1, f.y)) list.push({ x: f.x + 1, y: f.y, facing: 'left', pose: 'water', doing: 'у себя, поливает цветок' })
      }
      if (f.type === 'window') {
        const x = f.x + Math.floor((f.w - 1) / 2)
        if (inRoom(x, f.y + 1)) list.push({ x, y: f.y + 1, facing: 'up', pose: 'window', doing: 'у себя, смотрит в окно' })
      }
    }
    // A ball in the middle of the room: a free tile with free tiles around.
    const cx = room.x + Math.floor(room.w / 2)
    const cy = room.y + Math.floor(room.h / 2) + 2
    for (const [x, y] of [[cx, cy], [cx - 1, cy], [cx + 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
      if (inRoom(x, y) && inRoom(x - 1, y) && inRoom(x + 1, y)) {
        list.push({ x, y, facing: 'down', pose: 'ball', doing: 'у себя, пинает мяч' })
        break
      }
    }
    out.set(room.id, list)
  }
  return out
}

/** A small seeded random (mulberry32), so a test can replay the same day. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Which routine a real status allows, from the target the status table gave. */
export function modeFor(base: Target): Mode | null {
  if (base.place === 'owner-wait') return 'wait'
  // A failed last turn is an event: the bot stays put under its red «!».
  if ((base.place === 'sofa' || base.place === 'kitchen') && base.bubble === null) return 'rest'
  return null
}

/** `home`: resting in one's own office, else strolling about the shared rooms. */
type Routine = { mode: Mode; base: string; stop: Stop | null; next: number; home: boolean }

/** Seconds: how long a bot stays at a stop (min, max), by mode. */
const DWELL: Record<Mode, [number, number]> = { rest: [8, 24], wait: [3, 9] }
/** How long a letter keeps a bot at its real place before the routine goes on. */
export const EVENT_HOLD_MS = 20_000

export class Life {
  private readonly routines = new Map<string, Routine>()
  private readonly stops: { rest: Stop[]; wait: Stop[]; home: Map<string, Stop[]> }
  private readonly random: () => number

  constructor(world: World, random: () => number = Math.random) {
    this.stops = stopsOf(world)
    this.random = random
  }

  private dwell(mode: Mode): number {
    const [a, b] = DWELL[mode]
    return (a + (b - a) * this.random()) * 1000
  }

  /** A real event for this bot (a letter): back to its real place, the routine waits a while. */
  interrupt(key: string, now: number, hold = EVENT_HOLD_MS): void {
    const r = this.routines.get(key)
    if (!r) return
    // Reading a letter: stay at this stop; the routine goes on right after.
    if (hold < EVENT_HOLD_MS) r.next = Math.max(r.next, now + hold)
    else {
      r.stop = null
      r.next = now + hold
    }
  }

  /** The earliest moment a routine moves on (Infinity when none): the tab re-plans only then. */
  nextAt(): number {
    let at = Infinity
    for (const r of this.routines.values()) at = Math.min(at, r.next)
    return at
  }

  /** Where the other resting bots are now (their stop, else their real place). */
  private positions(base: ReadonlyMap<string, Target>, except: string): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = []
    for (const [k, r] of this.routines) {
      if (k === except || r.mode !== 'rest') continue
      const t = r.stop ?? base.get(k)
      if (t) out.push({ x: t.x, y: t.y })
    }
    return out
  }

  /** Who is on a routine now and in which mode. */
  modeOf(key: string): Mode | null {
    return this.routines.get(key)?.mode ?? null
  }

  /**
   * The targets to walk to: the real ones, except that bots on a routine may be at one of its stops.
   * A bot whose real place changed (status, Needs you, a failed turn) drops its routine at once.
   */
  plan(base: ReadonlyMap<string, Target>, now: number, homes: ReadonlyMap<string, string> = new Map()): Map<string, Target> {
    const out = new Map(base)
    for (const k of [...this.routines.keys()]) if (!base.has(k)) this.routines.delete(k)
    // Nobody picks a tile someone else's real place or current stop is on.
    const taken = new Map<string, string>()
    for (const [k, t] of base) taken.set(key(t), k)
    for (const [k, r] of this.routines) if (r.stop) taken.set(key(r.stop), k)
    const free = (s: Stop, who: string) => !taken.has(key(s)) || taken.get(key(s)) === who
    for (const [k, t] of [...base].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const mode = modeFor(t)
      if (!mode) {
        this.routines.delete(k)
        continue
      }
      const id = `${mode}|${t.place}|${t.slot}|${t.bubble ?? ''}`
      let r = this.routines.get(k)
      if (!r || r.base !== id) {
        // New real place: go there first, look around a little, then start the routine.
        // A free bot picks: rest in its own office (if it has one) or stroll about the office.
        const own = mode === 'rest' && (this.stops.home.get(homes.get(k) ?? '')?.length ?? 0) > 0
        r = { mode, base: id, stop: null, next: now + this.dwell(mode) / 2, home: own && this.random() < 0.5 }
        this.routines.set(k, r)
      }
      if (now >= r.next) {
        const before = r.stop
        const homeList = this.stops.home.get(homes.get(k) ?? '') ?? []
        // Now and then it changes its mind: home ⇄ about the office.
        if (mode === 'rest' && homeList.length && this.random() < 0.2) r.home = !r.home
        if (!homeList.length) r.home = false
        const source = r.home ? homeList : this.stops[mode]
        const list = source.filter((s) => (r!.home || free(s, k)) && key(s) !== key(t) && (!before || key(s) !== key(before) || s.pose !== before.pose))
        // Now and then back to the real place; else a new stop.
        const home = r.stop !== null && !r.home && this.random() < (mode === 'wait' ? 0.4 : 0.25)
        if (before) taken.delete(key(before))
        // They hang out: half the time a resting bot goes next to another resting one.
        const others = mode === 'rest' && !r.home ? this.positions(base, k) : []
        const near = list.filter((s) => others.some((o) => Math.abs(o.x - s.x) + Math.abs(o.y - s.y) <= 2))
        const pool = near.length && this.random() < 0.5 ? near : list
        r.stop = home || pool.length === 0 ? null : pool[Math.floor(this.random() * pool.length)]
        const far = r.stop ? Math.abs(r.stop.x - t.x) + Math.abs(r.stop.y - t.y) : 4
        r.next = now + (far / 6) * 1000 + this.dwell(mode)
      }
      if (r.stop) {
        taken.set(key(r.stop), k)
        out.set(k, { ...t, x: r.stop.x, y: r.stop.y, facing: r.stop.facing, pose: r.stop.pose, doing: r.stop.doing, routine: mode })
      } else {
        out.set(k, { ...t, routine: mode })
      }
    }
    return out
  }
}

// ── Chat clouds: icons over bots that rest together ──────────────────────────────────────

export const CHAT_ICONS = ['coffee', 'talk', 'dots', 'laugh', 'chart', 'fish'] as const
export type ChatIcon = (typeof CHAT_ICONS)[number]
/** One cloud turn: who speaks changes every CHAT_TURN_MS. */
export const CHAT_TURN_MS = 2600

function mix(...values: number[]): number {
  let h = 2166136261
  for (const v of values) h = Math.imul(h ^ (v | 0), 16777619)
  h ^= h >>> 13
  return Math.imul(h, 2246822507) >>> 0
}

function textHash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * Bots resting (not walking) within two tiles of each other form a group; in each group one at a
 * time «says» an icon in a cloud, taking turns. Pure decoration: no words, nothing from Orca.
 */
export function chatClouds(bots: readonly { key: string; x: number; y: number; resting: boolean }[], now: number): Map<string, ChatIcon> {
  const idle = bots.filter((b) => b.resting).sort((a, b) => (a.key < b.key ? -1 : 1))
  const group = new Map<string, number>()
  let groups = 0
  for (const b of idle) {
    if (group.has(b.key)) continue
    const members = [b]
    group.set(b.key, groups)
    for (let i = 0; i < members.length; i += 1) {
      for (const o of idle) {
        if (group.has(o.key)) continue
        if (Math.abs(o.x - members[i].x) + Math.abs(o.y - members[i].y) <= 2.01) {
          group.set(o.key, groups)
          members.push(o)
        }
      }
    }
    groups += 1
  }
  const out = new Map<string, ChatIcon>()
  for (let g = 0; g < groups; g += 1) {
    const members = idle.filter((b) => group.get(b.key) === g)
    if (members.length < 2) continue
    const id = textHash(members.map((m) => m.key).join('|'))
    const turn = Math.floor(now / CHAT_TURN_MS)
    // A short pause between lines: the last fifth of a turn shows no cloud.
    if (now % CHAT_TURN_MS > CHAT_TURN_MS * 0.8) continue
    const speaker = members[(turn + id) % members.length]
    out.set(speaker.key, CHAT_ICONS[mix(id, turn) % CHAT_ICONS.length])
  }
  return out
}
