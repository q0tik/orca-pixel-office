// «Локация = статус»: the one table that says where a bot goes for each real Orca state, and the
// planner that turns it into a tile per bot. Nothing here invents activity: a bot moves only
// when its state (or its desk) changes.
import type { DeskState } from '../src/bots'
import { nearestFree, type Point } from './path'
import type { DeskSeat, Facing, Spot, World } from './world'
import type { SpotKind } from './catalog'

export type Place = 'desk' | SpotKind
/** How the bot looks once it got there. */
export type Pose = 'type' | 'wait' | 'sofa' | 'stand' | 'read' | RestPose
/** Resting in one's own office: in the chair or about the room (engine/life.ts). */
export type RestPose = 'phone' | 'rock' | 'feet' | 'water' | 'ball' | 'window'
/**
 * What hangs over a bot: `blocked` and `failed` a red «!», `waiting` a yellow «!», `needs` an
 * orange «?» (items in Needs you).
 */
export type Bubble = 'blocked' | 'failed' | 'waiting' | 'needs' | null

export function bubbleGlyph(bubble: Exclude<Bubble, null>): '!' | '?' {
  return bubble === 'needs' ? '?' : '!'
}

export type PlaceRule = {
  /** Where to go, then the fallbacks when there is no such place (or it is full). */
  places: readonly Place[]
  bubble: Bubble
  /** Short Russian label for the tooltip, the panel and the legend. */
  label: string
}

/**
 * Orca gives four agent states per chat (`agents.list`, `agent.status.changed`); a bot whose
 * chats are all gone is `idle`. Orca does not say whom a waiting agent waits for: `blocked`
 * is a permission/approval prompt and `waiting` is a question or a request for input, both
 * answered by the person at the keyboard, so both go to the owner's door. A bot waiting on
 * another bot is not something Orca reports, so it is not drawn.
 */
export const STATUS_PLACE: Record<DeskState, PlaceRule> = {
  working: { places: ['desk', 'standby'], bubble: null, label: 'работает' },
  blocked: { places: ['owner-wait'], bubble: 'blocked', label: 'ждёт разрешения овнера' },
  waiting: { places: ['owner-wait'], bubble: 'waiting', label: 'ждёт ответа овнера' },
  done: { places: ['sofa', 'kitchen', 'standby'], bubble: null, label: 'закончил' },
  idle: { places: ['kitchen', 'sofa', 'standby'], bubble: null, label: 'нет активных чатов' }
}

/** Not working, nothing blocked, but items wait for the owner: to the door with «?». */
export const NEEDS_YOU_PLACE: PlaceRule = { places: ['owner-wait'], bubble: 'needs', label: 'ждёт овнера: items в Needs you' }

export type BotSignals = {
  /** Items in Needs you (`orca bot item list`), 0 when none or unknown. */
  needsYou?: number
  /** The last turn of one of its chats ended with `outcome: failure`. */
  failed?: boolean
}

/**
 * The priority table, in this order:
 * 1. `working` → own desk, no sign (a new turn clears an earlier failure);
 * 2. `blocked` / `waiting` → the owner's door with «!» (red / yellow);
 * 3. items in Needs you → the owner's door with «?» (a failed last turn shows a red «!» instead);
 * 4. `done` / `idle` → the lounge; a failed last turn shows a red «!» over the bot there.
 */
export function ruleFor(state: DeskState, signals: BotSignals = {}): PlaceRule {
  const base = STATUS_PLACE[state] ?? STATUS_PLACE.idle
  if (state === 'working' || state === 'blocked' || state === 'waiting') return base
  const failed = signals.failed === true
  const label = failed ? `${base.label} · последний ход с ошибкой` : base.label
  if ((signals.needsYou ?? 0) > 0) {
    return { places: NEEDS_YOU_PLACE.places, bubble: failed ? 'failed' : 'needs', label: failed ? `${NEEDS_YOU_PLACE.label} · последний ход с ошибкой` : NEEDS_YOU_PLACE.label }
  }
  return failed ? { ...base, bubble: 'failed', label } : base
}

export type Target = {
  place: Place
  x: number
  y: number
  facing: Facing
  pose: Pose
  bubble: Bubble
  /** The spot index within its kind (so a bot keeps its sofa seat while others come and go). */
  slot: string
  /** Sits without typing (a finished worker at its desk). */
  still?: boolean
  /** «Жизнь»: the routine the bot is on, and what it is doing at this stop (tooltip). */
  routine?: 'rest' | 'wait'
  doing?: string
  /** A letter just landed: the bot holds it (or it hangs over its head at the desk). */
  reading?: boolean
}

export type PlanBot = { key: string; state: DeskState; desk: DeskSeat | null } & BotSignals

const POSE: Record<Place, Pose> = { desk: 'type', 'owner-wait': 'wait', sofa: 'sofa', kitchen: 'stand', standby: 'stand', entrance: 'stand' }

/**
 * A target tile per bot. A bot whose place kind did not change keeps its previous slot; the
 * others take the first free slot of their place, in key order. When every slot of every
 * allowed place is full, the bot stands on the nearest free floor tile next to the first one.
 */
export function planTargets(world: World, bots: readonly PlanBot[], previous: ReadonlyMap<string, Target> = new Map()): Map<string, Target> {
  const out = new Map<string, Target>()
  const takenSlots = new Set<string>()
  const takenTiles = new Set<string>()
  const spotsOf = (kind: SpotKind) => world.spots.filter((spot) => spot.kind === kind)
  const sorted = [...bots].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

  const want = (bot: PlanBot): Place[] => ruleFor(bot.state, bot).places.filter((place) => place !== 'desk' || bot.desk !== null)

  const commit = (bot: PlanBot, target: Target) => {
    out.set(bot.key, target)
    takenSlots.add(target.slot)
    takenTiles.add(`${target.x},${target.y}`)
  }

  const deskTarget = (bot: PlanBot): Target => {
    const desk = bot.desk!
    return {
      place: 'desk',
      x: desk.seat.x,
      y: desk.seat.y,
      facing: desk.facing,
      pose: 'type',
      bubble: ruleFor(bot.state, bot).bubble,
      slot: `desk:${desk.id}`
    }
  }

  const spotTarget = (bot: PlanBot, place: SpotKind, spot: Spot, index: number): Target => ({
    place,
    x: spot.x,
    y: spot.y,
    facing: spot.facing,
    pose: POSE[place],
    bubble: ruleFor(bot.state, bot).bubble,
    slot: `${place}:${index}`
  })

  // Desks are personal; then everyone who keeps the same place keeps the same slot.
  const pending: PlanBot[] = []
  for (const bot of sorted) {
    const places = want(bot)
    if (places[0] === 'desk') {
      commit(bot, deskTarget(bot))
      continue
    }
    const before = previous.get(bot.key)
    if (before && before.place === places[0] && !takenSlots.has(before.slot) && !takenTiles.has(`${before.x},${before.y}`)) {
      commit(bot, { ...before, bubble: ruleFor(bot.state, bot).bubble })
      continue
    }
    pending.push(bot)
  }
  for (const bot of pending) {
    let placed = false
    for (const place of want(bot)) {
      if (place === 'desk') continue
      const spots = spotsOf(place)
      const index = spots.findIndex((spot, i) => !takenSlots.has(`${place}:${i}`) && !takenTiles.has(`${spot.x},${spot.y}`))
      if (index >= 0) {
        commit(bot, spotTarget(bot, place, spots[index], index))
        placed = true
        break
      }
    }
    if (placed) continue
    // Overflow: next to the first place of the rule that exists at all.
    const place = want(bot).find((p) => p !== 'desk' && spotsOf(p as SpotKind).length > 0) as SpotKind | undefined
    const anchor: Point | undefined = place ? spotsOf(place)[0] : world.spots[0]
    const free = anchor ? nearestFree(world, anchor, takenTiles) : null
    if (free) {
      commit(bot, {
        place: place ?? 'standby',
        x: free.x,
        y: free.y,
        facing: place === 'owner-wait' ? 'up' : 'down',
        pose: place === 'owner-wait' ? 'wait' : 'stand',
        bubble: ruleFor(bot.state, bot).bubble,
        slot: `overflow:${bot.key}`
      })
    }
  }
  return out
}

/** One sheet on a working bot's paper stack for every PAPER_MINUTES of work in a row, up to MAX_SHEETS. */
export const PAPER_MINUTES = 4
export const MAX_SHEETS = 12
export function paperSheets(since: number | null, now: number): number {
  if (since === null) return 0
  return Math.min(MAX_SHEETS, 1 + Math.floor(Math.max(0, now - since) / (PAPER_MINUTES * 60_000)))
}

/** The notice board in the hall: bots that stand at the owner's door now, and bots at work. */
export function noticeCounts(bots: readonly ({ state: DeskState } & BotSignals)[]): { waiting: number; working: number } {
  return {
    waiting: bots.filter((bot) => ruleFor(bot.state, bot).places[0] === 'owner-wait').length,
    working: bots.filter((bot) => bot.state === 'working').length
  }
}
