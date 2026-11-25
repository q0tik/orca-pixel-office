// What real events look like in the office, as a pure model the renderer reads: an envelope that
// flies from the sender to the recipient, a line between them that fades out over ten minutes,
// and interns that pop in when a worker starts, turn pale when it finishes and fade out when it is
// released. Every effect is started by real data (src/mail.ts, workers from the CLI); nothing
// here starts by itself. Time is passed in, so tests drive it.

export const ENVELOPE_BASE_MS = 1_200
export const ENVELOPE_PER_PX_MS = 3
export const ENVELOPE_MAX_MS = 3_500
/** A line between two bots that wrote to each other fades out over this long. */
export const LINE_FADE_MS = 10 * 60_000
export const INTERN_FADE_MS = 700
/** A finished worker's intern is drawn this pale. */
export const PALE_ALPHA = 0.4

export type Pt = { x: number; y: number }

/** An end of a mail: a stable reference the renderer turns into a point each frame. */
export type EndRef = string

/** `fromPt`: where the sender stood when it sent it (the envelope leaves from there, not from a desk). */
export type Envelope = { id: string; type: string; from: EndRef; to: EndRef; start: number; duration: number; fromPt?: Pt }
export type Link = { key: string; a: EndRef; b: EndRef; type: string; last: number; /** The message that last lit it. */ entryId: string }

type InternMark = { born: number | null; gone: number | null; key: string; color: string; live: boolean }

export function envelopeDuration(from: Pt, to: Pt): number {
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  return Math.min(ENVELOPE_MAX_MS, ENVELOPE_BASE_MS + distance * ENVELOPE_PER_PX_MS)
}

/** Where an envelope is at `now`: along the straight line, lifted in an arc; null once landed. */
export function envelopeAt(env: Envelope, fromNow: Pt, to: Pt, now: number): Pt | null {
  const from = env.fromPt ?? fromNow
  const t = (now - env.start) / env.duration
  if (t < 0 || t >= 1) return null
  const lift = Math.sin(Math.PI * t) * Math.min(40, 8 + Math.hypot(to.x - from.x, to.y - from.y) / 8)
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t - lift }
}

/** 1 right after the last message between the two, 0 after LINE_FADE_MS. */
export function linkAlpha(link: Link, now: number): number {
  const age = now - link.last
  if (age < 0) return 1
  return Math.max(0, 1 - age / LINE_FADE_MS)
}

export const linkKey = (a: EndRef, b: EndRef) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export class Effects {
  envelopes: Envelope[] = []
  readonly links = new Map<string, Link>()
  private readonly interns = new Map<string, InternMark>()
  private internsSeen = false

  /**
   * A real message. `animate` is false for mail older than the tab (it only lights the line).
   * Mail to oneself (both ends the same place) draws nothing.
   */
  addMail(entry: { id: string; type: string; at: number | null }, from: EndRef, to: EndRef, fromPt: Pt, toPt: Pt, now: number, animate: boolean): void {
    if (from === to || entry.at === null) return
    const key = linkKey(from, to)
    const before = this.links.get(key)
    if (!before || before.last < entry.at) this.links.set(key, { key, a: from, b: to, type: entry.type, last: entry.at, entryId: entry.id })
    if (animate && !this.envelopes.some((e) => e.id === entry.id)) {
      this.envelopes.push({ id: entry.id, type: entry.type, from, to, start: now, duration: envelopeDuration(fromPt, toPt), fromPt })
    }
  }

  /**
   * The workers the CLI lists now, per intern id. The first call only records them (no pop-in for
   * workers that were already there); later, new ids pop in and missing ones fade out.
   */
  syncInterns(current: ReadonlyMap<string, { key: string; color: string; live: boolean }>, now: number): void {
    for (const [id, info] of current) {
      const mark = this.interns.get(id)
      if (!mark || mark.gone !== null) this.interns.set(id, { born: this.internsSeen ? now : null, gone: null, ...info })
      else Object.assign(mark, info)
    }
    for (const [id, mark] of this.interns) if (!current.has(id) && mark.gone === null) mark.gone = now
    this.internsSeen = true
  }

  /** How to draw an intern now: null when it is gone; `dy` lifts it while it pops in. */
  internLook(id: string, now: number): { alpha: number; dy: number; key: string; color: string; live: boolean } | null {
    const mark = this.interns.get(id)
    if (!mark) return null
    const base = mark.live ? 1 : PALE_ALPHA
    if (mark.gone !== null) {
      const t = (now - mark.gone) / INTERN_FADE_MS
      return t >= 1 ? null : { alpha: base * (1 - t), dy: 0, key: mark.key, color: mark.color, live: mark.live }
    }
    if (mark.born !== null && now - mark.born < INTERN_FADE_MS) {
      const t = Math.max(0, (now - mark.born) / INTERN_FADE_MS)
      return { alpha: base * t, dy: -Math.round((1 - t) * 8), key: mark.key, color: mark.color, live: mark.live }
    }
    return { alpha: base, dy: 0, key: mark.key, color: mark.color, live: mark.live }
  }

  /** Interns to draw for a bot, in a stable order: the ones that exist, then the fading ones. */
  internsOf(key: string): string[] {
    const out: string[] = []
    for (const [id, mark] of this.interns) if (mark.key === key) out.push(id)
    // Live workers first (so a new one is never hidden behind «+N»), then finished, then fading out.
    const rank = (id: string) => {
      const mark = this.interns.get(id)!
      return mark.gone !== null ? 2 : mark.live ? 0 : 1
    }
    return out.sort((a, b) => rank(a) - rank(b))
  }

  /** Envelopes that landed since the last call: their recipients start reading. */
  landed(now: number): Envelope[] {
    const out = this.envelopes.filter((e) => now - e.start >= e.duration && !this.delivered.has(e.id))
    for (const e of out) this.delivered.add(e.id)
    return out
  }
  private readonly delivered = new Set<string>()

  /** Drops what finished: landed envelopes, faded lines, gone interns. */
  prune(now: number): void {
    for (const e of this.envelopes) if (now - e.start >= e.duration && !this.delivered.has(e.id)) return this.pruneRest(now)
    this.envelopes = this.envelopes.filter((e) => now - e.start < e.duration)
    this.pruneRest(now)
  }

  private pruneRest(now: number): void {
    for (const [key, link] of this.links) if (linkAlpha(link, now) <= 0) this.links.delete(key)
    for (const [id, mark] of this.interns) if (mark.gone !== null && now - mark.gone >= INTERN_FADE_MS) this.interns.delete(id)
  }

  /** Whether the 12 Hz timer is needed: an envelope flies or an intern pops in or fades out. */
  animating(now: number): boolean {
    if (this.envelopes.some((e) => now - e.start < e.duration)) return true
    for (const mark of this.interns.values()) {
      if (mark.gone !== null && now - mark.gone < INTERN_FADE_MS) return true
      if (mark.born !== null && now - mark.born < INTERN_FADE_MS) return true
    }
    return false
  }
}
