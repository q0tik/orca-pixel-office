// The bots as figures on the map: where each one stands, the walk it is on, and which frame of
// which pose to draw. A figure walks only when its target changes, that is, when Orca reported a
// new state (or the bot got a new desk); on the first sight it simply appears in place.
import { findPath, type Point } from './path'
import type { Target } from './locations'
import type { Facing, World } from './world'

/** Poses whose picture moves at rest (engine/life.ts, engine/reading.ts). */
const MOVING: ReadonlySet<string> = new Set(['phone', 'rock', 'feet', 'water', 'ball', 'read'])

/** Tiles a walking bot covers per animation tick (≈ 6 tiles a second at 12 Hz). */
export const WALK_SPEED = 0.5

export type Actor = {
  key: string
  /** The tile it stands on, or walks from. */
  x: number
  y: number
  /** 0..1 of the way to `path[0]`. */
  progress: number
  path: Point[]
  facing: Facing
  target: Target
  /** Tiles walked so far, for the walk cycle. */
  walked: number
}

export type ActorView = {
  key: string
  /** Position in tiles, fractional while walking. */
  x: number
  y: number
  facing: Facing
  walking: boolean
  /** Walk cycle frame 0..3 while walking. */
  walkFrame: number
  target: Target
}

function facingOf(from: Point, to: Point): Facing {
  if (to.x > from.x) return 'right'
  if (to.x < from.x) return 'left'
  return to.y < from.y ? 'up' : 'down'
}

export class Cast {
  readonly actors = new Map<string, Actor>()
  /** Animation ticks so far: typing and bubble frames are read from it. */
  ticks = 0

  /**
   * Takes the planned targets. New figures appear on their target (or at `spawn`, walking in); a
   * figure whose target moved gets a BFS path there (or jumps, if the map gives no way). With
   * `snap`, everyone is put on their target at once: the state the tab opened with is not news.
   * Returns whether anything changed.
   */
  sync(world: World, targets: ReadonlyMap<string, Target>, options: { snap?: boolean; spawn?: (key: string) => Point | null } = {}): boolean {
    let changed = false
    for (const key of [...this.actors.keys()]) {
      if (!targets.has(key)) {
        this.actors.delete(key)
        changed = true
      }
    }
    for (const [key, target] of targets) {
      const actor = this.actors.get(key)
      if (!actor) {
        const from = options.snap ? null : options.spawn?.(key) ?? null
        const path = from ? findPath(world, from, target) : null
        if (from && path && path.length) {
          this.actors.set(key, { key, x: from.x, y: from.y, progress: 0, path, facing: target.facing, target, walked: 0 })
        } else {
          this.actors.set(key, { key, x: target.x, y: target.y, progress: 0, path: [], facing: target.facing, target, walked: 0 })
        }
        changed = true
        continue
      }
      if (options.snap) {
        if (actor.x !== target.x || actor.y !== target.y || actor.path.length || actor.target !== target) changed = true
        Object.assign(actor, { x: target.x, y: target.y, progress: 0, path: [], facing: target.facing, target })
        continue
      }
      const same = actor.target.x === target.x && actor.target.y === target.y
      if (same) {
        if (actor.target.pose !== target.pose || actor.target.bubble !== target.bubble || actor.target.facing !== target.facing) changed = true
        actor.target = target
        if (actor.path.length === 0) actor.facing = target.facing
        continue
      }
      actor.target = target
      changed = true
      // Mid-step: finish the step first, then go on from that tile.
      const from = actor.path.length && actor.progress > 0 ? actor.path[0] : { x: actor.x, y: actor.y }
      const rest = findPath(world, from, target)
      if (rest === null) {
        actor.x = target.x
        actor.y = target.y
        actor.path = []
        actor.progress = 0
        actor.facing = target.facing
        continue
      }
      actor.path = actor.path.length && actor.progress > 0 ? [actor.path[0], ...rest] : rest
      if (actor.path.length === 0) actor.facing = target.facing
    }
    return changed
  }

  /** One animation tick. Returns whether the picture changed. */
  tick(): boolean {
    this.ticks += 1
    let changed = false
    for (const actor of this.actors.values()) {
      if (actor.path.length === 0) continue
      changed = true
      let budget = WALK_SPEED
      while (budget > 0 && actor.path.length) {
        const next = actor.path[0]
        actor.facing = facingOf(actor, next)
        const step = Math.min(budget, 1 - actor.progress)
        actor.progress += step
        actor.walked += step
        budget -= step
        if (actor.progress >= 1 - 1e-9) {
          actor.x = next.x
          actor.y = next.y
          actor.progress = 0
          actor.path.shift()
        }
      }
      if (actor.path.length === 0) actor.facing = actor.target.facing
    }
    // Typing hands move at 4 Hz, a waiting bubble bobs at 2 Hz.
    if (this.ticks % 3 === 0 && this.someone((a) => a.path.length === 0 && a.target.pose === 'type' && !a.target.still)) changed = true
    if (this.ticks % 6 === 0 && this.someone((a) => a.path.length === 0 && a.target.bubble !== null)) changed = true
    if (this.ticks % 3 === 0 && this.someone((a) => a.path.length === 0 && MOVING.has(a.target.pose))) changed = true
    return changed
  }

  private someone(test: (actor: Actor) => boolean): boolean {
    for (const actor of this.actors.values()) if (test(actor)) return true
    return false
  }

  /** Whether the timer must keep running: someone walks, types or waits with a bubble. */
  animating(): boolean {
    return this.someone((actor) => actor.path.length > 0 || (actor.target.pose === 'type' && !actor.target.still) || actor.target.bubble !== null || MOVING.has(actor.target.pose))
  }

  walking(): number {
    let count = 0
    for (const actor of this.actors.values()) if (actor.path.length) count += 1
    return count
  }

  views(): ActorView[] {
    return [...this.actors.values()].map((actor) => {
      const next = actor.path[0]
      const x = next ? actor.x + (next.x - actor.x) * actor.progress : actor.x
      const y = next ? actor.y + (next.y - actor.y) * actor.progress : actor.y
      return {
        key: actor.key,
        x,
        y,
        facing: actor.facing,
        walking: actor.path.length > 0,
        walkFrame: Math.floor(actor.walked * 2) % 4,
        target: actor.target
      }
    })
  }

  /** 0/1: which typing frame is shown now. */
  typingFrame(): number {
    return Math.floor(this.ticks / 3) % 2
  }

  /** 0..3: the frame of resting poses (phone, rocking, a ball, reading). */
  restFrame(): number {
    return Math.floor(this.ticks / 3) % 4
  }

  /** 0/1: the waiting bubble's bob. */
  bobFrame(): number {
    return Math.floor(this.ticks / 6) % 2
  }
}
