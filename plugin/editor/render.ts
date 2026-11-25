// Draws one frame of the office on a 2D canvas. The building (floors, walls, doors, things on
// walls, rugs) is baked once into 16×16-tile chunk bitmaps and only the chunks in view are copied;
// furniture and bots are cached sprites sorted by depth, skipped when out of view. Labels are text
// at screen resolution. No timers here: main.ts decides when a frame is needed.
import type { ActorView } from '../engine/actors'
import { origin, visibleRect, type Camera, type Viewport } from '../engine/camera'
import { bubbleGlyph, type Bubble } from '../engine/locations'
import { CHUNK_TILES, intersects, visibleChunks } from '../engine/scheduler'
import type { DeskState } from '../src/bots'
import type { PlacedFurniture, World } from '../engine/world'
import { FURNITURE, type FloorKind, type WallStyle } from '../engine/catalog'
import {
  BUBBLE_H,
  BUBBLE_W,
  CHAR_H,
  CHAR_W,
  FURNITURE_HEADROOM,
  T,
  drawBubble,
  drawCharacter,
  drawDeskChair,
  drawDoor,
  drawFloor,
  drawFurniture,
  drawWall,
  drawWallItem,
  drawCloud,
  drawPlacard,
  CHAIR_POSES,
  MOVING_POSES,
  CLOUD_H,
  CLOUD_W,
  PLACARD_H,
  PLACARD_W,
  drawClockHands,
  drawNoticeNumbers,
  ANIMATED,
  drawEnvelope,
  drawFlag,
  drawIntern,
  ENVELOPE_H,
  ENVELOPE_W,
  FLAG_H,
  FLAG_W,
  INTERN_H,
  INTERN_W,
  lookFor,
  type Look,
  type CharPose,
  type Paint
} from './art'
import { P } from './palette'
import { drawSprite, withPalette, type SkinVariant } from './skins'
import { framesOf, legendColor, type AnimalPose, type AnimalView, type Species } from '../engine/animals'

/** Where an animal's sprite is (art pixels): centred on its tile, standing on its bottom, lifted by `dy`. */
export function animalBox(v: Pick<AnimalView, 'x' | 'y' | 'dy'>, sp: Pick<Species, 'w' | 'h'>): { x: number; y: number; w: number; h: number } {
  return { x: Math.round(v.x * T + 8 - sp.w / 2), y: Math.round((v.y + 1) * T - 1 - sp.h + v.dy), w: sp.w, h: sp.h }
}

/**
 * Where an animal sorts among furniture and people: on the floor just under a bot on the same row; lifted onto
 * something (a sofa, a pet bed, a desk) over the thing it sits on; on a shoulder over the bot it rides.
 */
export function animalBaseline(v: Pick<AnimalView, 'y' | 'dy'> & { over?: string }, actorBaseline: ReadonlyMap<string, number>): number {
  if (v.over) return (actorBaseline.get(v.over) ?? 0) + 0.2
  return (v.y + 1) * T + (v.dy < 0 ? 0.3 : -0.3)
}

/** One frame of an animal in a coat; the sprites face right and are mirrored to face left. */
export function drawAnimal(p: Paint, sp: Species, coatId: string, pose: AnimalPose, frame: number, facing: 'left' | 'right'): void {
  const coat = sp.coats.find((c) => c.id === coatId) ?? sp.coats[0]
  const frames = framesOf(sp, pose)
  const rows = frames[frame % frames.length]
  rows.forEach((row, y) => {
    let x = 0
    for (const ch of row) {
      const value = sp.sprites.legend[ch]
      const color = value ? legendColor(value, coat, P as unknown as Record<string, unknown>) : null
      if (color) p(facing === 'left' ? sp.w - 1 - x : x, y, 1, 1, color)
      x += 1
    }
  })
}

/** The owner's «Оформление» choices, resolved to variants (editor/skins.ts). */
export type DecorLookup = {
  room(room: string, part: 'floor' | 'wall'): SkinVariant | null
  item(item: Pick<PlacedFurniture, 'room' | 'type' | 'x' | 'y'>): SkinVariant | null
}

export type Canvas = HTMLCanvasElement | OffscreenCanvas
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export type BotLabel = { name: string; state: DeskState; /** Items in Needs you, from the bot's items. */ needsYou?: number }

/** A bot's live workers, drawn as small figures by its desk. */
export type InternGroup = {
  key: string
  seat: { x: number; y: number }
  /** `alpha` < 1: a finished worker (pale) or one popping in / fading out; `dy` lifts it while it pops in. */
  list: readonly { id: string; color: string; alpha: number; dy: number; /** The parent's shirt: whose they are. */ shirt?: string }[]
}

/** Mail colour by Orca message type. */
export function mailColor(type: string): string {
  switch (type) {
    case 'handoff':
      return P.mailHandoff
    case 'question':
      return P.mailQuestion
    case 'status':
      return P.mailStatus
    case 'worker_done':
      return P.mailDone
    case 'escalation':
      return P.mailEscalation
    default:
      return P.mailOther
  }
}

export type LinkView = { a: { x: number; y: number }; b: { x: number; y: number }; alpha: number; color: string; /** A worker and its bot (solid), not mail (dashed). */ solid?: boolean }
export type EnvelopeView = { x: number; y: number; color: string }

export const MAX_INTERNS = 3

/** Where a desk's interns stand (art pixels, top-left): in the row below its chair; the rest is «+N». */
export function internSlots(seat: { x: number; y: number }, count: number): { slots: { x: number; y: number }[]; more: number } {
  const shown = Math.min(MAX_INTERNS, Math.max(0, count))
  const slots = Array.from({ length: shown }, (_, i) => ({ x: seat.x * T + 3 + i * (INTERN_W + 1), y: (seat.y + 1) * T + T - INTERN_H }))
  return { slots, more: Math.max(0, count - MAX_INTERNS) }
}

export type FrameState = {
  camera: Camera
  view: Viewport
  actors: readonly ActorView[]
  labels: ReadonlyMap<string, BotLabel>
  /** Desk id → whether someone sits there, whether their screen is on, and its paper stack. */
  desks: ReadonlyMap<string, { occupied: boolean; on: boolean; papers?: number }>
  typingFrame: number
  bobFrame: number
  /** Frames 0..3 of resting poses (phone, rocking, a ball…) and of reading. */
  restFrame?: number
  /** CSS → device pixels, for text sizes. */
  dpr: number
  hover: string | null
  /** The bot whose panel is open. */
  selected?: string | null
  interns?: readonly InternGroup[]
  /** Lines between ends that wrote to each other (art pixels), fading. */
  links?: readonly LinkView[]
  /** Envelopes in flight (art pixels, centre). */
  envelopes?: readonly EnvelopeView[]
  /** A tone over the office (evening, night) and whether working desks light their lamps. */
  daylight?: { tint: { color: string; alpha: number } | null; lamps: boolean }
  /** A «?» at the entrance: some mail end could not be placed. */
  entranceMark?: { x: number; y: number } | null
  /** Figures drawn see-through (finished workers), by actor key. */
  alphas?: ReadonlyMap<string, number>
  /** The ambient frame (server LEDs, fish, steam, the cat); 0 keeps them still. */
  ambientFrame?: number
  /** The owner's clock, for the hands of the wall clocks. */
  clock?: { hours: number; minutes: number }
  /** The notice board in the hall: bots waiting for the owner, and those at work (real numbers). */
  notice?: { waiting: number; working: number }
  /** The office animals (engine/animals.ts), drawn from their species' sprites. */
  animals?: readonly AnimalView[]
  /** «Жизнь»: bots waiting for the owner hold up a sign instead of the bubble. */
  placards?: ReadonlyMap<string, { glyph: '!' | '?'; color: string }>
  /** «Жизнь»: an icon cloud over a resting bot that «talks» to those next to it. */
  clouds?: ReadonlyMap<string, string>
  /** Room labels to show instead of the map's (an office with its occupant). */
  roomLabels?: ReadonlyMap<string, string>
  /** While pinning: places to pick (tiles), outlined in their colour. */
  highlights?: readonly { x: number; y: number; w: number; h: number; color: string; label?: string }[]
  /** Desk plates: the text a bot's look puts on its desk (art pixels of the chair tile). */
  plates?: readonly { seat: { x: number; y: number }; text: string; kind?: 'plate' | 'counter' | 'worker'; color?: string }[]
}

/** Theme choices the renderer applies to the building (colours come through `P`). */
export type RenderTheme = { floors: Partial<Record<FloorKind, FloorKind>>; rug?: string; plant?: string }

type Drawable =
  | { kind: 'furniture'; item: PlacedFurniture; baseline: number; box: Box }
  | { kind: 'chair'; deskId: string; facing: 'up' | 'down'; x: number; y: number; baseline: number; box: Box }
  | { kind: 'actor'; actor: ActorView; baseline: number; box: Box }
  | { kind: 'intern'; id: string; color: string; alpha: number; x: number; y: number; baseline: number; box: Box; shirt?: string }
  | { kind: 'animal'; view: AnimalView; x: number; y: number; baseline: number; box: Box }

type Box = { x: number; y: number; w: number; h: number }

/** The colour of each sign over a bot (engine/locations.ts says which one). */
export const BUBBLE_COLOR: Record<Exclude<Bubble, null>, string> = {
  blocked: P.blocked,
  failed: P.blocked,
  waiting: P.waiting,
  needs: P.needsYou
}

export const STATE_COLOR: Record<DeskState, string> = {
  working: P.working,
  waiting: P.waiting,
  blocked: P.blocked,
  done: P.done,
  idle: P.idle
}

/** Where a bot's sprite box sits (art pixels) for its position and pose. */
export function actorBox(actor: ActorView): Box & { pose: CharPose } {
  const px = Math.round(actor.x * T)
  const py = Math.round(actor.y * T)
  const settled = !actor.walking
  const pose: CharPose = actor.walking ? 'walk' : (actor.target.pose as CharPose)
  if (settled && CHAIR_POSES.has(pose)) {
    // Turned round in the office chair: centred on the desk, on the chair's tile.
    return { x: px + 8, y: py + 16 - CHAR_H, w: CHAR_W, h: CHAR_H, pose }
  }
  if (settled && pose === 'type') {
    // At a desk: centred on the two-tile desk, sunk into it.
    const bottom = actor.target.facing === 'up' ? py + 10 : py + 20
    return { x: px + 8, y: bottom - CHAR_H, w: CHAR_W, h: CHAR_H, pose }
  }
  if (settled && pose === 'sofa') return { x: px, y: py + 14 - CHAR_H, w: CHAR_W, h: CHAR_H, pose }
  return { x: px, y: py + 15 - CHAR_H, w: CHAR_W, h: CHAR_H, pose }
}

export class Renderer {
  private readonly chunks = new Map<string, Canvas>()
  private wallStyleCache: Map<string, WallStyle> | null = null
  private get wallStyles(): Map<string, WallStyle> {
    this.wallStyleCache ??= new Map(this.world.rooms.map((room) => [room.id, room.wall]))
    return this.wallStyleCache
  }
  private readonly sprites = new Map<string, Canvas>()
  private theme: RenderTheme = { floors: {} }
  /** A bot's look (its appearance); the default comes from its key. */
  private looks: (key: string) => Look = lookFor

  /** New colours or floors: every cached bitmap is redrawn on next sight. */
  resetCaches(): void {
    this.chunks.clear()
    this.sprites.clear()
  }

  setTheme(theme: RenderTheme): void {
    this.theme = theme
    this.resetCaches()
  }

  private decor: DecorLookup | null = null
  private species = new Map<string, Species>()

  /** The animal species (office/animals); their sprites are cached like any other. */
  setSpecies(list: readonly Species[]): void {
    this.species = new Map(list.map((s) => [s.id, s]))
    this.sprites.clear()
  }

  /** The animal under a world point (art pixels), the front-most one first. */
  hitAnimal(animals: readonly AnimalView[], wx: number, wy: number): string | null {
    let best: { id: string; y: number } | null = null
    for (const v of animals) {
      const sp = this.species.get(v.species)
      if (!sp) continue
      const b = animalBox(v, sp)
      if (wx < b.x || wx >= b.x + b.w || wy < b.y || wy >= b.y + b.h) continue
      if (!best || v.y > best.y) best = { id: v.id, y: v.y }
    }
    return best?.id ?? null
  }

  /** New «Оформление» choices: every cached bitmap is redrawn on next sight. */
  setDecor(decor: DecorLookup | null): void {
    this.decor = decor
    this.resetCaches()
  }

  /** A floor tile of a room, in the owner's choice of floor if there is one. */
  private paintFloor(p: Paint, room: string | null, kind: FloorKind, tx: number, ty: number): void {
    const skin = room ? this.decor?.room(room, 'floor') : null
    if (!skin) return drawFloor(p, this.floorOf(kind), tx, ty)
    if (skin.sprite) return drawSprite(p, skin.sprite, 0, T)
    withPalette(skin.palette, () => drawFloor(p, (skin.base as FloorKind | undefined) ?? kind, tx, ty))
  }

  setLooks(looks: (key: string) => Look): void {
    this.looks = looks
  }
  private readonly drawables: Drawable[] = []
  /** Wall items drawn live over the baked wall: clocks and the notice board. */
  private readonly wallLive: PlacedFurniture[]
  private readonly pixelWidth: number
  private readonly pixelHeight: number

  constructor(
    readonly world: World,
    private readonly makeCanvas: (w: number, h: number) => Canvas
  ) {
    this.pixelWidth = world.width * T
    this.pixelHeight = world.height * T
    this.wallLive = world.furniture.filter((item) => item.type === 'clock' || item.type === 'notice-board')
    for (const item of world.furniture) {
      if (item.type === 'rug' || isWallItem(item)) continue
      this.drawables.push({
        kind: 'furniture',
        item,
        baseline: (item.y + item.h) * T,
        box: { x: item.x * T, y: item.y * T - FURNITURE_HEADROOM, w: item.w * T, h: item.h * T + FURNITURE_HEADROOM }
      })
    }
    for (const desk of world.desks) {
      this.drawables.push({
        kind: 'chair',
        deskId: desk.id,
        facing: desk.facing,
        x: desk.seat.x * T + 8,
        y: desk.seat.y * T,
        baseline: (desk.seat.y + 1) * T - 0.5,
        box: { x: desk.seat.x * T + 8, y: desk.seat.y * T, w: T, h: T }
      })
    }
  }

  get size(): { width: number; height: number } {
    return { width: this.pixelWidth, height: this.pixelHeight }
  }

  /** How many chunk bitmaps exist (tests and the debug line: chunks are made lazily, in view only). */
  get chunkCount(): number {
    return this.chunks.size
  }

  draw(ctx: Ctx2D, frame: FrameState): void {
    const { camera, view } = frame
    const z = camera.zoom
    const o = origin(camera, view)
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = P.void
    ctx.fillRect(0, 0, view.width, view.height)

    const rect = visibleRect(camera, view)
    const size = CHUNK_TILES * T
    for (const { cx, cy } of visibleChunks(rect, this.world, T)) {
      const chunk = this.chunk(cx, cy)
      ctx.drawImage(chunk, o.x + cx * size * z, o.y + cy * size * z, chunk.width * z, chunk.height * z)
    }

    const blitAt = (sprite: Canvas, x: number, y: number) => ctx.drawImage(sprite, o.x + x * z, o.y + y * z, sprite.width * z, sprite.height * z)
    // Live things on the walls: clock hands (real time) and the notice board (real numbers).
    for (const item of this.wallLive) {
      const box = { x: item.x * T, y: item.y * T, w: item.w * T, h: T }
      if (!intersects(box, rect)) continue
      if (item.type === 'clock' && frame.clock) {
        const { hours, minutes } = frame.clock
        blitAt(this.sprite(`h|${hours % 12}|${minutes}`, T, T, (p) => drawClockHands(p, hours, minutes)), box.x, box.y)
      } else if (item.type === 'notice-board' && frame.notice) {
        const { waiting, working } = frame.notice
        blitAt(this.sprite(`n|${waiting}|${working}`, item.w * T, T, (p) => drawNoticeNumbers(p, waiting, working)), box.x, box.y)
      }
    }

    const list: Drawable[] = this.drawables.filter((d) => intersects(d.box, rect))
    const actorBaseline = new Map<string, number>()
    for (const actor of frame.actors) actorBaseline.set(actor.key, (actor.y + 1) * T)
    for (const view of frame.animals ?? []) {
      const sp = this.species.get(view.species)
      if (!sp) continue
      const box = animalBox(view, sp)
      if (!intersects(box, rect)) continue
      const baseline = animalBaseline(view, actorBaseline)
      list.push({ kind: 'animal', view, x: box.x, y: box.y, baseline, box })
    }
    for (const actor of frame.actors) {
      const box = actorBox(actor)
      if (!intersects(box, rect)) continue
      list.push({ kind: 'actor', actor, baseline: (actor.y + 1) * T, box })
    }
    const extraLabels: { text: string; x: number; y: number }[] = []
    for (const group of frame.interns ?? []) {
      const { slots, more } = internSlots(group.seat, group.list.length)
      slots.forEach((slot, i) => {
        const box = { x: slot.x, y: slot.y, w: INTERN_W, h: INTERN_H }
        const it = group.list[i]
        if (intersects(box, rect)) list.push({ kind: 'intern', id: it.id, color: it.color, alpha: it.alpha, x: slot.x, y: slot.y + it.dy, baseline: (group.seat.y + 2) * T - 0.25, box, shirt: it.shirt })
      })
      if (more > 0 && slots.length) {
        const last = slots[slots.length - 1]
        extraLabels.push({ text: `+${more}`, x: last.x + INTERN_W + 2, y: last.y + INTERN_H / 2 })
      }
    }
    list.sort((a, b) => a.baseline - b.baseline)
    const blit = (sprite: Canvas, x: number, y: number) => ctx.drawImage(sprite, o.x + x * z, o.y + y * z, sprite.width * z, sprite.height * z)

    const ambient = frame.ambientFrame ?? 0
    for (const d of list) {
      if (d.kind === 'furniture') {
        const desk = d.item.id ? frame.desks.get(d.item.id) : undefined
        blit(this.furnitureSprite(d.item, !!desk?.on, desk?.papers ?? 0, ANIMATED.has(d.item.type) ? ambient : 0), d.box.x, d.box.y)
      } else if (d.kind === 'animal') {
        const v = d.view
        const sp = this.species.get(v.species)!
        blit(this.sprite(`an|${v.species}|${v.coat}|${v.pose}|${v.frame}|${v.facing}`, sp.w, sp.h, (p) => drawAnimal(p, sp, v.coat, v.pose, v.frame, v.facing)), d.x, d.y)
      } else if (d.kind === 'chair') {
        const desk = frame.desks.get(d.deskId)
        blit(this.chairSprite(d.deskId, d.facing, !!desk?.occupied), d.x, d.y)
      } else if (d.kind === 'intern') {
        ctx.globalAlpha = d.alpha
        const look = d.shirt ? { ...lookFor(d.id), shirt: d.shirt } : lookFor(d.id)
        blit(this.sprite(`i|${d.id}|${d.color}|${d.shirt ?? ''}`, INTERN_W, INTERN_H, (p) => drawIntern(p, look, d.color)), d.x, d.y)
        ctx.globalAlpha = 1
      } else {
        const a = d.actor
        const box = actorBox(a)
        const frameNo = box.pose === 'walk' ? a.walkFrame : box.pose === 'type' && !a.target.still ? frame.typingFrame : MOVING_POSES.has(box.pose) ? frame.restFrame ?? 0 : 0
        const alpha = frame.alphas?.get(a.key) ?? 1
        if (alpha < 1) ctx.globalAlpha = alpha
        blit(this.characterSprite(a.key, box.pose, a.facing, frameNo), box.x, box.y)
        ctx.globalAlpha = 1
      }
    }

    // Lines between those who wrote to each other, then letters in flight.
    if (frame.links?.length) {
      ctx.save()
      ctx.lineWidth = Math.max(2, Math.round(z * 0.75))
      ctx.setLineDash([4 * z, 2 * z])
      for (const link of frame.links) {
        ctx.setLineDash(link.solid ? [] : [4 * z, 2 * z])
        ctx.globalAlpha = 0.25 + 0.7 * link.alpha
        ctx.strokeStyle = link.color
        ctx.beginPath()
        ctx.moveTo(o.x + link.a.x * z, o.y + link.a.y * z)
        ctx.lineTo(o.x + link.b.x * z, o.y + link.b.y * z)
        ctx.stroke()
      }
      ctx.restore()
    }
    for (const env of frame.envelopes ?? []) {
      blit(this.sprite(`e|${env.color}`, ENVELOPE_W, ENVELOPE_H, (p) => drawEnvelope(p, env.color)), Math.round(env.x - ENVELOPE_W / 2), Math.round(env.y - ENVELOPE_H / 2))
    }

    if (frame.entranceMark) {
      blit(this.bubbleSprite('?', P.idle), Math.round(frame.entranceMark.x - BUBBLE_W / 2), Math.round(frame.entranceMark.y - BUBBLE_H - 6))
    }

    // Evening and night: a tone over the office, then the lamps of those at work.
    const daylight = frame.daylight
    if (daylight?.tint) {
      ctx.save()
      ctx.globalAlpha = daylight.tint.alpha
      ctx.fillStyle = daylight.tint.color
      ctx.fillRect(0, 0, view.width, view.height)
      ctx.restore()
    }
    if (daylight?.lamps && 'createRadialGradient' in ctx) {
      const lamps: { x: number; y: number }[] = []
      for (const d of list) {
        if (d.kind === 'furniture' && d.item.type === 'ceo-desk') lamps.push({ x: (d.item.x + 2.6) * T, y: (d.item.y + 1) * T })
        if (d.kind === 'furniture' && d.item.type === 'desk' && d.item.id && frame.desks.get(d.item.id)?.on) lamps.push({ x: (d.item.x + 1) * T, y: d.item.y * T })
      }
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (const lamp of lamps) {
        const cx = o.x + lamp.x * z
        const cy = o.y + lamp.y * z
        const r = 28 * z
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
        glow.addColorStop(0, 'rgba(255, 196, 110, 0.35)')
        glow.addColorStop(1, 'rgba(255, 196, 110, 0)')
        ctx.fillStyle = glow
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
      }
      ctx.restore()
    }

    // Bubbles over everything, then the text.
    const heads: { actor: ActorView; box: Box }[] = []
    for (const d of list) if (d.kind === 'actor') heads.push({ actor: d.actor, box: d.box })
    for (const { actor, box } of heads) {
      const label = frame.labels.get(actor.key)
      const bubble = actor.target.bubble
      const placard = frame.placards?.get(actor.key)
      if (placard && label) {
        // Held up in the raised hand; while walking, over the head.
        const px = actor.walking ? box.x + Math.floor((CHAR_W - PLACARD_W) / 2) : box.x + 6
        const py = actor.walking ? box.y - PLACARD_H + 6 : box.y + 5 - PLACARD_H
        blit(this.sprite(`pl|${placard.glyph}|${placard.color}`, PLACARD_W, PLACARD_H, (p) => drawPlacard(p, placard.glyph, placard.color)), px, py - frame.bobFrame)
        continue
      }
      // Reading at the desk or on the sofa: the letter over the head.
      if (actor.target.reading && actor.target.pose !== 'read' && !actor.walking) {
        blit(this.sprite(`e|${P.mailHandoff}`, ENVELOPE_W, ENVELOPE_H, (p) => drawEnvelope(p, P.mailHandoff)), box.x + Math.floor((CHAR_W - ENVELOPE_W) / 2), box.y - ENVELOPE_H - 1 - frame.bobFrame)
        continue
      }
      if (!bubble || actor.walking || !label) continue
      const sprite = this.bubbleSprite(bubbleGlyph(bubble), BUBBLE_COLOR[bubble])
      blit(sprite, box.x + Math.floor((CHAR_W - BUBBLE_W) / 2) + 1, box.y - BUBBLE_H + 1 - frame.bobFrame)
    }
    // The Needs-you flag next to the head.
    for (const { actor, box } of heads) {
      if (!frame.labels.get(actor.key)?.needsYou) continue
      blit(this.sprite("flag", FLAG_W, FLAG_H, drawFlag), box.x + CHAR_W - 1, box.y + 5)
    }
    if (extraLabels.length) {
      ctx.font = `bold ${Math.round(9 * frame.dpr)}px ui-monospace, "SF Mono", Menlo, monospace`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = P.tagText
      for (const label of extraLabels) ctx.fillText(label.text, o.x + label.x * frame.camera.zoom, o.y + label.y * frame.camera.zoom)
    }
    // Picking a place to pin someone to: the candidates, outlined.
    if (frame.highlights?.length) {
      ctx.save()
      ctx.lineWidth = Math.max(2, Math.round(z / 2))
      ctx.setLineDash([3 * z, 2 * z])
      for (const h of frame.highlights) {
        ctx.strokeStyle = h.color
        ctx.globalAlpha = 0.18
        ctx.fillStyle = h.color
        ctx.fillRect(o.x + h.x * T * z, o.y + h.y * T * z, h.w * T * z, h.h * T * z)
        ctx.globalAlpha = 1
        ctx.strokeRect(o.x + h.x * T * z + 1, o.y + h.y * T * z + 1, h.w * T * z - 2, h.h * T * z - 2)
      }
      ctx.restore()
    }
    this.drawPlates(ctx, frame, o, rect)
    this.drawRoomLabels(ctx, frame, o, rect)
    this.drawNoticeCaptions(ctx, frame, o, rect)
    this.drawTags(ctx, frame, heads, o)
    // Chat clouds of resting bots, over their name tags, to the side of the head.
    for (const { actor, box } of heads) {
      const icon = frame.clouds?.get(actor.key)
      if (!icon) continue
      blit(this.sprite(`cl|${icon}`, CLOUD_W, CLOUD_H, (p) => drawCloud(p, icon)), box.x + CHAR_W - 3, box.y - CLOUD_H + 1)
    }
  }

  /** The text plate on a bot's desk front, when close enough to read. */
  private drawPlates(ctx: Ctx2D, frame: FrameState, o: { x: number; y: number }, rect: Box): void {
    const z = frame.camera.zoom
    if (!frame.plates?.length || z / frame.dpr < 1.5) return
    const fontPx = Math.round(Math.min(10, 3 * z / frame.dpr + 2) * frame.dpr)
    ctx.font = `bold ${fontPx}px ui-monospace, "SF Mono", Menlo, monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const plate of frame.plates) {
      if (!plate.text) continue
      const box = { x: plate.seat.x * T - 16, y: (plate.seat.y - 1) * T, w: 4 * T, h: 3 * T }
      if (!intersects(box, rect)) continue
      const w = ctx.measureText(plate.text).width + 6 * frame.dpr
      const h = fontPx + 4 * frame.dpr
      let left: number
      let cy: number
      let back: string = P.gold
      let ink: string = P.ink
      if (plate.kind === 'counter') {
        // By a desk, on its right: «3 сотрудника» (a bot's workers), «2 стажёра» (a worker's subagents).
        left = o.x + (plate.seat.x * T + 27) * z
        cy = o.y + (plate.seat.y * T - 5) * z
        back = P.tag
        ink = P.tagText
      } else if (plate.kind === 'worker') {
        // Under a worker's chair: its name, with its parent's colour on the left.
        const mark = h
        left = o.x + (plate.seat.x * T + 16) * z - (w + mark) / 2
        cy = o.y + (plate.seat.y * T + 19) * z
        ctx.fillStyle = plate.color ?? P.idle
        ctx.fillRect(Math.round(left), Math.round(cy - h / 2), Math.round(mark), Math.round(h))
        left += mark
        back = P.tag
        ink = P.tagText
      } else {
        // On the desk's left corner, clear of the bot sitting in the middle.
        left = o.x + (plate.seat.x * T + 7) * z - w
        cy = o.y + (plate.seat.y * T - 5) * z
      }
      ctx.fillStyle = back
      ctx.fillRect(Math.round(left), Math.round(cy - h / 2), Math.round(w), Math.round(h))
      ctx.fillStyle = ink
      ctx.fillText(plate.text, left + w / 2, cy + 0.5 * frame.dpr)
    }
  }

  private drawRoomLabels(ctx: Ctx2D, frame: FrameState, o: { x: number; y: number }, rect: Box): void {
    const z = frame.camera.zoom
    const fontPx = Math.max(9, Math.round(Math.min(13, 3 + z * 2.2) * frame.dpr) / frame.dpr) * frame.dpr
    ctx.font = `bold ${Math.round(fontPx)}px ui-monospace, "SF Mono", Menlo, monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const room of this.world.rooms) {
      const label = frame.roomLabels?.get(room.id) ?? room.label
      if (!label) continue
      const box = { x: room.x * T, y: room.y * T, w: room.w * T, h: T }
      if (!intersects(box, rect)) continue
      const cx = o.x + (room.x * T + (room.w * T) / 2) * z
      const cy = o.y + (room.y * T + 2) * z
      const width = ctx.measureText(label).width + 10 * frame.dpr
      const height = fontPx + 6 * frame.dpr
      ctx.fillStyle = P.labelBack
      ctx.fillRect(Math.round(cx - width / 2), Math.round(cy - height / 2), Math.round(width), Math.round(height))
      ctx.fillStyle = room.kind === 'owner' ? P.gold : P.labelText
      ctx.fillText(label, cx, cy + 0.5 * frame.dpr)
    }
  }

  /** Close up, the notice board says what its numbers are. */
  private drawNoticeCaptions(ctx: Ctx2D, frame: FrameState, o: { x: number; y: number }, rect: Box): void {
    const z = frame.camera.zoom
    if (!frame.notice || z / frame.dpr < 3) return
    ctx.font = `bold ${Math.round(9 * frame.dpr)}px ui-monospace, "SF Mono", Menlo, monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    for (const item of this.wallLive) {
      if (item.type !== 'notice-board') continue
      const box = { x: item.x * T, y: item.y * T, w: item.w * T, h: T }
      if (!intersects(box, rect)) continue
      const captions: [string, number][] = [
        ['ждут тебя', 9],
        ['работают', 23]
      ]
      for (const [text, x] of captions) {
        const cx = o.x + (box.x + x) * z
        const cy = o.y + (box.y + 4) * z
        const w = ctx.measureText(text).width + 6 * frame.dpr
        ctx.fillStyle = P.labelBack
        ctx.fillRect(Math.round(cx - w / 2), Math.round(cy - 13 * frame.dpr), Math.round(w), Math.round(13 * frame.dpr))
        ctx.fillStyle = P.labelText
        ctx.fillText(text, cx, cy - 1 * frame.dpr)
      }
    }
  }

  /** Whether anything that lives (LEDs, fish, steam) is in view. */
  livesIn(rect: Box): boolean {
    return this.world.furniture.some((item) => ANIMATED.has(item.type) && intersects({ x: item.x * T, y: item.y * T - FURNITURE_HEADROOM, w: item.w * T, h: item.h * T + FURNITURE_HEADROOM }, rect))
  }

  private drawTags(ctx: Ctx2D, frame: FrameState, heads: { actor: ActorView; box: Box }[], o: { x: number; y: number }): void {
    const z = frame.camera.zoom
    const fontPx = Math.round(10 * frame.dpr)
    const dot = 6 * frame.dpr
    const pad = 4 * frame.dpr
    const height = Math.round(fontPx + 5 * frame.dpr)
    const tags: { x: number; y: number; w: number; h: number; text: string; state: DeskState; hovered: boolean; chip: string | null }[] = []
    for (const { actor, box } of heads) {
      const label = frame.labels.get(actor.key)
      if (!label) continue
      const hovered = frame.hover === actor.key || frame.selected === actor.key
      // Below one CSS pixel per art pixel the tags would cover the bots: only the hovered one then.
      if (z / frame.dpr < 1 && !hovered) continue
      ctx.font = `${hovered ? 'bold ' : ''}${fontPx}px ui-monospace, "SF Mono", Menlo, monospace`
      const chip = label.needsYou ? `⚑${label.needsYou}` : null
      const chipW = chip ? ctx.measureText(chip).width + pad * 2 : 0
      const width = Math.round(ctx.measureText(label.name).width + dot + pad * 3 + chipW)
      const lift = frame.placards?.has(actor.key) ? PLACARD_H - 4 : actor.target.bubble && !actor.walking ? BUBBLE_H : 0
      const cx = o.x + (box.x + CHAR_W / 2) * z
      tags.push({
        x: Math.round(cx - width / 2),
        y: Math.round(o.y + (box.y - lift) * z - height - 2 * frame.dpr),
        w: width,
        h: height,
        text: label.name,
        state: label.state,
        hovered,
        chip
      })
    }
    const ys = stackTags(tags, Math.round(2 * frame.dpr))
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    tags.forEach((tag, i) => {
      const top = ys[i]
      ctx.font = `${tag.hovered ? 'bold ' : ''}${fontPx}px ui-monospace, "SF Mono", Menlo, monospace`
      ctx.fillStyle = tag.hovered ? P.labelBack : P.tag
      ctx.globalAlpha = tag.hovered ? 1 : 0.85
      ctx.fillRect(tag.x, top, tag.w, tag.h)
      ctx.globalAlpha = 1
      ctx.fillStyle = STATE_COLOR[tag.state]
      ctx.fillRect(tag.x + pad, Math.round(top + (tag.h - dot) / 2), dot, dot)
      ctx.fillStyle = P.tagText
      ctx.fillText(tag.text, tag.x + pad * 2 + dot, top + tag.h / 2 + 0.5 * frame.dpr)
      if (tag.chip) {
        const chipW = ctx.measureText(tag.chip).width + pad * 2
        const cx = tag.x + tag.w - chipW
        ctx.fillStyle = P.needsYou
        ctx.fillRect(Math.round(cx), top, Math.round(chipW), tag.h)
        ctx.fillStyle = P.ink
        ctx.fillText(tag.chip, cx + pad, top + tag.h / 2 + 0.5 * frame.dpr)
      }
    })
  }

  /** The static picture of one chunk, made on first sight and kept. */
  private chunk(cx: number, cy: number): Canvas {
    const key = `${cx},${cy}`
    let canvas = this.chunks.get(key)
    if (canvas) return canvas
    const tiles = CHUNK_TILES
    const w = Math.min(tiles, this.world.width - cx * tiles) * T
    const h = Math.min(tiles, this.world.height - cy * tiles) * T
    canvas = this.makeCanvas(w, h)
    const ctx = canvas.getContext('2d') as Ctx2D
    const x0 = cx * tiles
    const y0 = cy * tiles
    const paintAt =
      (ox: number, oy: number): Paint =>
      (x, y, pw, ph, color) => {
        ctx.fillStyle = color
        ctx.fillRect(ox + x, oy + y, pw, ph)
      }
    const W = this.world.width
    const kind = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= this.world.height ? 'void' : this.world.tiles[y * W + x])
    for (let ty = y0; ty < y0 + h / T; ty += 1) {
      for (let tx = x0; tx < x0 + w / T; tx += 1) {
        const i = ty * W + tx
        const p = paintAt((tx - x0) * T, (ty - y0) * T)
        const tile = this.world.tiles[i]
        if (tile === 'floor') this.paintFloor(p, this.world.roomAt[i], this.world.floors[i]!, tx, ty)
        else if (tile === 'wall') {
          const room = kind(tx, ty + 1) === 'floor' ? this.world.roomAt[(ty + 1) * W + tx] ?? '' : ''
          const skin = room ? this.decor?.room(room, 'wall') : null
          const style = (skin?.base as WallStyle | undefined) ?? (room ? this.wallStyles.get(room) : undefined)
          withPalette(skin?.palette, () =>
            drawWall(p, kind(tx, ty + 1) === 'floor', { n: kind(tx, ty - 1) === 'floor', e: kind(tx + 1, ty) === 'floor', w: kind(tx - 1, ty) === 'floor' }, tx, style)
          )
        } else if (tile === 'door') {
          const door = this.world.doors.find((d) => d.x === tx && d.y === ty)
          // The floor that shows through: the room below (or left of) the doorway.
          const fi = door?.orientation === 'v' ? ty * W + tx - 1 : (ty + 1) * W + tx
          this.paintFloor(p, this.world.roomAt[fi], this.world.floors[fi] ?? 'concrete', tx, ty)
          drawDoor(p, door?.orientation ?? 'h', !!door?.owner)
        } else {
          p(0, 0, T, T, P.void)
        }
      }
    }
    // Rugs and things on walls belong to the building: baked in, clipped to the chunk.
    const chunkBox = { x: x0 * T, y: y0 * T, w, h }
    for (const item of this.world.furniture) {
      if (item.type !== 'rug' && !isWallItem(item)) continue
      const box = { x: item.x * T, y: item.y * T, w: item.w * T, h: item.h * T }
      if (!intersects(box, chunkBox)) continue
      const p = paintAt(box.x - chunkBox.x, box.y - chunkBox.y)
      if (item.type === 'rug') this.paintItem(p, item, {}, 0)
      else drawWallItem(p, item)
    }
    this.chunks.set(key, canvas)
    return canvas
  }

  private sprite(key: string, w: number, h: number, paint: (p: Paint) => void): Canvas {
    let canvas = this.sprites.get(key)
    if (canvas) return canvas
    canvas = this.makeCanvas(w, h)
    const ctx = canvas.getContext('2d') as Ctx2D
    paint((x, y, pw, ph, color) => {
      ctx.fillStyle = color
      ctx.fillRect(x, y, pw, ph)
    })
    this.sprites.set(key, canvas)
    return canvas
  }

  private floorOf(kind: FloorKind): FloorKind {
    return this.theme.floors[kind] ?? kind
  }

  /** One piece of furniture in the owner's choice of look: a sprite, or a built-in picture recoloured. */
  private paintItem(p: Paint, original: PlacedFurniture, state: { screenOn?: boolean; papers?: number; frame?: number }, top: number): void {
    const skin = this.decor?.item(original) ?? null
    paintSkinnedItem(p, skin ? original : this.variantOf(original), skin, state, top)
  }

  /** The theme's furniture variants (rugs, plants) over the map's. */
  private variantOf(item: PlacedFurniture): PlacedFurniture {
    if (item.type === 'rug' && this.theme.rug) return { ...item, variant: this.theme.rug }
    if ((item.type === 'plant' || item.type === 'big-plant') && this.theme.plant) return { ...item, variant: this.theme.plant === 'cactus' ? 'cactus' : undefined }
    return item
  }

  private furnitureSprite(original: PlacedFurniture, on: boolean, papers = 0, frame = 0): Canvas {
    const item = this.variantOf(original)
    const skin = this.decor?.item(original)?.id ?? ''
    // Animated things cycle through a few dozen frames; each is cached like any sprite.
    const f = frame % 120
    const key = `f|${item.type}|${item.w}|${item.h}|${item.facing}|${item.variant ?? ''}|${skin}|${on ? 1 : 0}|${papers}|${f}`
    return this.sprite(key, item.w * T, item.h * T + FURNITURE_HEADROOM, (p) => this.paintItem(p, original, { screenOn: on, papers, frame: f }, FURNITURE_HEADROOM))
  }

  private chairSprite(deskId: string, facing: 'up' | 'down', occupied: boolean): Canvas {
    const desk = this.world.desks.find((d) => d.id === deskId)
    const skin = desk ? this.decor?.item(deskChair(desk)) ?? null : null
    return this.sprite(`c|${facing}|${occupied ? 1 : 0}|${skin?.id ?? ''}`, T, T, (p) => {
      if (skin?.sprite) return drawSprite(p, skin.sprite, Math.floor((T - skin.sprite.w) / 2), T)
      withPalette(skin?.palette, () => drawDeskChair(p, facing, occupied))
    })
  }

  private characterSprite(key: string, pose: CharPose, facing: ActorView['facing'], frame: number): Canvas {
    const look = this.looks(key)
    const id = `${look.skin}${look.hair}${look.hairStyle}${look.shirt}${look.pants}${look.accessory}`
    return this.sprite(`a|${key}|${id}|${pose}|${facing}|${frame}`, CHAR_W, CHAR_H, (p) => drawCharacter(p, look, pose, facing, frame))
  }

  private bubbleSprite(glyph: '!' | '?', color: string): Canvas {
    return this.sprite(`b|${glyph}|${color}`, BUBBLE_W, BUBBLE_H, (p) => drawBubble(p, glyph, color))
  }

  /** The bot under a world point (art pixels), the top-most one first. */
  hit(actors: readonly ActorView[], wx: number, wy: number): string | null {
    let best: { key: string; baseline: number } | null = null
    for (const actor of actors) {
      const box = actorBox(actor)
      if (wx < box.x + 2 || wx >= box.x + box.w - 2 || wy < box.y || wy >= box.y + box.h) continue
      const baseline = (actor.y + 1) * T
      if (!best || baseline > best.baseline) best = { key: actor.key, baseline }
    }
    return best?.key ?? null
  }
}

/**
 * Name tags of bots standing side by side would cover each other: each tag that overlaps one
 * already placed moves up above it. Returns the new top of every tag, in the given order.
 */
export function stackTags(tags: readonly Box[], gap: number): number[] {
  const order = tags.map((_, i) => i).sort((a, b) => tags[b].y - tags[a].y || tags[a].x - tags[b].x)
  const placed: Box[] = []
  const ys = tags.map((tag) => tag.y)
  for (const i of order) {
    const tag = { ...tags[i] }
    for (let moved = true; moved; ) {
      moved = false
      for (const other of placed) {
        if (intersects({ ...tag, h: tag.h + gap }, other) || intersects(tag, { ...other, h: other.h + gap })) {
          tag.y = other.y - tag.h - gap
          moved = true
        }
      }
    }
    placed.push(tag)
    ys[i] = tag.y
  }
  return ys
}

/** A piece of furniture in a skin (or as it is): a sprite, or the built-in picture recoloured; `top` is its headroom. */
export function paintSkinnedItem(
  p: Paint,
  original: Pick<PlacedFurniture, 'type' | 'w' | 'h' | 'facing' | 'variant'>,
  skin: SkinVariant | null,
  state: { screenOn?: boolean; papers?: number; frame?: number },
  top: number
): void {
  if (skin?.sprite) return drawSprite(p, skin.sprite, Math.floor((original.w * T - skin.sprite.w) / 2), top + original.h * T)
  const item = skin ? { ...original, variant: skin.base ?? original.variant } : original
  withPalette(skin?.palette, () => drawFurniture((x, y, w, h, c) => p(x, y + top, w, h, c), item, state))
}

/** A floor tile or a wall face in a skin, for previews. */
export function paintSkinnedTile(p: Paint, skin: SkinVariant, tx: number, ty: number): void {
  if (skin.target === 'floor') {
    if (skin.sprite) return drawSprite(p, skin.sprite, 0, T)
    return withPalette(skin.palette, () => drawFloor(p, (skin.base ?? 'wood') as FloorKind, tx, ty))
  }
  withPalette(skin.palette, () => drawWall(p, true, { n: false, e: false, w: false }, tx, (skin.base ?? 'plain') as WallStyle))
}

/** A desk's chair, as a piece of furniture «Оформление» can dress (its own key, type `chair`). */
export function deskChair(desk: { room: string; seat: { x: number; y: number }; facing: 'up' | 'down' }): PlacedFurniture {
  return { type: 'chair', room: desk.room, x: desk.seat.x, y: desk.seat.y, w: 1, h: 1, facing: desk.facing }
}

function isWallItem(item: PlacedFurniture): boolean {
  return FURNITURE[item.type].mount === 'wall'
}
