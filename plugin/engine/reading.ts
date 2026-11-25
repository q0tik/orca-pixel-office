// Letters go to the bot, not to its empty desk: an envelope starts where the sender stands at the
// moment it is sent and flies to where the recipient is now, following it if it walks. When it
// lands, the recipient stops and «reads» for READ_MS (a bot at its desk keeps sitting, the
// envelope over its head); then its routine or its work goes on. Decoration of a real event: the
// letter itself comes from Orca's inbox, its text is never read.
import type { Target } from './locations'
import type { World } from './world'

export const READ_MS = 3_000

export type Pt = { x: number; y: number }

/**
 * Where an end of a mail is (art pixels): the bot (or worker) itself wherever it stands, else its
 * desk, else the entrance. `actor` is the figure's position in tiles (fractional while walking).
 */
export function mailPoint(actor: Pt | null, seat: Pt | null, entrance: Pt | null, kind: 'bot' | 'intern' | 'outside'): Pt {
  if (kind !== 'outside') {
    if (actor) return { x: actor.x * 16 + 8, y: actor.y * 16 }
    if (seat) return { x: seat.x * 16 + 16, y: seat.y * 16 }
  }
  return entrance ? { x: entrance.x * 16 + 8, y: entrance.y * 16 + 8 } : { x: 0, y: 0 }
}

/**
 * The owner's end of a mail (the CEO's office): the CEO's desk, its chair left empty (the owner is
 * never drawn); without a desk, the owner's door; else the middle of the owner's room.
 */
export function ownerPoint(world: Pick<World, 'furniture' | 'doors' | 'rooms'>): Pt | null {
  const desk = world.furniture.find((f) => f.type === 'ceo-desk')
  if (desk) return { x: (desk.x + 1.5) * 16, y: (desk.y + 1) * 16 }
  const door = world.doors.find((d) => d.owner)
  if (door) return { x: door.x * 16 + 8, y: door.y * 16 + 8 }
  const room = world.rooms.find((r) => r.kind === 'owner')
  return room ? { x: (room.x + room.w / 2) * 16, y: (room.y + room.h / 2) * 16 } : null
}

/** Who is reading a letter now, and until when. */
export class Reading {
  private readonly until = new Map<string, number>()

  /** A letter landed with this bot. */
  start(key: string, now: number): void {
    this.until.set(key, now + READ_MS)
  }

  isReading(key: string, now: number): boolean {
    const t = this.until.get(key)
    return t !== undefined && now < t
  }

  /**
   * The earliest moment someone stops reading (Infinity when nobody reads). A finished reader stays
   * due until `apply` re-plans it, so the tab knows it must send that bot on.
   */
  nextAt(_now?: number): number {
    let at = Infinity
    for (const t of this.until.values()) at = Math.min(at, t)
    return at
  }

  /**
   * Targets with the readers stopped where they are: a bot sitting at its desk keeps sitting (an
   * envelope over its head); anyone else stands on the tile it is on, the letter in its hands.
   */
  apply(targets: ReadonlyMap<string, Target>, actors: ReadonlyMap<string, { x: number; y: number; walking: boolean; target: Target }>, now: number): Map<string, Target> {
    const out = new Map(targets)
    for (const [k, t] of [...this.until]) if (t <= now) this.until.delete(k)
    for (const [key, t] of targets) {
      if (!this.isReading(key, now)) continue
      const a = actors.get(key)
      if (!a) continue
      const seated = !a.walking && a.target.pose === 'type' && a.x === t.x && a.y === t.y
      if (seated || (!a.walking && a.x === t.x && a.y === t.y && t.pose === 'sofa')) out.set(key, { ...t, reading: true })
      else out.set(key, { ...t, x: Math.round(a.x), y: Math.round(a.y), facing: 'down', pose: 'read', reading: true, doing: 'читает письмо' })
    }
    return out
  }
}
