// Who sits where. There is no seating config: until the owner pins someone, a bot takes a free
// place (a desk in a room of kind `clevel`: the C-level offices and the mini office in the
// reception) at random, once, and keeps it: the choice is kept in the plugin storage, so the bot
// does not hop on every open. The owner's pins, made in the office itself and also kept in the
// storage, always win. Workers sit at the desks of «Команды и отделы» (engine/workers.ts); the
// owner may pin them to a desk there too.
import type { DeskSeat } from './world'

/** Storage keys: the owner's pins, and the places bots took by themselves. */
export const PINS_KEY = 'pins'
export const BOT_SEATS_KEY = 'botSeats'

export type PinKind = 'bots' | 'workers'
/** Bot key or worker id → desk id (`<room>.<desk>`). */
export type Pins = { bots: Record<string, string>; workers: Record<string, string> }

export const emptyPins = (): Pins => ({ bots: {}, workers: {} })

/** Keeps a plain { key: deskId } object, drops everything else. */
export function parseDeskMap(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === 'string' && v) out[k] = v
  return out
}

/** A stored pins object, field by field; anything wrong reads as «no pins». */
export function parsePins(raw: unknown): Pins {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return emptyPins()
  const r = raw as Record<string, unknown>
  return { bots: parseDeskMap(r.bots), workers: parseDeskMap(r.workers) }
}

export function serializePins(pins: Pins): { v: 1; bots: Record<string, string>; workers: Record<string, string> } {
  return { v: 1, bots: { ...pins.bots }, workers: { ...pins.workers } }
}

/** A bot's own place: the desk of an office (`clevel`) or a place in a specialists' room (`specialists`). */
export function isBotPlace(desk: Pick<DeskSeat, 'roomKind'>): boolean {
  return desk.roomKind === 'clevel' || desk.roomKind === 'specialists'
}

/**
 * The label of a room with bots' places. An office: its name and who sits there (📌 when pinned), or
 * «свободен». A specialists' room: its name and the names of those sitting there, or how many places
 * are free. From afar only the names.
 */
export function placesLabel(
  room: { label: string; kind: string },
  places: readonly { name: string | null; pinned: boolean }[],
  close: boolean
): string | null {
  const names = places.filter((p) => p.name).map((p) => `${p.name}${p.pinned ? ' 📌' : ''}`)
  if (room.kind !== 'specialists') {
    if (!close) return names[0] ?? null
    return names.length ? `${room.label} · ${names[0]}` : `${room.label} · свободен`
  }
  if (!close) return names.length ? names.join(', ') : null
  return names.length ? `${room.label} · ${names.join(', ')}` : `${room.label} · свободно мест: ${places.length}`
}

export type BotSeating = {
  seats: Map<string, DeskSeat | null>
  /** What to store under BOT_SEATS_KEY: the place each bot took (bots not here now keep theirs). */
  memory: Record<string, string>
}

/** Roles compare without case and spaces round them: «QA», «qa». */
const sameRole = (a: string | null | undefined, b: string | null | undefined): boolean => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()

/** May a bot with `role` sit at `desk` without a pin: the desk is for no role, or for its own. */
const fitsRole = (desk: DeskSeat, role: string | undefined): boolean => !desk.role || sameRole(desk.role, role)

/**
 * A desk per bot key, in this order:
 * 1. the owner's pin (two pins on one desk: the first key wins, the other goes on): it beats everything;
 * 2. a free place the map gives the bot's role (`roles[key]`, from its «[QA]» prefix: a desk's `role` or
 *    its room's `forRole`): it beats the place the bot took by itself before;
 * 3. the place the bot took before (`memory`), if it is a bot's place, still free and not another role's;
 * 4. a free office, else a free place in a specialists' room, chosen with `random` (bots in key order),
 *    then remembered; places for another role are left to it;
 * 5. none left: the first free desk of a team room; none either: null (the bot stands).
 */
export function assignBotSeats(
  keys: readonly string[],
  desks: readonly DeskSeat[],
  pins: Readonly<Record<string, string>>,
  memory: Readonly<Record<string, string>>,
  random: () => number = Math.random,
  roles: Readonly<Record<string, string>> = {}
): BotSeating {
  const byId = new Map(desks.map((desk) => [desk.id, desk]))
  const sorted = [...new Set(keys)].sort()
  const taken = new Set<string>()
  const seats = new Map<string, DeskSeat | null>()
  const take = (key: string, desk: DeskSeat | undefined): boolean => {
    if (!desk || taken.has(desk.id)) return false
    taken.add(desk.id)
    seats.set(key, desk)
    return true
  }
  for (const key of sorted) take(key, byId.get(pins[key] ?? ''))
  for (const key of sorted) {
    if (seats.has(key) || !roles[key]) continue
    take(key, desks.find((desk) => sameRole(desk.role, roles[key]) && !taken.has(desk.id)))
  }
  for (const key of sorted) {
    if (seats.has(key)) continue
    const before = byId.get(memory[key] ?? '')
    if (before && isBotPlace(before) && fitsRole(before, roles[key])) take(key, before)
  }
  // Offices first; with no office free, a place in a specialists' room; then a desk of a team room.
  const offices = desks.filter((desk) => desk.roomKind === 'clevel')
  const benches = desks.filter((desk) => desk.roomKind === 'specialists')
  for (const key of sorted) {
    if (seats.has(key)) continue
    const open = (desk: DeskSeat) => !taken.has(desk.id) && fitsRole(desk, roles[key])
    const freeOffices = offices.filter(open)
    const free = freeOffices.length ? freeOffices : benches.filter(open)
    if (free.length) {
      const i = Math.min(free.length - 1, Math.max(0, Math.floor(random() * free.length)))
      take(key, free[i])
      continue
    }
    if (!take(key, desks.find((desk) => desk.roomKind === 'team' && !taken.has(desk.id)))) seats.set(key, null)
  }
  const next: Record<string, string> = {}
  const held = new Set<string>()
  for (const [key, desk] of seats) {
    if (desk && isBotPlace(desk)) {
      next[key] = desk.id
      held.add(desk.id)
    }
  }
  // Bots not in the office now keep their place in memory, unless someone else sits there.
  for (const [key, id] of Object.entries(memory)) if (!seats.has(key) && !held.has(id) && byId.has(id)) next[key] = id
  return { seats, memory: next }
}

/** Who sits at a desk now, by the current seats (who → desk id). */
export function occupantOf(deskId: string, seats: ReadonlyMap<string, string | null>, except?: string): string | null {
  for (const [who, id] of seats) if (id === deskId && who !== except) return who
  return null
}

/** One pin per desk: pins `who` to `deskId` and drops any other pin of that kind on that desk. */
export function pin(pins: Pins, kind: PinKind, who: string, deskId: string): Pins {
  const next = { bots: { ...pins.bots }, workers: { ...pins.workers } }
  for (const [other, id] of Object.entries(next[kind])) if (id === deskId && other !== who) delete next[kind][other]
  next[kind][who] = deskId
  return next
}

/**
 * Swap places: `who` gets `deskId`, the bot (or worker) sitting there gets `who`'s desk `from`,
 * pinned too. With no `from` (`who` had no desk), the other one goes back to the automatic seating.
 */
export function swap(pins: Pins, kind: PinKind, who: string, deskId: string, occupant: string, from: string | null): Pins {
  let next = pin(pins, kind, who, deskId)
  if (from && from !== deskId) next = pin(next, kind, occupant, from)
  else delete next[kind][occupant]
  return next
}

/** «Открепить»: back to the automatic seating (the bot keeps its place while it is free). */
export function unpin(pins: Pins, kind: PinKind, who: string): Pins {
  const next = { bots: { ...pins.bots }, workers: { ...pins.workers } }
  delete next[kind][who]
  return next
}
