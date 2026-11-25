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

/** A bot's own place: the desk of an office (`clevel` room). */
export function isBotPlace(desk: DeskSeat): boolean {
  return desk.roomKind === 'clevel'
}

export type BotSeating = {
  seats: Map<string, DeskSeat | null>
  /** What to store under BOT_SEATS_KEY: the place each bot took (bots not here now keep theirs). */
  memory: Record<string, string>
}

/**
 * A desk per bot key, in this order:
 * 1. the owner's pin (two pins on one desk: the first key wins, the other goes on);
 * 2. the place the bot took before (`memory`), if it is an office and still free;
 * 3. a free office, chosen with `random` (bots in key order), then remembered;
 * 4. no office left: the first free desk of a team room; none either: null (the bot stands).
 */
export function assignBotSeats(
  keys: readonly string[],
  desks: readonly DeskSeat[],
  pins: Readonly<Record<string, string>>,
  memory: Readonly<Record<string, string>>,
  random: () => number = Math.random
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
    if (seats.has(key)) continue
    const before = byId.get(memory[key] ?? '')
    if (before && isBotPlace(before)) take(key, before)
  }
  const places = desks.filter(isBotPlace)
  for (const key of sorted) {
    if (seats.has(key)) continue
    const free = places.filter((desk) => !taken.has(desk.id))
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
