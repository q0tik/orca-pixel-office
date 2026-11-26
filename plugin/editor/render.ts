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
  glows,
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
  lookId,
  type Look,
  type CharPose,
  type FurnitureState,
  nightWindow,
  floorTone,
  type Paint
} from './art'
import { P } from './palette'
import { drawSprite, withPalette, type SkinVariant } from './skins'
import { framesOf, legendColor, type AnimalPose, type AnimalView, type Species } from '../engine/animals'
import { APPLIANCES, LIGHT_CELL, LightCache, buildLightMap, lampField, lightKey, type Darkness, type LampField, type Light, type ScreenKind } from '../engine/lights'
import { drawScreen, screenRects, SCREEN_FRAMES } from './lamps'
import { windowCover, windowOps, windowSeed, type WindowOp } from './windows'

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
  list: readonly {
    id: string
    color: string
    alpha: number
    dy: number
    /** The parent's shirt: whose they are. */
    shirt?: string
    /** The parent's key: a trainee wears its employee's character (a small fox by a fox). */
    parent?: string
  }[]
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
  /** Desk id → whether someone sits there, whether their screen is on, its paper stack and what the screen shows. */
  desks: ReadonlyMap<string, { occupied: boolean; on: boolean; papers?: number; screen?: ScreenKind }>
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
  /**
   * Evening and night (engine/lights.ts): the dark and every light shining now. The map is rebuilt
   * only when `key` changes; without it the plain `daylight.tint` is laid over the office.
   */
  lighting?: {
    /** Names the accents and the lamps' state: the still layers are built again only when it changes. */
    key: string
    /** Names the rooms' light levels: the shade is built again only when it changes (a room fading in or out). */
    shadeKey: string
    /** The even dark over a room whose light is off, and the warm tone over one whose light is on. */
    dark: Darkness
    lit: Darkness
    /** Room id → its light level now, 0 (off) to 1 (on). */
    levels: ReadonlyMap<string, number>
    /** The small accents: screens, lamps, candles, a garland (each at most two tiles across). */
    lights: readonly Light[]
  } | null
  /** Lamps, candles and signs are lit (evening, night), except those switched off in «Оформление» (item keys). `key` names this state (wall lamps baked into the walls follow it). */
  lamps?: { on: boolean; off: ReadonlySet<string>; key?: string; night?: boolean }
  /** Appliances a bot is using now (item keys): the microwave hums, the fridge stands open. */
  using?: ReadonlySet<string>
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
  | { kind: 'intern'; id: string; color: string; alpha: number; x: number; y: number; baseline: number; box: Box; shirt?: string; parent?: string }
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
    this.lightMaps.reset()
    this.shades.reset()
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
  /** Wall lamps, garlands and neon signs: drawn live (lit or not, twinkling) over the baked wall. */
  private readonly wallLights: PlacedFurniture[]
  /** Wall lamps: baked into the wall chunks, lit or not as `lampState` says. */
  private readonly wallLamps: PlacedFurniture[]
  private lampState: { on: boolean; off: ReadonlySet<string>; key: string; night: boolean } = { on: false, off: new Set(), key: '', night: false }
  /** The lamps' light field and the still shining things, rebuilt only when the lighting key changes. */
  private readonly lightMaps = new LightCache<{ field: LampField; still: Canvas; stillKeys: Set<string>; windows: NightWindow[] }>()
  /** The light map (lamps and rooms together), rebuilt only when the lamps or a room's light level change. */
  private readonly shades = new LightCache<{ canvas: Canvas; data: Uint8ClampedArray }>()

  /** How many times the light map was put together: on a change and while a room fades, never on a still frame. */
  get shadeBuilds(): number {
    return this.shades.builds
  }
  /** Scratch bitmaps (by size) for drawing a figure shaded in front of something that glows. */
  private readonly scratch = new Map<string, Canvas>()

  /** How many times the light map was built (tests and the debug line: once per change, not per frame). */
  get lightBuilds(): number {
    return this.lightMaps.builds
  }
  private readonly pixelWidth: number
  private readonly pixelHeight: number

  constructor(
    readonly world: World,
    private readonly makeCanvas: (w: number, h: number) => Canvas
  ) {
    this.pixelWidth = world.width * T
    this.pixelHeight = world.height * T
    this.wallLive = world.furniture.filter((item) => item.type === 'clock' || item.type === 'notice-board')
    // Garlands and signs move: drawn live. Wall lamps stand still: baked into the wall like a picture.
    this.wallLights = world.furniture.filter((item) => WALL_LIGHTS.has(item.type) && !STILL_GLOW.has(item.type))
    this.wallLamps = world.furniture.filter((item) => WALL_LIGHTS.has(item.type) && STILL_GLOW.has(item.type))
    for (const item of world.furniture) {
      if (item.type === 'rug' || isWallItem(item)) continue
      this.drawables.push({
        kind: 'furniture',
        item,
        // Candles and desk lamps stand on a table: drawn just after it.
        baseline: (item.y + item.h) * T + ('onTop' in FURNITURE[item.type] ? 0.05 : 0),
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
    // Lamps went on or off: the walls with lamps on them are baked again.
    const lamps = frame.lamps
      ? { on: frame.lamps.on, off: frame.lamps.off, night: !!frame.lamps.night, key: `${frame.lamps.key ?? `${frame.lamps.on}|${[...frame.lamps.off].join(',')}`}|${frame.lamps.night ? 'n' : ''}` }
      : { on: false, off: new Set<string>(), key: '', night: false }
    if (lamps.key !== this.lampState.key) {
      this.lampState = lamps
      this.chunks.clear()
    }
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
    const ambient = frame.ambientFrame ?? 0
    for (const item of this.wallLights) {
      const box = wallLightBox(item)
      if (!intersects(box, rect)) continue
      blitAt(this.furnitureSprite(item, this.itemState(item, frame, ambient)), box.x, box.y)
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
        if (intersects(box, rect)) list.push({ kind: 'intern', id: it.id, color: it.color, alpha: it.alpha, x: slot.x, y: slot.y + it.dy, baseline: (group.seat.y + 2) * T - 0.25, box, shirt: it.shirt, parent: it.parent })
      })
      if (more > 0 && slots.length) {
        const last = slots[slots.length - 1]
        extraLabels.push({ text: `+${more}`, x: last.x + INTERN_W + 2, y: last.y + INTERN_H / 2 })
      }
    }
    list.sort((a, b) => a.baseline - b.baseline)
    const blit = (sprite: Canvas, x: number, y: number) => ctx.drawImage(sprite, o.x + x * z, o.y + y * z, sprite.width * z, sprite.height * z)

    for (const d of list) {
      if (d.kind === 'furniture') {
        blit(this.furnitureSprite(d.item, this.itemState(d.item, frame, ambient)), d.box.x, d.box.y)
        // By day the screens go with their desk; at night the glow pass draws them over the dark.
        if (d.item.type === 'desk' && !frame.lighting) this.drawScreens(blit, d.item, frame, ambient)
      } else if (d.kind === 'chair') {
        const desk = frame.desks.get(d.deskId)
        blit(this.chairSprite(d.deskId, d.facing, !!desk?.occupied), d.x, d.y)
      } else {
        const fig = this.figure(d, frame)
        if (fig.alpha < 1) ctx.globalAlpha = fig.alpha
        blit(fig.canvas, fig.x, fig.y)
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

    // Evening and night: the dark with the pools of light cut out (engine/lights.ts), then whatever
    // shines by itself drawn again over it. Morning: only a tone.
    if (frame.lighting) this.drawNight(ctx, frame, list, o, rect, ambient, blit)
    else if (frame.daylight?.tint) {
      ctx.save()
      ctx.globalAlpha = frame.daylight.tint.alpha
      ctx.fillStyle = frame.daylight.tint.color
      ctx.fillRect(0, 0, view.width, view.height)
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

  /** Whether anything that lives (LEDs, fish, steam, flames, a screen with something on it) is in view. */
  livesIn(rect: Box, screens?: ReadonlyMap<string, ScreenKind>): boolean {
    const box = (item: PlacedFurniture) => ({ x: item.x * T, y: item.y * T - FURNITURE_HEADROOM, w: item.w * T, h: item.h * T + FURNITURE_HEADROOM })
    if (this.world.furniture.some((item) => ANIMATED.has(item.type) && intersects(box(item), rect))) return true
    // At night the city behind the windows lives.
    if (this.lampState.night && this.world.furniture.some((item) => item.type === 'window' && item.view !== 'inside' && intersects({ x: item.x * T, y: item.y * T, w: item.w * T, h: T }, rect))) return true
    if (!screens) return false
    return this.world.desks.some((desk) => (screens.get(desk.id) ?? 'off') !== 'off' && intersects({ x: desk.x * T, y: desk.y * T - FURNITURE_HEADROOM, w: 2 * T, h: T + FURNITURE_HEADROOM }, rect))
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
      if ((item.type !== 'rug' && !isWallItem(item)) || (WALL_LIGHTS.has(item.type) && !STILL_GLOW.has(item.type))) continue
      const box = { x: item.x * T, y: item.y * T, w: item.w * T, h: item.h * T }
      if (!intersects(box, chunkBox)) continue
      const p = paintAt(box.x - chunkBox.x, box.y - chunkBox.y)
      if (item.type === 'rug') this.paintItem(p, item, {}, 0)
      else if (WALL_LIGHTS.has(item.type)) this.paintItem(p, item, { lit: this.lampState.on && !this.lampState.off.has(lightKey(item)) }, 0)
      else drawWallItem(p, item, { night: this.lampState.night, seed: windowSeed(item), ...this.windowView(item) })
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
  private paintItem(p: Paint, original: PlacedFurniture, state: FurnitureState, top: number): void {
    const skin = this.decor?.item(original) ?? null
    paintSkinnedItem(p, skin ? original : this.variantOf(original), skin, state, top)
  }

  /** The theme's furniture variants (rugs, plants) over the map's. */
  private variantOf(item: PlacedFurniture): PlacedFurniture {
    if (item.type === 'rug' && this.theme.rug) return { ...item, variant: this.theme.rug }
    if ((item.type === 'plant' || item.type === 'big-plant') && this.theme.plant) return { ...item, variant: this.theme.plant === 'cactus' ? 'cactus' : undefined }
    return item
  }

  private furnitureSprite(original: PlacedFurniture, state: FurnitureState): Canvas {
    const item = this.variantOf(original)
    const skin = this.decor?.item(original)?.id ?? ''
    // Animated things cycle through a few dozen frames; each is cached like any sprite.
    const f = (state.frame ?? 0) % 120
    const flags = `${state.screenOn ? 1 : 0}${state.lit ? 1 : 0}${state.active ? 1 : 0}${state.glowOnly ? 1 : 0}`
    const key = `f|${item.type}|${item.w}|${item.h}|${item.facing}|${item.variant ?? ''}|${skin}|${flags}|${state.papers ?? 0}|${f}`
    return this.sprite(key, item.w * T, item.h * T + FURNITURE_HEADROOM, (p) => this.paintItem(p, original, { ...state, frame: f }, FURNITURE_HEADROOM))
  }

  /** How a piece of furniture is now: a desk's screen and papers, a lamp lit or not, an appliance in use, its frame. */
  private itemState(item: PlacedFurniture, frame: FrameState, ambient: number): FurnitureState {
    const desk = item.id ? frame.desks.get(item.id) : undefined
    const key = lightKey(item)
    const lit = !!frame.lamps?.on && !frame.lamps.off.has(key)
    const active = APPLIANCES.has(item.type) && !!frame.using?.has(key)
    // Lamps that are off and idle appliances keep still: one cached picture instead of a hundred.
    const still = (STILL_UNLIT.has(item.type) && !lit) || (item.type === 'microwave' && !active)
    return { screenOn: !!desk?.on, papers: desk?.papers ?? 0, frame: ANIMATED.has(item.type) && !still ? ambient : 0, lit, active }
  }

  /** What a desk's screens show (work, a screensaver), over the desk; day and night alike. */
  private drawScreens(blit: (c: Canvas, x: number, y: number) => void, item: PlacedFurniture, frame: FrameState, ambient: number): boolean {
    const kind = item.id ? frame.desks.get(item.id)?.screen ?? 'off' : 'off'
    if (kind === 'off') return false
    const f = Math.floor(ambient / 2) % SCREEN_FRAMES
    for (const r of screenRects(item)) {
      blit(this.sprite(`scr|${kind}|${r.w}|${r.h}|${r.lid ? 1 : 0}|${f}`, r.w, r.h, (p) => drawScreen(p, kind, r.w, r.h, f, !!r.lid)), item.x * T + r.x, item.y * T + r.y)
    }
    return true
  }

  /** A figure's picture and place: a bot, a trainee, an animal. */
  private figure(d: Exclude<Drawable, { kind: 'furniture' | 'chair' }>, frame: FrameState): { canvas: Canvas; x: number; y: number; alpha: number } {
    if (d.kind === 'animal') {
      const v = d.view
      const sp = this.species.get(v.species)!
      return { canvas: this.sprite(`an|${v.species}|${v.coat}|${v.pose}|${v.frame}|${v.facing}`, sp.w, sp.h, (p) => drawAnimal(p, sp, v.coat, v.pose, v.frame, v.facing)), x: d.x, y: d.y, alpha: 1 }
    }
    if (d.kind === 'intern') {
      const own = lookFor(d.id)
      const parent = d.parent ? this.looks(d.parent) : null
      const look = parent?.dressed ? { ...parent, hairStyle: own.hairStyle } : d.shirt ? { ...own, shirt: d.shirt } : own
      return { canvas: this.sprite(`i|${d.id}|${d.color}|${lookId(look)}`, INTERN_W, INTERN_H, (p) => drawIntern(p, look, d.color)), x: d.x, y: d.y, alpha: d.alpha }
    }
    const a = d.actor
    const box = actorBox(a)
    const frameNo = box.pose === 'walk' ? a.walkFrame : box.pose === 'type' && !a.target.still ? frame.typingFrame : MOVING_POSES.has(box.pose) ? frame.restFrame ?? 0 : 0
    return { canvas: this.characterSprite(a.key, box.pose, a.facing, frameNo), x: box.x, y: box.y, alpha: frame.alphas?.get(a.key) ?? 1 }
  }

  /**
   * Built once per lighting key: the lamps' light field (stopped by walls) and every still thing that
   * shines by itself (lamp shades, wall lamps, the CEO's lamp, the night light, the stars and the lit
   * windows of the city) in one layer.
   */
  private lightBitmaps(lighting: NonNullable<FrameState['lighting']>, frame: FrameState): { field: LampField; still: Canvas; stillKeys: Set<string>; windows: NightWindow[] } {
    return this.lightMaps.get(lighting.key, () => {
      const field = lampField(this.world, lighting.lights)
      const still = this.makeCanvas(this.pixelWidth, this.pixelHeight)
      const sc = still.getContext('2d') as Ctx2D | null
      const stillKeys = new Set<string>()
      const windows: NightWindow[] = []
      for (const item of this.world.furniture) {
        if (item.type === 'window' && this.lampState.night && item.view !== 'inside') {
          // Stars and the lit windows of the city, only where nothing stands in front of the window.
          const seed = windowSeed(item)
          const cover = windowCover(item, this.world.furniture, (p, f) => this.paintItem(p, f, this.itemState(f, frame, 0), 0))
          const view = nightWindow(item.w * T, seed)
          if (sc) {
            for (const [x, y] of view.stars) if (!cover.has(`${x},${y}`)) ((sc.fillStyle = P.star), sc.fillRect(item.x * T + x, item.y * T + y, 1, 1))
            for (const [x, y] of view.lights) if (!cover.has(`${x},${y}`)) ((sc.fillStyle = P.cityLight), sc.fillRect(item.x * T + x, item.y * T + y, 1, 1))
          }
          windows.push({ item, seed, cover, box: { x: item.x * T, y: item.y * T, w: item.w * T, h: T } })
          continue
        }
        if (!STILL_GLOW.has(item.type)) continue
        const state = this.itemState(item, frame, 0)
        if (!glows(item.type, state)) continue
        const box = WALL_LIGHTS.has(item.type) ? wallLightBox(item) : { x: item.x * T, y: item.y * T - FURNITURE_HEADROOM, w: item.w * T, h: item.h * T + FURNITURE_HEADROOM }
        sc?.drawImage(this.furnitureSprite(item, { ...state, glowOnly: true }) as CanvasImageSource, box.x, box.y)
        stillKeys.add(lightKey(item))
      }
      return { field, still, stillKeys, windows }
    })
  }

  /** A window into the next room shows that room's floor; one out of the building shows the sky. */
  private windowView(item: PlacedFurniture): { inside?: boolean; beyond?: string } {
    if (item.type !== 'window' || item.view !== 'inside') return {}
    const W = this.world.width
    const i = (item.y - 1) * W + item.x + Math.floor(item.w / 2)
    return { inside: true, beyond: floorTone(item.y > 0 ? this.world.floors[i] : null) }
  }

  /** The light map: the lamps' field and the rooms' light together, one pixel per cell. */
  private lightMap(lighting: NonNullable<FrameState['lighting']>, field: LampField): { canvas: Canvas; data: Uint8ClampedArray } {
    return this.shades.get(`${lighting.key}#${lighting.shadeKey}`, () => {
      const data = buildLightMap(this.world, lighting.levels, field, lighting.dark, lighting.lit)
      const canvas = this.makeCanvas(field.w, field.h)
      const c = canvas.getContext('2d') as Ctx2D | null
      if (c && 'createImageData' in c) {
        const image = c.createImageData(field.w, field.h)
        image.data.set(data)
        c.putImageData(image, 0, 0)
      }
      return { canvas, data }
    })
  }

  /**
   * Night: the light map multiplied over the office (the dark lifted where light falls, never above day),
   * then the still shining layer, then — in depth order — whatever moves and shines (flames, a garland, a
   * sign, screens, racks, appliances in use); a figure standing in front of something shining is drawn
   * again, lit like the place it stands in.
   */
  private drawNight(ctx: Ctx2D, frame: FrameState, list: readonly Drawable[], o: { x: number; y: number }, rect: Box, ambient: number, blit: (c: Canvas, x: number, y: number) => void): void {
    const lighting = frame.lighting!
    const z = frame.camera.zoom
    const maps = this.lightBitmaps(lighting, frame)
    const lit = this.lightMap(lighting, maps.field)
    const map = lit.canvas
    ctx.save()
    // Smoothed when scaled: the light fades from cell to cell without steps.
    ctx.imageSmoothingEnabled = true
    ctx.globalCompositeOperation = 'multiply'
    ctx.drawImage(map, o.x, o.y, maps.field.w * LIGHT_CELL * z, maps.field.h * LIGHT_CELL * z)
    ctx.globalCompositeOperation = 'source-over'
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(maps.still, o.x, o.y, this.pixelWidth * z, this.pixelHeight * z)
    ctx.restore()
    const shining: Box[] = []
    // The city behind the windows lives: a few pixels change on the one ambient timer.
    for (const win of maps.windows) {
      if (!intersects(win.box, rect)) continue
      shining.push(win.box)
      for (const op of windowOps(win.box.w, win.seed, ambient)) {
        if (win.cover.has(`${op.x},${op.y}`)) continue
        ctx.fillStyle = op.glow ? WINDOW_COLOR[op.color]() : litColor(WINDOW_COLOR[op.color](), lit.data, maps.field.w, win.box.x + op.x, win.box.y + op.y)
        ctx.fillRect(o.x + (win.box.x + op.x) * z, o.y + (win.box.y + op.y) * z, z, z)
      }
    }
    for (const item of this.wallLamps) if (maps.stillKeys.has(lightKey(item))) shining.push(wallLightBox(item))
    for (const item of this.wallLights) {
      const box = wallLightBox(item)
      if (!intersects(box, rect)) continue
      const state = this.itemState(item, frame, ambient)
      if (!glows(item.type, state)) continue
      blit(this.furnitureSprite(item, { ...state, glowOnly: true }), box.x, box.y)
      shining.push(box)
    }
    for (const d of list) {
      if (d.kind === 'furniture') {
        if (STILL_GLOW.has(d.item.type)) {
          if (maps.stillKeys.has(lightKey(d.item))) shining.push(d.box)
          continue
        }
        if (d.item.type === 'desk') {
          if (this.drawScreens(blit, d.item, frame, ambient)) shining.push(d.box)
          continue
        }
        // Only things that can shine are looked at again (most furniture never does).
        if (!MAY_GLOW.has(d.item.type)) continue
        const state = this.itemState(d.item, frame, ambient)
        if (glows(d.item.type, state)) {
          blit(this.furnitureSprite(d.item, { ...state, glowOnly: true }), d.box.x, d.box.y)
          shining.push(d.box)
        }
      } else if (d.kind !== 'chair' && shining.some((b) => intersects(b, d.box))) {
        this.shaded(ctx, this.figure(d, frame), map, blit)
      }
    }
  }

  /** A figure drawn again, multiplied by the light map on its own pixels only. */
  private shaded(ctx: Ctx2D, fig: { canvas: Canvas; x: number; y: number; alpha: number }, map: Canvas, blit: (c: Canvas, x: number, y: number) => void): void {
    const w = fig.canvas.width
    const h = fig.canvas.height
    let tmp = this.scratch.get(`${w}x${h}`)
    if (!tmp) {
      tmp = this.makeCanvas(w, h)
      this.scratch.set(`${w}x${h}`, tmp)
    }
    const c = tmp.getContext('2d') as Ctx2D | null
    if (!c || !('clearRect' in c)) return
    const k = LIGHT_CELL
    c.globalCompositeOperation = 'source-over'
    c.clearRect(0, 0, w, h)
    c.imageSmoothingEnabled = false
    c.drawImage(fig.canvas, 0, 0)
    c.imageSmoothingEnabled = true
    c.globalCompositeOperation = 'multiply'
    c.drawImage(map, fig.x / k, fig.y / k, w / k, h / k, 0, 0, w, h)
    c.globalCompositeOperation = 'destination-in'
    c.imageSmoothingEnabled = false
    c.drawImage(fig.canvas, 0, 0)
    c.globalCompositeOperation = 'source-over'
    if (fig.alpha < 1) ctx.globalAlpha = fig.alpha
    blit(tmp, fig.x, fig.y)
    ctx.globalAlpha = 1
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
    const id = lookId(look)
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
  state: FurnitureState,
  top: number
): void {
  if (skin?.sprite) return drawSprite(p, skin.sprite, Math.floor((original.w * T - skin.sprite.w) / 2), top + original.h * T, !!state.glowOnly)
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

/** A window at night: its seed, what covers it, where it is. */
type NightWindow = { item: PlacedFurniture; seed: number; cover: Set<string>; box: Box }

const WINDOW_COLOR: Record<WindowOp['color'], () => string> = {
  cityDark: () => P.cityDark,
  cityLight: () => P.cityLight,
  sky: () => P.sky,
  carHead: () => P.cityLight,
  carTail: () => P.markerRed,
  planeRed: () => P.markerRed,
  planeWhite: () => P.white
}

/** A colour as the light map shows it at an art pixel (what is not a light is lit by its room). */
function litColor(color: string, map: Uint8ClampedArray, cellsW: number, x: number, y: number): string {
  const i = (Math.floor(y / LIGHT_CELL) * cellsW + Math.floor(x / LIGHT_CELL)) * 4
  const n = parseInt(color.slice(1), 16)
  const f = (v: number, c: number) => Math.round((v * (map[i + c] ?? 255)) / 255)
  return `rgb(${f((n >> 16) & 255, 0)}, ${f((n >> 8) & 255, 1)}, ${f(n & 255, 2)})`
}

/** Lights on walls: drawn live, not baked into the building. */
const WALL_LIGHTS: ReadonlySet<string> = new Set(['wall-lamp', 'garland', 'neon-sign'])
/** Things that may have pixels shining by themselves at night (desks shine through their screens). */
const MAY_GLOW: ReadonlySet<string> = new Set(['candles', 'garland', 'neon-sign', 'server-rack', 'aquarium', 'microwave', 'coffee-machine', 'fridge'])
/** Lights whose glow never moves: baked once per lighting into one layer. */
const STILL_GLOW: ReadonlySet<string> = new Set(['floor-lamp', 'wall-lamp', 'desk-lamp', 'night-light', 'ceo-desk', 'device-stand'])
/** Lights that stand still while off (their flames and twinkles need the frame only when lit). */
const STILL_UNLIT: ReadonlySet<string> = new Set(['candles', 'garland', 'neon-sign'])

/** Where a wall light's picture goes: its wall tile, with the furniture headroom above it. */
function wallLightBox(item: PlacedFurniture): Box {
  return { x: item.x * T, y: item.y * T - FURNITURE_HEADROOM, w: item.w * T, h: T + FURNITURE_HEADROOM }
}

