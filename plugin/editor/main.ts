// The office tab. It loads the building (office/map.json) shipped with the plugin and the seating
// kept in the plugin storage (the owner's pins, and the places bots took at random), asks the
// worker for the bots once and then hears every change it posts. Bots go where their real Orca state puts them (engine/locations.ts) and walk there by
// BFS. Drawing happens only when something changed; the one animation timer runs only while a
// bot walks, types or waits with a bubble (engine/scheduler.ts).
import { Cast } from '../engine/actors'
import { Effects, envelopeAt, linkAlpha, type EndRef } from '../engine/fx'
import { Follow } from '../engine/follow'
import {
  clampCamera,
  fitCamera,
  panBy,
  screenToWorld,
  zoomAt,
  ZoomAccumulator,
  type Camera,
  type Viewport
} from '../engine/camera'
import { bubbleGlyph, noticeCounts, paperSheets, planTargets, ruleFor, type Target } from '../engine/locations'
import { Scheduler } from '../engine/scheduler'
import {
  assignBotSeats,
  BOT_SEATS_KEY,
  emptyPins,
  isBotPlace,
  occupantOf,
  parseDeskMap,
  parsePins,
  pin,
  PINS_KEY,
  serializePins,
  swap,
  unpin,
  type PinKind,
  type Pins
} from '../engine/seating'
import { ANIMALS_STORAGE_KEY, loadSpecies, parseAnimalChoices, Zoo, type AnimalChoices, type Species } from '../engine/animals'
import { chatClouds, CHAT_TURN_MS, Life } from '../engine/life'
import { mailPoint, Reading, READ_MS } from '../engine/reading'
import { origin, visibleRect } from '../engine/camera'
import { parseMap, type World } from '../engine/world'
import { FURNITURE } from '../engine/catalog'
import type { Desk } from '../src/bots'
import type { ChatAnswer, Extras } from '../src/extras'
import type { Mail, MailEntry, Party } from '../src/mail'
import type { Office, OfficeDebug } from '../src/protocol'
import { employees, formatDuration, trainees, working } from './format'
import { BASE_PALETTE, P } from './palette'
import { buildPanel, buttonStyle as buttonCss, internColor, renderAnimalPanel, renderAppearanceEditor, renderDecorHint, renderDecorPanel, type DecorSection, renderOverflow, renderPanel, renderPinConfirm, renderPinPicker, renderPlace, renderWorkerPanel, type PinChoice, type PlaceView } from './panel'
import { AppearanceStore, cleanPlate, type Appearance, type KeyValueStore } from './appearance'
import { CHAIR_POSES, drawCharacter, lookOf } from './art'
import { Daylight } from './daylight'
import { hitPoint, hitSegment, LEGEND_TYPES, mailTooltip, typeName } from './mailview'
import { assignWorkerDesks, parseWorkerDesks, workerLabels, presentWorkers, WORKER_DESKS_KEY, WORKER_LINGER_MS, WORKER_ROOM, workerKey, workerTarget, type WorkerInfo } from '../engine/workers'
import type { DeskSeat, PlacedFurniture } from '../engine/world'
import { applyPalette, DEFAULT_THEME, pickTheme, THEME_STORAGE_KEY, type Theme } from './theme'
import { builtinVariants, chooseItems, chooseRoom, DECOR_STORAGE_KEY, emptyDecor, itemKey, loadPacks, parseDecor, serializeDecor, variantsFor, type Decor, type SkinPack, type SkinTarget, type SkinVariant } from './skins'
import type { CharacterSkin } from './characters'
import { BUBBLE_COLOR, deskChair, drawAnimal, internSlots, mailColor, paintSkinnedItem, paintSkinnedTile, Renderer, STATE_COLOR, type BotLabel, type EnvelopeView, type InternGroup, type LinkView } from './render'

// ── Page ─────────────────────────────────────────────────────────────────────────────────

document.documentElement.style.cssText = `margin:0;height:100%;background:${P.void}`
document.body.style.cssText = 'margin:0;height:100%;overflow:hidden;font:12px ui-monospace,"SF Mono",Menlo,monospace;user-select:none'
const canvas = document.createElement('canvas')
canvas.style.cssText = 'display:block;width:100vw;height:100vh;image-rendering:pixelated;cursor:grab;touch-action:none'
document.body.append(canvas)
const ctx = canvas.getContext('2d')!

const css = (el: HTMLElement, style: string) => {
  el.style.cssText = style
  return el
}
const panel = `position:fixed;background:${P.labelBack}ee;color:${P.tagText};border:1px solid #ffffff22;border-radius:6px;`
const hud = css(document.createElement('div'), `${panel}top:10px;left:10px;padding:6px 10px;pointer-events:none;line-height:1.5`)
const controls = css(document.createElement('div'), `${panel}right:10px;bottom:10px;padding:4px;display:flex;gap:4px;align-items:center`)
const hint = css(document.createElement('div'), `${panel}left:10px;bottom:10px;padding:4px 8px;opacity:.75;pointer-events:none`)
const tooltip = css(document.createElement('div'), `${panel}padding:6px 9px;pointer-events:none;display:none;line-height:1.5;max-width:320px`)
const notice = css(document.createElement('div'), `${panel}top:50%;left:50%;transform:translate(-50%,-50%);padding:12px 16px;max-width:70vw;max-height:70vh;overflow:auto;display:none;white-space:pre-wrap`)
const debugBox = css(document.createElement('div'), `${panel}top:10px;right:10px;padding:6px 9px;display:none;white-space:pre;max-width:60vw;overflow:hidden;color:${P.working}`)
hint.textContent = 'колесо/тачпад — двигать · ⌘/Ctrl+колесо или щипок — масштаб · тянуть мышью · F — весь офис'
const panelBox = css(
  document.createElement('div'),
  `${panel}background:${P.labelBack};top:10px;right:10px;bottom:10px;width:320px;padding:12px 14px;overflow:auto;display:none;border-radius:8px;line-height:1.45;user-select:text`
)
const journalBox = css(
  document.createElement('div'),
  `${panel}background:${P.labelBack};top:84px;left:10px;bottom:52px;width:380px;padding:10px 12px;overflow:auto;display:none;border-radius:8px;line-height:1.45`
)
const topButtons = css(document.createElement('div'), 'position:fixed;top:10px;left:10px;display:flex;gap:4px;margin-top:52px')
const legendBox = css(
  document.createElement('div'),
  `${panel}background:${P.labelBack};top:118px;left:10px;width:330px;padding:10px 12px;display:none;border-radius:8px;line-height:1.5;font-size:11px`
)
/** While pinning: what to do, at the top of the tab. */
const pinBanner = css(document.createElement('div'), `${panel}top:10px;left:50%;transform:translateX(-50%);padding:6px 12px;display:none;color:${P.working};pointer-events:none`)
document.body.append(hud, controls, hint, tooltip, notice, debugBox, panelBox, journalBox, topButtons, legendBox, pinBanner)

function button(label: string, title: string, action: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = label
  b.title = title
  b.style.cssText = `min-width:28px;height:26px;border:0;border-radius:4px;background:${P.tag};color:${P.tagText};font:inherit;cursor:pointer`
  b.addEventListener('click', action)
  return b
}
const zoomLabel = css(document.createElement('span'), 'min-width:34px;text-align:center;opacity:.8')
controls.append(
  button('−', 'Уменьшить (−)', () => zoomBy(-1)),
  zoomLabel,
  button('+', 'Увеличить (+)', () => zoomBy(1)),
  button('Весь офис', 'Вместить весь офис (F)', () => fit())
)
const followButton = button('Следить: выкл', 'Камера едет к последнему реальному событию; любой ввод выключает', () => toggleFollow())
controls.prepend(followButton)
const journalButton = button('Журнал', 'Журнал офиса: последние 50 сообщений между ботами (только метаданные)', () => toggleJournal())
const legendButton = button('Легенда', 'Что значат цвета, линии и конверты', () => toggleLegend())
const overflowButton = button('Без стола', 'Сотрудники, которым не хватило столов в «Командах и отделах»', () => openPanel('overflow'))
overflowButton.style.display = 'none'
topButtons.append(journalButton, legendButton, overflowButton)

// ── State ────────────────────────────────────────────────────────────────────────────────

let world: World | null = null
let renderer: Renderer | null = null
/** The owner's pins and the places bots took by themselves (both in the plugin storage). */
let pins: Pins = emptyPins()
let botMemory: Record<string, string> = {}
/** Seating waits for the storage, or a bot could take a new random place before its old one is read. */
let seatingLoaded = false
let storageNote: string | null = null
/** Bot key → desk id it sits at now. */
let botDeskIds = new Map<string, string | null>()
/** «Закрепить»: whose place is being picked, and a swap waiting for «Поменяться местами». */
let pinning: { kind: PinKind; who: string } | null = null
let pinConfirm: { desk: string; occupant: string } | null = null
/** Animals from office/animals (data), the owner's choices for them, and where they are. */
let species: Species[] = []
let animalChoices: AnimalChoices = {}
let zoo: Zoo | null = null
let animalErrors: string[] = []
/** «Жизнь»: decorative routines of resting and waiting bots (engine/life.ts); on unless switched off. */
let life: Life | null = null
/** Bots reading a letter that just landed with them (engine/reading.ts). */
const reading = new Reading()
let lifeOn = true
const LIFE_STORAGE_KEY = 'life'
/** The targets the status table gives, before the routines; workers included. */
let baseTargets = new Map<string, Target>()
/** Ambient frame and chat turn last drawn, so the one timer redraws only when they change. */
let drawnAmbient = -1
let drawnChat = -1
let bots: Desk[] | null = null
let targets = new Map<string, Target>()
const cast = new Cast()
let camera: Camera = { x: 0, y: 0, zoom: 2 }
let view: Viewport = { width: 1, height: 1 }
let userMoved = false
let hover: string | null = null
let pointer: { x: number; y: number } | null = null
let debugOn = false
/** Workers, items and bot ids from the worker (Orca's CLI); null until the first answer. */
let extras: Extras | null = null
/** The bot whose panel is open, and its current chat (dropped when the panel closes). */
let selected: string | null = null
let chat: ChatAnswer | 'loading' | null = null
let seatsByKey = new Map<string, { x: number; y: number } | null>()
let lastEvent = ''
/** Mail between bots (metadata only) and what it looks like. */
let mail: Mail | null = null
const fx = new Effects()
const follow = new Follow()
const seenMail = new Set<string>()
/** Mail first seen by the worker before this tab opened is not animated. */
const openedAt = Date.now()
let journalOpen = false
let previousStates = new Map<string, string>()
/** Workers in «Команды и отделы»: who is there, their desks (kept in storage), who has no desk. */
let workers: WorkerInfo[] = []
let workerSeats = new Map<string, DeskSeat>()
let workerOverflow: string[] = []
let storedWorkerDesks: Record<string, string> = {}
const firstSeenDone = new Map<string, number>()
/** Until the first workers/items answer, everyone is put in place without walking (no «забег»). */
let settled = false
/** Tooltip lines for the envelope or line under the pointer. */
let mailHover: string[] | null = null
let legendOpen = false
/** Looks of the bots (plugin storage), themes and the time of day. */
const storage: KeyValueStore | null = (orca as { storage?: KeyValueStore }).storage ?? null
const looks = new AppearanceStore(storage)
let themes: Theme[] = [DEFAULT_THEME]
let theme: Theme = DEFAULT_THEME
let themeErrors: string[] = []
/** Skin packs (office/skins), every look one may pick, and the owner's picks («Оформление»). */
let packs: SkinPack[] = []
/** Character skins from the packs (a robot, a fox…), by `<pack>:<id>`. */
let characters = new Map<string, CharacterSkin>()
let variants = new Map<string, SkinVariant>(builtinVariants().map((v) => [v.id, v]))
let decor: Decor = emptyDecor()
let decorating = false
let decorTarget: { kind: 'room'; room: string } | { kind: 'item'; item: PlacedFurniture } | { kind: 'animal'; id: string } | null = null
let decorNote: string | null = null
/** The owner's clock; the dev harness may pin an hour (`__pixelOfficeHour`), Orca never does. */
const hourNow = () => {
  const pinned = (globalThis as { __pixelOfficeHour?: number }).__pixelOfficeHour
  return typeof pinned === 'number' ? pinned : new Date().getHours()
}
const daylight = new Daylight(hourNow, () => Date.now())
/** The bot whose look is being edited in the panel, and whether the last save was kept. */
let editingLook: string | null = null
let lookSaved: boolean | null = null

const scheduler = new Scheduler(
  {
    requestFrame: (cb) => requestAnimationFrame(cb),
    setInterval: (cb, ms) => setInterval(cb, ms),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>)
  },
  draw,
  () => {
    const now = Date.now()
    const walked = cast.tick()
    const flying = fx.animating(now)
    // Letters that landed: their recipients stop and read, then go on.
    let landed = false
    for (const env of fx.landed(now)) {
      const [kind, key] = env.to.split(':')
      if (kind !== 'bot') continue
      reading.start(key, now)
      life?.interrupt(key, now, READ_MS)
      landed = true
    }
    if (landed) retarget()
    fx.prune(now)
    // Animals: only while the tab is shown.
    const petted = zoo && visible() ? zoo.tick(now, botViews()) : false
    let moved = false
    if (renderer) {
      const next = follow.step(camera, view, renderer.size)
      if (next) {
        camera = next
        zoomLabel.textContent = `${camera.zoom}×`
        moved = true
      }
    }
    // «Жизнь»: a routine moves on only when its time comes, then the bots walk by BFS.
    const due = Math.min(lifeOn && visible() ? life?.nextAt() ?? Infinity : Infinity, reading.nextAt(now))
    const routed = now >= due ? retarget() : false
    // Living things (5 Hz) and chat clouds change picture without anyone walking.
    const ambient = ambientWanted() && Math.floor(now / AMBIENT_MS) !== drawnAmbient
    const chat = lifeOn && visible() && Math.floor(now / (CHAT_TURN_MS / 5)) !== drawnChat && hasResting()
    return walked || flying || moved || routed || ambient || chat || petted
  },
  () => cast.animating() || fx.animating(Date.now()) || follow.moving() || ambientWanted() || (lifeOn && visible() && hasRoutines()) || reading.nextAt(Date.now()) < Infinity || (!!zoo && visible() && zoo.moving())
)

/** Each bot's own office (a C-level office or the mini one), for resting at home. */
function homes(): Map<string, string> {
  const out = new Map<string, string>()
  if (!world) return out
  for (const [key, id] of botDeskIds) {
    const desk = world.desks.find((d) => d.id === id)
    if (desk && isBotPlace(desk)) out.set(key, desk.room)
  }
  return out
}

/** Bots as the animals see them: where they are and whether they walk. */
function botViews(): { key: string; x: number; y: number; walking: boolean }[] {
  return cast.views().filter((v) => !v.key.startsWith('w:')).map((v) => ({ key: v.key, x: v.x, y: v.y, walking: v.walking }))
}

function visible(): boolean {
  return document.visibilityState !== 'hidden'
}

function hasRoutines(): boolean {
  return [...targets.values()].some((t) => t.routine)
}

function hasResting(): boolean {
  return [...targets.values()].some((t) => t.routine === 'rest')
}

/** Bots only: the routines on top of the real targets; workers keep theirs. Returns whether anyone got a new target. */
function retarget(): boolean {
  if (!world) return false
  const bots = new Map([...baseTargets].filter(([k]) => !k.startsWith('w:')))
  const now = Date.now()
  const planned = lifeOn && life ? life.plan(bots, now, homes()) : bots
  const views = new Map(cast.views().map((v) => [v.key, v]))
  const next = reading.apply(planned, views, now)
  for (const [k, t] of baseTargets) if (k.startsWith('w:')) next.set(k, t)
  targets = next
  const changed = cast.sync(world, targets, { snap: !settled })
  if (changed) scheduler.invalidate()
  return changed
}

// ── Data ─────────────────────────────────────────────────────────────────────────────────

/** Plugin files are served next to the editor; try the path relative to this module first. */
async function loadJson(name: string): Promise<unknown> {
  const tries: string[] = []
  try {
    tries.push(new URL(`../office/${name}`, import.meta.url).href)
  } catch {
    // Not a module URL: fall back to the document's.
  }
  tries.push(`../office/${name}`, `office/${name}`, `/office/${name}`)
  let lastError = ''
  for (const url of tries) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json()
      lastError = `${url}: HTTP ${response.status}`
    } catch (error) {
      lastError = `${url}: ${(error as Error).message}`
    }
  }
  throw new Error(`не удалось прочитать office/${name} (${lastError})`)
}

async function loadOffice(): Promise<void> {
  const raw = await loadJson('map.json')
  const parsed = parseMap(raw)
  if (!parsed.world) {
    showNotice(`Карта office/map.json с ошибками:\n\n${parsed.errors.map((e) => `• ${e}`).join('\n')}`)
    return
  }
  world = parsed.world
  renderer = new Renderer(world, (w, h) => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  })
  zoo = new Zoo(world)
  try {
    const loadedAnimals = await loadSpecies((file) => loadJson(`animals/${file}`), new Set(Object.keys(BASE_PALETTE)))
    species = loadedAnimals.species
    animalErrors = loadedAnimals.errors
  } catch (error) {
    animalErrors = [(error as Error).message]
  }
  try {
    animalChoices = parseAnimalChoices(storage ? await storage.get(ANIMALS_STORAGE_KEY) : null)
  } catch {
    animalChoices = {}
  }
  renderer.setSpecies(species)
  zoo.sync(species, animalChoices, Date.now())
  life = new Life(world)
  await loadSeating()
  storage?.onDidChange?.((change) => {
    // Another office tab pinned someone or a bot took a place: read it again.
    if (change.key === PINS_KEY || change.key === BOT_SEATS_KEY) void loadSeating().then(apply)
  })
  renderer.setLooks((key) => lookOf(looks.get(key), key, characters))
  await looks.load()
  // Themes and «Оформление» looks both come from the skin packs.
  const loaded = await loadPacks((file) => loadJson(`skins/${file}`))
  packs = loaded.packs
  characters = new Map(packs.flatMap((pack) => pack.characters).map((c) => [c.id, c]))
  themes = packs.flatMap((pack) => (pack.theme ? [pack.theme] : []))
  if (!themes.length) themes = [DEFAULT_THEME]
  themeErrors = loaded.errors
  variants = new Map([...builtinVariants(), ...packs.flatMap((pack) => pack.variants)].map((v) => [v.id, v]))
  try {
    decor = parseDecor(storage ? await storage.get(DECOR_STORAGE_KEY) : null, new Set(variants.keys()))
  } catch {
    decor = emptyDecor()
  }
  renderer.setDecor(decorLookup())
  let stored: unknown = null
  try {
    stored = storage ? await storage.get(THEME_STORAGE_KEY) : null
  } catch {
    // No storage: the first theme.
  }
  theme = pickTheme(themes, stored)
  try {
    lifeOn = storage ? (await storage.get(LIFE_STORAGE_KEY)) !== false : true
  } catch {
    lifeOn = true
  }
  updateLifeButton()
  try {
    storedWorkerDesks = parseWorkerDesks(storage ? await storage.get(WORKER_DESKS_KEY) : null)
  } catch {
    storedWorkerDesks = {}
  }
  buildThemeSelect()
  applyLook()
  resize()
  apply()
}

/** Pins and remembered places from the plugin storage; without storage the seating lives in the tab. */
async function loadSeating(): Promise<void> {
  try {
    if (storage) {
      pins = parsePins(await storage.get(PINS_KEY))
      botMemory = parseDeskMap(await storage.get(BOT_SEATS_KEY))
      storageNote = null
    } else storageNote = 'хранилище плагина недоступно: места держатся до закрытия вкладки'
  } catch {
    storageNote = 'хранилище плагина не ответило: места держатся до закрытия вкладки'
  }
  seatingLoaded = true
}

async function savePins(next: Pins): Promise<void> {
  pins = next
  apply()
  try {
    await storage?.set(PINS_KEY, serializePins(next) as never)
  } catch {
    storageNote = 'не удалось сохранить закрепление: оно держится до закрытия вкладки'
    updatePanel()
  }
}

/** The theme's colours with the sky of the hour, its floors and furniture; every bitmap redrawn. */
function applyLook(): void {
  applyPalette(theme, daylight.look.sky)
  renderer?.setTheme({ floors: theme.floors, rug: theme.furniture.rug, plant: theme.furniture.plant })
  document.documentElement.style.background = P.void
  updateHud()
  scheduler.invalidate()
}

/** «Жизнь: вкл/выкл»: the routines; the choice is kept in the plugin storage. */
const lifeButton = button('Жизнь', 'Боты без дела гуляют по офису, ждущие ходят с табличкой у двери CEO. Только анимация, без токенов', () => void toggleLife())

async function toggleLife(): Promise<void> {
  lifeOn = !lifeOn
  updateLifeButton()
  retarget()
  scheduler.wake()
  try {
    await storage?.set(LIFE_STORAGE_KEY, lifeOn as never)
  } catch {
    // Kept until the tab closes.
  }
}

function updateLifeButton(): void {
  lifeButton.textContent = lifeOn ? 'Жизнь: вкл' : 'Жизнь: выкл'
  lifeButton.style.background = lifeOn ? P.working : P.tag
  lifeButton.style.color = lifeOn ? P.ink : P.tagText
  if (!lifeButton.isConnected) controls.prepend(lifeButton)
}

/** «Тема: …» cycles through the themes; the choice is kept in the plugin storage. */
const themeButton = button('Тема', 'Сменить тему офиса (office/themes/*.json)', () => void nextTheme())

async function nextTheme(): Promise<void> {
  const i = themes.findIndex((t) => t.id === theme.id)
  theme = themes[(i + 1) % themes.length] ?? DEFAULT_THEME
  buildThemeSelect()
  applyLook()
  try {
    await storage?.set(THEME_STORAGE_KEY, theme.id as never)
  } catch {
    // Kept until the tab closes.
  }
}

function buildThemeSelect(): void {
  themeButton.textContent = `Тема: ${theme.name}`
  if (!themeButton.isConnected) controls.prepend(themeButton)
}

/** Seats, targets and walks from the latest bots. Moves happen only when a target moved. */
function apply(): void {
  if (!world || !bots || !seatingLoaded) {
    scheduler.invalidate()
    return
  }
  const seated = assignBotSeats(bots.map((bot) => bot.key), world.desks, pins.bots, botMemory)
  const seats = seated.seats
  if (JSON.stringify(seated.memory) !== JSON.stringify(botMemory)) {
    botMemory = seated.memory
    void storage?.set(BOT_SEATS_KEY, botMemory as never).catch(() => {})
  }
  seatsByKey = new Map([...seats].map(([key, desk]) => [key, desk ? desk.seat : null]))
  botDeskIds = new Map([...seats].map(([key, desk]) => [key, desk ? desk.id : null]))
  const botTargets = planTargets(
    world,
    bots.map((bot) => ({ key: bot.key, state: bot.state, desk: seats.get(bot.key) ?? null, ...signals(bot) })),
    baseTargets
  )
  placeWorkers(new Set([...seats.values()].filter((d): d is DeskSeat => d !== null).map((d) => d.id)))
  baseTargets = new Map(botTargets)
  for (const w of workers) {
    const desk = workerSeats.get(w.id)
    if (desk) baseTargets.set(workerKey(w.id), workerTarget(w, desk))
  }
  const bases = new Map([...baseTargets].filter(([k]) => !k.startsWith('w:')))
  targets = reading.apply(new Map(lifeOn && life ? life.plan(bases, Date.now(), homes()) : bases), new Map(cast.views().map((v) => [v.key, v])), Date.now())
  for (const [k, t] of baseTargets) if (k.startsWith('w:')) targets.set(k, t)
  // A real status change is an event the camera may follow.
  for (const bot of bots) {
    const before = previousStates.get(bot.key)
    const target = targets.get(bot.key)
    if (before !== undefined && before !== bot.state && target) follow.event({ x: target.x * 16 + 8, y: target.y * 16 })
  }
  previousStates = new Map(bots.map((bot) => [bot.key, bot.state]))
  // Before the first full answer everyone just stands where their state puts them; later a new
  // worker walks in from the entrance and a status change walks a figure to its new place.
  const entrance = world.spots.find((spot) => spot.kind === 'entrance') ?? null
  if (cast.sync(world, targets, { snap: !settled, spawn: (key) => (key.startsWith('w:') && entrance ? entrance : null) })) scheduler.invalidate()
  scheduler.wake()
  updateHud()
  updateTooltip()
  updatePanel()
}

/** Workers from the CLI: who is in the office, and a stable desk each in «Команды и отделы». */
function placeWorkers(botDesks: Set<string>): void {
  if (!world || !bots || !extras) return
  const all: WorkerInfo[] = bots.flatMap((bot) =>
    (extras?.bots[bot.key]?.interns ?? []).map((i) => ({ id: i.id, name: i.name, parentKey: bot.key, agent: i.agent, state: i.state, live: i.live, since: i.since, subagents: i.subagents ?? [] }))
  )
  workers = presentWorkers(all, Date.now(), firstSeenDone)
  // «Стажёры»: the workers' subagents; a new one pops in by its worker's desk, a finished one fades.
  const subs = new Map<string, { key: string; color: string; live: boolean }>()
  for (const w of workers) for (const sa of w.subagents ?? []) subs.set(`${w.id}#${sa.id}`, { key: workerKey(w.id), color: STATE_COLOR.working, live: true })
  fx.syncInterns(subs, Date.now())
  const free = world.desks.filter((d) => d.room === WORKER_ROOM && !botDesks.has(d.id))
  const assigned = assignWorkerDesks(workers, free, storedWorkerDesks, pins.workers)
  workerSeats = assigned.seats
  workerOverflow = assigned.overflow
  overflowButton.style.display = workerOverflow.length ? 'inline-block' : 'none'
  overflowButton.textContent = `Без стола: +${workerOverflow.length}`
  if (JSON.stringify(assigned.stored) !== JSON.stringify(storedWorkerDesks)) {
    storedWorkerDesks = assigned.stored
    void storage?.set(WORKER_DESKS_KEY, storedWorkerDesks as never).catch(() => {})
  }
}

/** What else decides a bot's place and sign: items in Needs you and a failed last turn. */
function signals(bot: Desk): { needsYou: number; failed: boolean } {
  return { needsYou: extras?.bots[bot.key]?.items?.needsYou ?? 0, failed: bot.failed }
}

function show(office: Office): void {
  bots = office.desks
  hideNotice()
  apply()
}

// ── Drawing ──────────────────────────────────────────────────────────────────────────────

function labels(): Map<string, BotLabel> {
  const out = new Map<string, BotLabel>()
  for (const bot of bots ?? []) out.set(bot.key, { name: bot.name, state: bot.state, needsYou: extras?.bots[bot.key]?.items?.needsYou ?? 0 })
  return out
}

function draw(): void {
  if (!renderer || !world) {
    ctx.fillStyle = P.void
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    return
  }
  const actors = cast.views()
  const now = Date.now()
  const byKey = new Map((bots ?? []).map((bot) => [bot.key, bot]))
  const desks = new Map<string, { occupied: boolean; on: boolean; papers: number }>()
  // Resting at home in the office chair: that chair is taken (its back hidden behind the bot).
  for (const actor of actors) {
    if (actor.walking || !CHAIR_POSES.has(actor.target.pose as never)) continue
    const desk = world.desks.find((d) => d.seat.x === actor.target.x && d.seat.y === actor.target.y)
    if (desk) desks.set(desk.id, { occupied: true, on: false, papers: 0 })
  }
  for (const actor of actors) {
    if (actor.walking || actor.target.place !== 'desk') continue
    const bot = byKey.get(actor.key)
    const on = bot?.state === 'working'
    desks.set(actor.target.slot.slice('desk:'.length), { occupied: true, on, papers: on ? paperSheets(bot.since, now) : 0 })
  }
  const clockNow = new Date(now)
  const pinned = (globalThis as { __pixelOfficeHour?: number }).__pixelOfficeHour
  renderer.draw(ctx, {
    camera,
    view,
    actors,
    labels: labels(),
    desks,
    typingFrame: cast.typingFrame(),
    restFrame: cast.restFrame(),
    bobFrame: cast.bobFrame(),
    dpr: window.devicePixelRatio || 1,
    hover,
    selected,
    alphas: new Map(workers.filter((w) => !w.live).map((w) => [workerKey(w.id), 0.45])),
    links: [...linkViews(), ...parentLinks()],
    interns: traineeGroups(now),
    envelopes: envelopeViews(),
    entranceMark: unknownAtEntrance() ? pointOf('outside') : null,
    daylight: { tint: daylight.look.tint, lamps: daylight.look.lamps },
    ambientFrame: Math.floor(now / AMBIENT_MS),
    clock: { hours: typeof pinned === 'number' ? pinned : clockNow.getHours(), minutes: clockNow.getMinutes() },
    notice: noticeNumbers(),
    animals: zoo ? zoo.views(now, Math.floor(now / AMBIENT_MS)) : [],
    roomLabels: roomLabels(),
    placards: placards(actors),
    clouds: lifeOn ? chatClouds(actors.map((a) => ({ key: a.key, x: a.x, y: a.y, resting: a.target.routine === 'rest' && !a.walking })), now) : new Map(),
    highlights: [...pinHighlights(), ...decorHighlights()],
    plates: [
      ...(bots ?? []).flatMap((bot) => {
        const seat = seatsByKey.get(bot.key)
        const text = looks.get(bot.key).plate
        return seat && text ? [{ seat, text, kind: 'plate' as const }] : []
      }),
      // «N сотрудников» by a bot's desk: its live workers.
      ...(bots ?? []).flatMap((bot) => {
        const seat = seatsByKey.get(bot.key)
        const n = workers.filter((w) => w.parentKey === bot.key && w.live).length
        return seat && n ? [{ seat, text: employees(n), kind: 'counter' as const }] : []
      }),
      // «N стажёров» by a worker's desk: its subagents running now.
      ...workers.flatMap((w) => {
        const desk = workerSeats.get(w.id)
        const n = w.subagents?.length ?? 0
        return desk && n ? [{ seat: desk.seat, text: trainees(n), kind: 'counter' as const }] : []
      }),
      // A worker's desk: its name and the colour of its parent bot.
      ...workers.flatMap((w) => {
        const desk = workerSeats.get(w.id)
        return desk ? [{ seat: desk.seat, text: shortName(w.name), kind: 'worker' as const, color: parentColor(w.parentKey) }] : []
      })
    ]
  })
  drawnAmbient = Math.floor(now / AMBIENT_MS)
  drawnChat = Math.floor(now / (CHAT_TURN_MS / 5))
  if (debugOn) updateDebug()
  scheduler.wake()
}

/** Waiting bots on their routine hold up a sign with their «?» or «!». */
function placards(actors: readonly { key: string; target: Target }[]): Map<string, { glyph: '!' | '?'; color: string }> {
  const out = new Map<string, { glyph: '!' | '?'; color: string }>()
  if (!lifeOn) return out
  for (const a of actors) if (a.target.routine === 'wait' && a.target.bubble) out.set(a.key, { glyph: bubbleGlyph(a.target.bubble), color: BUBBLE_COLOR[a.target.bubble] })
  return out
}

/** The notice board: bots that stand at the owner's door now, and bots at work (as the HUD counts). */
function noticeNumbers(): { waiting: number; working: number } {
  return noticeCounts((bots ?? []).map((bot) => ({ state: bot.state, ...signals(bot) })))
}

/** An office's label says who sits there (and 📌 when the owner pinned them). */
function roomLabels(): Map<string, string> {
  const out = new Map<string, string>()
  if (!world) return out
  for (const desk of world.desks) {
    if (!isBotPlace(desk)) continue
    const room = world.rooms.find((r) => r.id === desk.room)
    if (!room) continue
    const who = occupantOf(desk.id, botDeskIds)
    const name = who ? bots?.find((b) => b.key === who)?.name ?? who : null
    // From afar the labels of narrow offices would run into each other: the name only.
    if (camera.zoom / (window.devicePixelRatio || 1) < 2) {
      if (name) out.set(room.id, `${name}${pins.bots[who!] === desk.id ? ' 📌' : ''}`)
      continue
    }
    out.set(room.id, name ? `${room.label} · ${name}${pins.bots[who!] === desk.id ? ' 📌' : ''}` : `${room.label} · свободен`)
  }
  return out
}

// ── Living things: LEDs, fish, steam, the cat ────────────────────────────────────────────

/**
 * Living things change at 5 Hz on the same one animation timer, only while the tab is shown,
 * something alive is in view and motion is welcome; a frame is drawn only when the picture changes.
 */
const AMBIENT_MS = 200
const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

function ambientWanted(): boolean {
  return !!renderer && !reducedMotion && visible() && renderer.livesIn(visibleRect(camera, view))
}
// The dev harness (tools/harness) may ask where things are, for screenshots; Orca never sets this.
if ((globalThis as { __pixelOfficeHarness?: boolean }).__pixelOfficeHarness) {
  ;(globalThis as { __pixelOfficeState?: unknown }).__pixelOfficeState = () => {
    const o = origin(camera, view)
    const dpr = window.devicePixelRatio || 1
    const at = (x: number, y: number) => ({ sx: (o.x + x * 16 * camera.zoom) / dpr, sy: (o.y + y * 16 * camera.zoom) / dpr })
    return {
      animals: (zoo?.views(Date.now(), 0) ?? []).map((v) => ({ ...v, ...at(v.x + 0.5, v.y + 0.5), room: world?.roomAt[Math.round(v.y) * world.width + Math.round(v.x)] })),
      bots: cast.views().map((v) => ({ key: v.key, walking: v.walking, pose: v.target.pose, doing: v.target.doing, reading: v.target.reading, ...at(v.x + 0.5, v.y), room: world?.roomAt[Math.round(v.y) * world.width + Math.round(v.x)] })),
      zoom: camera.zoom / dpr
    }
  }
}
document.addEventListener('visibilitychange', () => {
  // Back in view: the routines go on from now (no catching up), the timer starts again.
  if (visible()) retarget()
  scheduler.wake()
})

// ── «Оформление»: the looks of rooms and things ──────────────────────────────────────────

function decorLookup() {
  return {
    room: (room: string, part: 'floor' | 'wall') => variants.get(decor.rooms[room]?.[part] ?? '') ?? null,
    item: (item: Pick<PlacedFurniture, 'room' | 'type' | 'x' | 'y'>) => variants.get(decor.items[itemKey(item)] ?? '') ?? null
  }
}

const decorButton = button('Оформление', 'Поменять пол и стены комнат, вид мебели и людей (пакеты скинов)', () => toggleDecorating())
controls.prepend(decorButton)

function toggleDecorating(): void {
  decorating = !decorating
  decorTarget = null
  if (decorating) {
    stopPinning()
    selected = null
    editingLook = null
  }
  decorButton.style.background = decorating ? P.working : P.tag
  decorButton.style.color = decorating ? P.ink : P.tagText
  updatePanel()
  updateHud()
  scheduler.invalidate()
}

/** Every piece of furniture one can dress, desk chairs included (they are `chair`s). */
function dressable(): PlacedFurniture[] {
  if (!world) return []
  return [...world.furniture.filter((f) => FURNITURE[f.type].mount === 'floor'), ...world.desks.map(deskChair)]
}

/** What a click in «Оформление» points at: the front-most thing, else a rug, else the room. */
function decorAt(point: { x: number; y: number }): typeof decorTarget {
  if (!world) return null
  let best: PlacedFurniture | null = null
  let rug: PlacedFurniture | null = null
  for (const item of dressable()) {
    const tall = item.type === 'rug' || item.type === 'pet-bed' ? 0 : 12
    if (point.x < item.x * 16 || point.x >= (item.x + item.w) * 16 || point.y < item.y * 16 - tall || point.y >= (item.y + item.h) * 16) continue
    if (item.type === 'rug') rug = item
    else if (!best || item.y + item.h > best.y + best.h) best = item
  }
  const pick = best ?? rug
  if (pick) return { kind: 'item', item: pick }
  const tx = Math.floor(point.x / 16)
  const ty = Math.floor(point.y / 16)
  const room = world.roomAt[ty * world.width + tx]
  return room && world.tiles[ty * world.width + tx] === 'floor' ? { kind: 'room', room } : null
}

const THING_NAMES: Partial<Record<string, string>> = {
  desk: 'стол', chair: 'кресло', armchair: 'кресло', sofa: 'диван', loveseat: 'диванчик', rug: 'ковёр', 'server-rack': 'серверная стойка',
  aquarium: 'аквариум', plant: 'растение', 'big-plant': 'большое растение', bookshelf: 'книжный шкаф', 'coffee-machine': 'кофемашина',
  'water-cooler': 'кулер', trophy: 'кубок', flowers: 'цветы', boxes: 'коробки', 'ceo-desk': 'стол CEO', 'coffee-table': 'журнальный столик'
}

async function saveDecor(next: Decor): Promise<void> {
  decor = next
  renderer?.setDecor(decorLookup())
  scheduler.invalidate()
  updatePanel()
  try {
    await storage?.set(DECOR_STORAGE_KEY, serializeDecor(next) as never)
    decorNote = storage ? null : 'хранилище плагина недоступно: оформление держится до закрытия вкладки'
  } catch {
    decorNote = 'не удалось сохранить оформление: держится до закрытия вкладки'
  }
  updatePanel()
}

function packName(id: string): string {
  return id === 'builtin' ? 'встроено' : packs.find((p) => p.id === id)?.name ?? id
}

function animalRows() {
  return species.flatMap((sp) => sp.instances.map((it) => ({ id: it.id, name: it.name, species: sp.name, on: !animalChoices[it.id]?.off })))
}

async function saveAnimals(next: AnimalChoices): Promise<void> {
  animalChoices = next
  zoo?.sync(species, animalChoices, Date.now())
  scheduler.invalidate()
  scheduler.wake()
  updatePanel()
  try {
    await storage?.set(ANIMALS_STORAGE_KEY, animalChoices as never)
  } catch {
    decorNote = 'не удалось сохранить: держится до закрытия вкладки'
  }
}

function decorPanelHtml(): string {
  if (!world || !decorTarget) return renderDecorHint(animalRows())
  if (decorTarget.kind === 'animal') {
    const id = decorTarget.id
    const sp = species.find((x) => x.instances.some((i) => i.id === id))
    const it = sp?.instances.find((i) => i.id === id)
    if (!sp || !it) return renderDecorHint(animalRows())
    const coat = animalChoices[id]?.coat ?? it.coat
    return renderAnimalPanel({ id, name: it.name, species: sp.name, on: !animalChoices[id]?.off, coats: sp.coats.map((c) => ({ id: c.id, name: c.name, selected: c.id === coat })) })
  }
  const all = [...variants.values()]
  const option = (current: string | undefined) => (v: SkinVariant) => ({ id: v.id, name: v.name, pack: packName(v.pack), selected: v.id === current })
  if (decorTarget.kind === 'room') {
    const target = decorTarget
    const room = world.rooms.find((r) => r.id === target.room)!
    const chosen = decor.rooms[room.id] ?? {}
    const sections: DecorSection[] = [
      { part: 'floor', label: 'Пол', options: variantsFor(all, 'floor').map(option(chosen.floor)), isDefault: !chosen.floor },
      { part: 'wall', label: 'Стены', options: variantsFor(all, 'wall').map(option(chosen.wall)), isDefault: !chosen.wall }
    ]
    return renderDecorPanel({ title: room.label || room.id, subtitle: 'комната: пол и стены', sections, note: decorNote })
  }
  const item = decorTarget.item
  const current = decor.items[itemKey(item)]
  const options = variantsFor(all, item.type as SkinTarget)
  const same = dressable().filter((f) => f.type === item.type)
  const name = THING_NAMES[item.type] ?? item.type
  return renderDecorPanel({
    title: name[0].toUpperCase() + name.slice(1),
    subtitle: `${world.rooms.find((r) => r.id === item.room)?.label ?? item.room} · ${options.length ? `вариантов: ${options.length}` : 'вариантов в пакетах пока нет'}`,
    sections: [{ part: 'item', label: 'Вид', options: options.map(option(current)), isDefault: !current }],
    all: same.length > 1 ? { label: name, count: same.length } : null,
    note: decorNote
  })
}

/** Small pictures of every look in the panel, drawn with the office's own art. */
function paintDecorPreviews(): void {
  for (const canvas of Array.from(panelBox.querySelectorAll('canvas[data-preview-animal]')) as HTMLCanvasElement[]) {
    const sp = species.find((x) => x.instances.some((i) => i.id === canvas.getAttribute('data-preview-animal')))
    const c = canvas.getContext('2d')
    if (!sp || !c) continue
    c.imageSmoothingEnabled = false
    const k = Math.max(1, Math.floor(44 / Math.max(sp.w, sp.h)))
    const ox = Math.floor((48 - sp.w * k) / 2)
    const oy = Math.floor((48 - sp.h * k) / 2)
    drawAnimal((x, y, w, h, color) => {
      c.fillStyle = color
      c.fillRect(ox + x * k, oy + y * k, w * k, h * k)
    }, sp, canvas.getAttribute('data-coat') ?? '', 'sit', 0, 'right')
  }
  for (const canvas of Array.from(panelBox.querySelectorAll('canvas[data-preview-variant]')) as HTMLCanvasElement[]) {
    const v = variants.get(canvas.getAttribute('data-preview-variant') ?? '')
    const c = canvas.getContext('2d')
    if (!v || !c) continue
    c.imageSmoothingEnabled = false
    c.clearRect(0, 0, 48, 48)
    const paintAt = (ox: number, oy: number, k = 1) => (x: number, y: number, w: number, h: number, color: string) => {
      c.fillStyle = color
      c.fillRect(ox + x * k, oy + y * k, w * k, h * k)
    }
    if (v.target === 'floor') for (let y = 0; y < 3; y += 1) for (let x = 0; x < 3; x += 1) paintSkinnedTile(paintAt(x * 16, y * 16), v, x, y)
    else if (v.target === 'wall') for (let x = 0; x < 3; x += 1) paintSkinnedTile(paintAt(x * 16, 16), v, x, 0)
    else if (decorTarget?.kind === 'item') {
      const item = decorTarget.item
      const w = item.w * 16
      const h = item.h * 16 + 20
      const k = Math.max(1, Math.floor(Math.min(48 / w, 48 / h)))
      paintSkinnedItem(paintAt(Math.floor((48 - w * k) / 2), Math.floor((48 - h * k) / 2), k), item, v, { screenOn: true }, 20)
    }
  }
}

function decorHighlights(): { x: number; y: number; w: number; h: number; color: string }[] {
  if (!decorating || !decorTarget || !world) return []
  if (decorTarget.kind === 'room') {
    const r = world.rooms.find((x) => x.id === (decorTarget as { room: string }).room)!
    return [{ x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2, color: P.working }]
  }
  if (decorTarget.kind === 'animal') {
    const id = decorTarget.id
    const v = zoo?.views(Date.now(), 0).find((a) => a.id === id)
    return v ? [{ x: Math.round(v.x), y: Math.round(v.y), w: 1, h: 1, color: P.working }] : []
  }
  const it = decorTarget.item
  return [{ x: it.x, y: it.y, w: it.w, h: it.h, color: P.working }]
}

// ── Pinning: «Закрепить» a bot to an office, a worker to a desk ──────────────────────────

/** The places one may pin to: offices for a bot, desks of «Команды и отделы» for a worker. */
function pinPlaces(kind: PinKind): DeskSeat[] {
  if (!world) return []
  if (kind === 'bots') return world.desks.filter(isBotPlace)
  const botDesks = new Set([...botDeskIds.values()].filter(Boolean))
  return world.desks.filter((d) => d.room === WORKER_ROOM && !botDesks.has(d.id))
}

/** Who sits where now, for the kind being pinned. */
function seatsOf(kind: PinKind): Map<string, string | null> {
  if (kind === 'bots') return botDeskIds
  return new Map(workers.map((w) => [w.id, workerSeats.get(w.id)?.id ?? null]))
}

function placeTitle(deskId: string | null): string {
  if (!deskId || !world) return 'без места'
  const desk = world.desks.find((d) => d.id === deskId)
  const room = desk && world.rooms.find((r) => r.id === desk.room)
  if (!desk || !room) return deskId
  return isBotPlace(desk) ? `«${room.label}»` : `стол ${deskId.split('.').pop()} в «${room.label}»`
}

function whoName(kind: PinKind, who: string): string {
  if (kind === 'bots') return bots?.find((b) => b.key === who)?.name ?? who
  return workers.find((w) => w.id === who)?.name ?? who
}

function pinChoices(): PinChoice[] {
  if (!pinning) return []
  const { kind, who } = pinning
  const seats = seatsOf(kind)
  return pinPlaces(kind).map((desk) => {
    const occupant = occupantOf(desk.id, seats, who)
    return {
      desk: desk.id,
      title: placeTitle(desk.id),
      mine: seats.get(who) === desk.id,
      occupant: occupant ? whoName(kind, occupant) : null,
      occupantPinned: occupant ? pins[kind][occupant] === desk.id : false
    }
  })
}

/** The tiles a pick covers: a whole office for a bot, a desk and its chair for a worker. */
function pickArea(kind: PinKind, desk: DeskSeat): { x: number; y: number; w: number; h: number } {
  if (kind === 'bots') {
    const room = world!.rooms.find((r) => r.id === desk.room)!
    return { x: room.x + 1, y: room.y + 1, w: room.w - 2, h: room.h - 2 }
  }
  return { x: desk.x, y: Math.min(desk.y, desk.seat.y), w: 2, h: 2 }
}

function pinHighlights(): { x: number; y: number; w: number; h: number; color: string }[] {
  if (!pinning || !world) return []
  const choices = new Map(pinChoices().map((c) => [c.desk, c]))
  return pinPlaces(pinning.kind).map((desk) => {
    const c = choices.get(desk.id)
    const color = c?.mine ? P.done : c?.occupant ? P.waiting : P.working
    return { ...pickArea(pinning!.kind, desk), color }
  })
}

/** A click on the map while pinning: the place under it, if it is one to pick. */
function pickAt(point: { x: number; y: number }): string | null {
  if (!pinning || !world) return null
  const tx = Math.floor(point.x / 16)
  const ty = Math.floor(point.y / 16)
  for (const desk of pinPlaces(pinning.kind)) {
    const a = pickArea(pinning.kind, desk)
    if (tx >= a.x && ty >= a.y && tx < a.x + a.w && ty < a.y + a.h) return desk.id
  }
  return null
}

function startPinning(kind: PinKind, who: string): void {
  pinning = { kind, who }
  pinConfirm = null
  updatePanel()
  updateHud()
  scheduler.invalidate()
}

function stopPinning(): void {
  if (!pinning) return
  pinning = null
  pinConfirm = null
  updatePanel()
  updateHud()
  scheduler.invalidate()
}

/** Picked a place: free (or already theirs) — pin; someone sits there — ask about a swap. */
function choosePlace(deskId: string): void {
  if (!pinning) return
  const { kind, who } = pinning
  const occupant = occupantOf(deskId, seatsOf(kind), who)
  if (occupant) {
    pinConfirm = { desk: deskId, occupant }
    updatePanel()
    return
  }
  pinning = null
  void savePins(pin(pins, kind, who, deskId))
}

function confirmSwap(): void {
  if (!pinning || !pinConfirm) return
  const { kind, who } = pinning
  const from = seatsOf(kind).get(who) ?? null
  const next = swap(pins, kind, who, pinConfirm.desk, pinConfirm.occupant, from)
  pinning = null
  pinConfirm = null
  void savePins(next)
}

/** The «Место» block of a bot's or a worker's panel. */
function placeView(kind: PinKind, who: string): PlaceView {
  const desk = seatsOf(kind).get(who) ?? null
  return { title: placeTitle(desk), pinned: !!desk && pins[kind][who] === desk, pinnedElsewhere: !!pins[kind][who] && pins[kind][who] !== desk, kind, note: storageNote }
}

/** Each worker's subagents as small figures by its desk, in the worker's own shirt (its mark). */
function traineeGroups(now: number): InternGroup[] {
  const out: InternGroup[] = []
  for (const w of workers) {
    const desk = workerSeats.get(w.id)
    if (!desk) continue
    const key = workerKey(w.id)
    const list = fx.internsOf(key).flatMap((id) => {
      const look = fx.internLook(id, now)
      return look ? [{ id: `${key}|${id}`, color: look.color, alpha: look.alpha, dy: look.dy, shirt: lookOf(looks.get(key), key, characters).shirt, parent: key }] : []
    })
    if (list.length) out.push({ key, seat: { x: desk.seat.x, y: desk.seat.y + 1 }, list })
  }
  return out
}

/** Desk labels of the workers in the office now: different even with a shared prefix. */
function shortName(name: string): string {
  return workerLabels(workers.map((w) => w.name)).get(name) ?? name
}

/** A parent bot's mark on its workers' desks: the colour of its outfit. */
function parentColor(key: string): string {
  return lookOf(looks.get(key), key, characters).shirt
}

/** On hover or selection of a worker: a solid line from its desk to its parent's desk. */
function parentLinks(): LinkView[] {
  const out: LinkView[] = []
  for (const key of new Set([hover, selected])) {
    if (!key?.startsWith('w:')) continue
    const w = workers.find((x) => workerKey(x.id) === key)
    const seat = w && seatsByKey.get(w.parentKey)
    const actor = cast.actors.get(key)
    if (!w || !seat || !actor) continue
    out.push({ a: { x: actor.x * 16 + 16, y: actor.y * 16 }, b: { x: seat.x * 16 + 16, y: seat.y * 16 }, alpha: 1, color: parentColor(w.parentKey), solid: true })
  }
  return out
}

function unknownAtEntrance(): boolean {
  return fx.envelopes.some((e) => e.from === 'outside' || e.to === 'outside') || [...fx.links.values()].some((l) => l.a === 'outside' || l.b === 'outside')
}

// ── Mail: envelopes, lines, journal ──────────────────────────────────────────────────────

function refOf(party: Party): EndRef {
  if (party.kind === 'bot') return `bot:${party.key}`
  if (party.kind === 'intern') return `intern:${party.key}:${party.workerId}`
  return 'outside'
}

/** Where a figure is now (tiles, fractional while it walks), or null. */
function actorAt(key: string): { x: number; y: number } | null {
  const a = cast.actors.get(key)
  if (!a) return null
  const next = a.path[0]
  return next ? { x: a.x + (next.x - a.x) * a.progress, y: a.y + (next.y - a.y) * a.progress } : { x: a.x, y: a.y }
}

/** Where an end of a mail is (art pixels): the bot or worker itself wherever it is, else its desk, else the entrance. */
function pointOf(ref: EndRef): { x: number; y: number } {
  const [kind, key, ...rest] = ref.split(':')
  const entrance = world?.spots.find((spot) => spot.kind === 'entrance') ?? world?.spots.find((spot) => spot.kind === 'owner-wait') ?? null
  if (kind === 'intern') {
    const worker = actorAt(workerKey(rest.join(':')))
    if (worker) return { x: worker.x * 16 + 16, y: worker.y * 16 }
  }
  if (kind === 'bot' || kind === 'intern') return mailPoint(actorAt(key), seatsByKey.get(key) ?? null, entrance, 'bot')
  return mailPoint(null, null, entrance, 'outside')
}

function linkViews(): LinkView[] {
  const now = Date.now()
  return [...fx.links.values()].map((link) => ({ a: pointOf(link.a), b: pointOf(link.b), alpha: linkAlpha(link, now), color: mailColor(link.type) }))
}

function envelopeViews(): EnvelopeView[] {
  const now = Date.now()
  const out: EnvelopeView[] = []
  for (const env of fx.envelopes) {
    const at = envelopeAt(env, pointOf(env.from), pointOf(env.to), now)
    if (at) out.push({ ...at, color: mailColor(env.type) })
  }
  return out
}

function onMail(fresh: Mail): void {
  mail = fresh
  const now = Date.now()
  // Oldest first, so lines and the follow target end on the latest message.
  for (const entry of [...fresh.entries].reverse()) {
    if (seenMail.has(entry.id)) continue
    seenMail.add(entry.id)
    const from = refOf(entry.from)
    const to = refOf(entry.to)
    const animate = entry.at !== null && entry.at >= openedAt - 20_000
    fx.addMail(entry, from, to, pointOf(from), pointOf(to), now, animate)
    if (animate) {
      follow.event(pointOf(to))
      // A letter is a real event: the sender stops its routine for a moment; the recipient
      // will stop and read it when it lands (see the timer step).
      if (entry.from.kind === 'bot') life?.interrupt(entry.from.key, now, READ_MS)
    }
  }
  retarget()
  updateJournal()
  scheduler.invalidate()
  scheduler.wake()
}

async function loadMail(): Promise<void> {
  try {
    onMail(await orca.plugin.request('office.mail', undefined, { timeoutMs: 60_000 }))
  } catch {
    // No mail: the journal says so.
  }
}

function partyName(party: Party): string {
  if (party.kind === 'outside') return 'вход (адрес не опознан)'
  const bot = bots?.find((b) => b.key === party.key)
  const name = bot?.name ?? party.key
  if (party.kind === 'bot') return name
  const intern = extras?.bots[party.key]?.interns?.find((i) => i.id === party.workerId)
  return `${intern?.name ?? 'сотрудник'} (сотрудник ${name})`
}

function clock(at: number | null): string {
  if (at === null) return 'до открытия'
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function updateJournal(): void {
  journalButton.textContent = mail?.entries.length ? `Журнал · ${mail.entries.length}` : 'Журнал'
  if (!journalOpen) return
  const rows = (mail?.entries ?? []).map(
    (e: MailEntry) =>
      `<div data-id="${escapeHtml(e.id)}" style="padding:4px 0;border-bottom:1px solid #ffffff14;cursor:pointer">` +
      `<span style="opacity:.6">${clock(e.at)}</span> · ${escapeHtml(partyName(e.from))} → ${escapeHtml(partyName(e.to))} · ` +
      `<span style="color:${mailColor(e.type)}">${escapeHtml(typeName(e.type))}</span>` +
      (e.subject ? `<div data-field="subject" style="opacity:.75">${escapeHtml(e.subject)}</div>` : '') +
      `</div>`
  )
  journalBox.innerHTML =
    `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b>Журнал офиса</b><button data-act="close" style="${buttonCss}">✕</button></div>` +
    `<div style="font-size:11px;opacity:.6;margin-bottom:6px">Последние 50 сообщений между ботами: только кто, кому, тип и тема. Время — когда офис их увидел (Orca не отдаёт время без тела письма). Клик ведёт камеру к отправителю.</div>` +
    (mail?.error ? `<div style="color:${P.waiting}">CLI: ${escapeHtml(mail.error)}</div>` : '') +
    (rows.length ? rows.join('') : '<div style="opacity:.6">сообщений нет</div>')
}

/** The envelope or line under a world point: «кто → кому · тип · тема», and unknown addresses. */
function mailUnder(point: { x: number; y: number }): string[] | null {
  const now = Date.now()
  const describe = (entryId: string) => {
    const e = mail?.entries.find((x) => x.id === entryId)
    if (!e) return null
    const unknown = [e.from, e.to].filter((p): p is Extract<Party, { kind: 'outside' }> => p.kind === 'outside').map((p) => p.address)
    return mailTooltip({ from: partyName(e.from), to: partyName(e.to), type: e.type, subject: e.subject, unknown })
  }
  const envs = fx.envelopes.map((env) => ({ id: env.id, at: envelopeAt(env, pointOf(env.from), pointOf(env.to), now) })).filter((e) => e.at)
  const hitEnv = hitPoint(envs.map((e) => e.at!), point, 8)
  if (hitEnv >= 0) return describe(envs[hitEnv].id)
  const links = [...fx.links.values()]
  const hitLink = hitSegment(links.map((l) => ({ a: pointOf(l.a), b: pointOf(l.b) })), point, 4)
  return hitLink >= 0 ? describe(links[hitLink].entryId) : null
}

function toggleLegend(): void {
  legendOpen = !legendOpen
  legendBox.style.display = legendOpen ? 'block' : 'none'
  legendBox.innerHTML =
    `<div style="display:flex;justify-content:space-between"><b>Легенда</b><span style="opacity:.6">клик по «Легенда» — свернуть</span></div>` +
    LEGEND_TYPES.map((t) => `<div><span style="display:inline-block;width:10px;height:10px;background:${mailColor(t)};margin-right:6px"></span>${escapeHtml(typeName(t))} (${t})</div>`).join('') +
    `<div style="margin-top:6px">✉ конверт летит от отправителя к адресату, цвет — тип письма.</div>` +
    `<div>┄ пунктир — была переписка, гаснет за 10 минут.</div>` +
    `<div>━ сплошная — сотрудник и его бот (при наведении или выборе сотрудника).</div><div>Маленькие фигурки у стола сотрудника — его стажёры (субагенты), пока работают.</div>` +
    `<div>? у входа (правый конец коридора) — адрес не опознан: Run без писем координатора, чужой компьютер, сама Orca.</div>` +
    `<div style="margin-top:6px;opacity:.7">Наведите на конверт или линию — подсказка «кто → кому · тип · тема».</div>`
}

function toggleJournal(): void {
  journalOpen = !journalOpen
  journalBox.style.display = journalOpen ? 'block' : 'none'
  updateJournal()
}

journalBox.addEventListener('click', (event) => {
  const target = event.target as HTMLElement
  if (target.closest('[data-act="close"]')) return toggleJournal()
  const id = target.closest('[data-id]')?.getAttribute('data-id')
  const entry = mail?.entries.find((e) => e.id === id)
  if (!entry || !renderer) return
  const point = pointOf(refOf(entry.from))
  moveCamera(clampCamera({ ...camera, x: point.x, y: point.y, zoom: Math.max(camera.zoom, 3) }, view, renderer.size))
})

// ── Follow ───────────────────────────────────────────────────────────────────────────────

function toggleFollow(): void {
  const on = follow.toggle()
  updateFollowButton()
  if (on) {
    // Start from the latest real event: the newest message's recipient.
    const latest = mail?.entries.find((e) => e.at !== null)
    if (latest) follow.event(pointOf(refOf(latest.to)))
    scheduler.wake()
  }
}

function updateFollowButton(): void {
  followButton.textContent = follow.on ? 'Следить: вкл' : 'Следить: выкл'
  followButton.style.background = follow.on ? P.working : P.tag
  followButton.style.color = follow.on ? P.ink : P.tagText
}

/** Any input of the owner takes the camera back. */
function stopFollow(): void {
  if (follow.interrupt()) updateFollowButton()
}

// ── Panel ────────────────────────────────────────────────────────────────────────────────

function openPanel(key: string): void {
  if (selected !== key) {
    selected = key
    editingLook = null
    void loadChat(key)
  }
  updatePanel()
  scheduler.invalidate()
}

function closePanel(): void {
  if (!selected) return
  selected = null
  editingLook = null
  // The chat text lives only while its panel is open.
  chat = null
  panelBox.innerHTML = ''
  updatePanel()
  scheduler.invalidate()
}

async function loadChat(key: string): Promise<void> {
  chat = 'loading'
  updatePanel()
  let answer: ChatAnswer
  try {
    answer = await orca.plugin.request('office.chat', { key }, { timeoutMs: 20_000 })
  } catch {
    answer = { ok: false, reason: 'нет данных' }
  }
  if (selected === key) {
    chat = answer
    updatePanel()
  }
}

function updatePanel(): void {
  if (decorating && !editingLook) {
    panelBox.style.display = 'block'
    controls.style.right = '362px'
    hint.style.display = 'none'
    panelBox.innerHTML = decorPanelHtml()
    paintDecorPreviews()
    return
  }
  if (pinning && selected !== (pinning.kind === 'bots' ? pinning.who : `w:${pinning.who}`)) {
    pinning = null
    pinConfirm = null
  }
  if (pinning) {
    panelBox.style.display = 'block'
    controls.style.right = '362px'
    hint.style.display = 'none'
    const name = whoName(pinning.kind, pinning.who)
    if (pinConfirm) {
      const from = seatsOf(pinning.kind).get(pinning.who) ?? null
      panelBox.innerHTML = renderPinConfirm({
        name,
        place: placeTitle(pinConfirm.desk),
        occupant: whoName(pinning.kind, pinConfirm.occupant),
        occupantPinned: pins[pinning.kind][pinConfirm.occupant] === pinConfirm.desk,
        from: from ? placeTitle(from) : null
      })
    } else panelBox.innerHTML = renderPinPicker(pinning.kind, name, pinChoices())
    return
  }
  if (selected === 'overflow' || selected?.startsWith('w:')) {
    panelBox.style.display = 'block'
    controls.style.right = '362px'
    if (editingLook && editingLook === selected) {
      hint.style.display = 'none'
      const worker = workers.find((w) => workerKey(w.id) === selected)
      panelBox.innerHTML = renderAppearanceEditor(worker ? shortName(worker.name) : selected.slice(2), looks.get(selected), lookSaved, { characters: [...characters.values()], worker: true })
      paintPreview(selected)
      return
    }
    hint.style.display = 'none'
    if (selected === 'overflow') {
      panelBox.innerHTML = renderOverflow(workerOverflow.map((id) => workerView(id)).filter((v): v is NonNullable<typeof v> => v !== null))
      return
    }
    const view = workerView(selected.slice(2))
    if (view) panelBox.innerHTML = renderWorkerPanel(view) + renderPlace(placeView('workers', view.id))
    else closePanel()
    return
  }
  const bot = selected ? bots?.find((b) => b.key === selected) : undefined
  if (!bot) {
    panelBox.style.display = 'none'
    controls.style.right = '10px'
    hint.style.display = canvas.clientWidth < 1150 ? 'none' : 'block'
    if (selected && bots) selected = null
    return
  }
  panelBox.style.display = 'block'
  controls.style.right = '362px'
  hint.style.display = 'none'
  if (editingLook === bot.key) {
    // Typing the plate: do not rebuild the form under the cursor.
    if (panelBox.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT') return
    panelBox.innerHTML = renderAppearanceEditor(bot.name, looks.get(bot.key), lookSaved, { characters: [...characters.values()], worker: false })
    paintPreview(bot.key)
    return
  }
  panelBox.innerHTML = renderPanel(buildPanel(bot, extras, chat, Date.now()), renderPlace(placeView('bots', bot.key)))
}

/** What the worker panel shows: only real data from the CLI. */
function workerView(id: string) {
  const w = workers.find((x) => x.id === id)
  if (!w) return null
  const parent = bots?.find((b) => b.key === w.parentKey)
  const rule = { working: 'работает', blocked: 'ждёт разрешения', waiting: 'ждёт ответа', done: 'закончил', idle: 'простаивает', unknown: 'нет данных' }[w.state]
  const leaves = !w.live ? ` · уйдёт через ${formatDuration(Math.max(0, WORKER_LINGER_MS - (Date.now() - (w.since ?? firstSeenDone.get(w.id) ?? Date.now()))))}` : ''
  return {
    id: w.id,
    name: w.name,
    parentKey: w.parentKey,
    parentName: parent?.name ?? w.parentKey,
    parentColor: parentColor(w.parentKey),
    agent: w.agent ?? 'нет данных',
    state: rule + leaves,
    color: internColor(w.state),
    since: w.since === null ? null : formatDuration(Date.now() - w.since),
    seated: workerSeats.has(w.id)
  }
}

/** The editor's preview: the bot facing us, from the side and sitting with its back to us. */
function paintPreview(key: string): void {
  const canvas = panelBox.querySelector('canvas[data-preview]') as HTMLCanvasElement | null
  const c = canvas?.getContext('2d')
  if (!canvas || !c) return
  c.imageSmoothingEnabled = false
  c.fillStyle = P.wood
  c.fillRect(0, 0, canvas.width, canvas.height)
  const look = lookOf(looks.get(key), key, characters)
  const at = (ox: number, oy: number) => (x: number, y: number, w: number, h: number, color: string) => {
    c.fillStyle = color
    c.fillRect(ox + x, oy + y, w, h)
  }
  drawCharacter(at(12, 14), look, 'walk', 'down', 0)
  drawCharacter(at(40, 14), look, 'walk', 'right', 1)
  drawCharacter(at(68, 14), look, 'wait', 'up', 0)
}

async function saveLook(key: string, next: Appearance): Promise<void> {
  lookSaved = await looks.save(key, next)
  scheduler.invalidate()
}

panelBox.addEventListener('input', (event) => {
  const input = event.target as HTMLInputElement
  if (!editingLook || input.getAttribute('data-field') !== 'plate') return
  void saveLook(editingLook, { ...looks.get(editingLook), plate: cleanPlate(input.value) })
})

panelBox.addEventListener('click', async (event) => {
  const action = (event.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act')
  if (!action || (!selected && !decorating)) return
  const el = (event.target as HTMLElement).closest('[data-act]')!
  if (action === 'decorClose') toggleDecorating()
  else if (action === 'animalPick') {
    decorTarget = { kind: 'animal', id: el.getAttribute('data-id') ?? '' }
    updatePanel()
  } else if (action === 'animalToggle') {
    const id = el.getAttribute('data-id') ?? ''
    const cur = animalChoices[id] ?? {}
    void saveAnimals({ ...animalChoices, [id]: cur.off ? { ...(cur.coat ? { coat: cur.coat } : {}) } : { ...cur, off: true } })
  } else if (action === 'animalCoat') {
    const id = el.getAttribute('data-id') ?? ''
    void saveAnimals({ ...animalChoices, [id]: { ...(animalChoices[id] ?? {}), coat: el.getAttribute('data-coat') ?? '' } })
  }
  else if (action === 'decorPick' || action === 'decorReset') {
    const variant = action === 'decorPick' ? el.getAttribute('data-variant') : null
    const part = el.getAttribute('data-part')
    if (decorTarget?.kind === 'room' && (part === 'floor' || part === 'wall')) void saveDecor(chooseRoom(decor, decorTarget.room, part, variant))
    else if (decorTarget?.kind === 'item') void saveDecor(chooseItems(decor, [itemKey(decorTarget.item)], variant))
  } else if (action === 'decorAll' && decorTarget?.kind === 'item') {
    const type = decorTarget.item.type
    void saveDecor(chooseItems(decor, dressable().filter((f) => f.type === type).map(itemKey), decor.items[itemKey(decorTarget.item)] ?? null))
  } else if (!selected) return
  else if (action === 'close') closePanel()
  else if (action === 'pin') startPinning(selected.startsWith('w:') ? 'workers' : 'bots', selected.startsWith('w:') ? selected.slice(2) : selected)
  else if (action === 'unpin') {
    const kind: PinKind = selected.startsWith('w:') ? 'workers' : 'bots'
    void savePins(unpin(pins, kind, kind === 'workers' ? selected.slice(2) : selected))
  } else if (action === 'pinTo') choosePlace(el.getAttribute('data-desk') ?? '')
  else if (action === 'pinSwap') confirmSwap()
  else if (action === 'pinBack') {
    pinConfirm = null
    updatePanel()
  } else if (action === 'pinCancel') stopPinning()
  else if (action === 'parent' || action === 'pick') {
    const key = el.getAttribute('data-key') ?? ''
    openPanel(key)
    const actor = cast.actors.get(key)
    if (actor && renderer) moveCamera(clampCamera({ ...camera, x: actor.x * 16 + 8, y: actor.y * 16, zoom: Math.max(camera.zoom, 3) }, view, renderer.size))
  } else if (action === 'openWorker') {
    const result = await orca.plugin.request('office.openWorker', { id: el.getAttribute('data-id') ?? '' }).catch(() => ({ opened: false, reason: 'нет связи с воркером' }))
    if (!result.opened) showNotice(`Не удалось открыть воркспейс: ${result.reason ?? 'ошибка'}`)
  }
  else if (action === 'appearance') {
    editingLook = selected
    updatePanel()
  } else if (action === 'back') {
    editingLook = null
    updatePanel()
  } else if (action === 'set' && editingLook) {
    const button = (event.target as HTMLElement).closest('[data-act]')!
    const field = button.getAttribute('data-field') as keyof Appearance
    const raw = button.getAttribute('data-value') ?? ''
    const value = field === 'accessory' || field === 'character' || field === 'coat' ? raw : Number(raw)
    // Another character starts in its own first coat.
    const coat = field === 'character' ? { coat: '' } : {}
    await saveLook(editingLook, { ...looks.get(editingLook), [field]: value, ...coat } as Appearance)
    updatePanel()
  } else if (action === 'reset' && editingLook) {
    lookSaved = await looks.reset(editingLook)
    scheduler.invalidate()
    updatePanel()
  } else if (action === 'chat') void loadChat(selected)
  else if (action === 'open') {
    const result = await orca.plugin.request('office.openBot', { key: selected }).catch(() => ({ opened: false, reason: 'нет связи с воркером' }))
    if (!result.opened) showNotice(`Не удалось открыть бота: ${result.reason ?? 'ошибка'}`)
  }
})

async function loadExtras(): Promise<void> {
  try {
    extras = await orca.plugin.request('office.extras', undefined, { timeoutMs: 90_000 })
  } catch {
    // The office works without them: the panel says «нет данных».
  }
  afterExtras()
}

function afterExtras(): void {
  // Needs you and workers change places: re-plan with the new data. The first answer completes the
  // picture the tab opened with, so it is placed without walking; changes after it walk.
  apply()
  settled = true
  updatePanel()
  scheduler.invalidate()
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr))
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  view = { width, height }
  // In a narrow tab the hint would sit on the zoom buttons.
  hint.style.display = canvas.clientWidth < 1150 ? 'none' : 'block'
  // The dev harness may aim the camera (`__pixelOfficeCamera`, art pixels), Orca never does.
  const aimed = (globalThis as { __pixelOfficeCamera?: Camera }).__pixelOfficeCamera
  if (renderer && aimed && !userMoved) {
    camera = clampCamera(aimed, view, renderer.size)
    userMoved = true
  } else if (renderer) camera = userMoved ? clampCamera(camera, view, renderer.size) : fitCamera(view, renderer.size)
  zoomLabel.textContent = `${camera.zoom}×`
  scheduler.invalidate()
}

function moveCamera(next: Camera): void {
  stopFollow()
  if (next.x === camera.x && next.y === camera.y && next.zoom === camera.zoom) return
  camera = next
  userMoved = true
  zoomLabel.textContent = `${camera.zoom}×`
  scheduler.invalidate()
  updateTooltip()
}

/** The world point a series of zoom steps started from, while the pointer stays put. */
let zoomAnchor: { sx: number; sy: number; world: { x: number; y: number }; at: number } | null = null

function zoomBy(steps: number, at?: { x: number; y: number }): void {
  stopFollow()
  if (!renderer) return
  const point = at ?? { x: view.width / 2, y: view.height / 2 }
  const now = Date.now()
  if (!zoomAnchor || zoomAnchor.sx !== point.x || zoomAnchor.sy !== point.y || now - zoomAnchor.at > 1500) {
    zoomAnchor = { sx: point.x, sy: point.y, world: screenToWorld(camera, view, point.x, point.y), at: now }
  }
  zoomAnchor.at = now
  moveCamera(zoomAt(camera, camera.zoom + steps, point.x, point.y, view, renderer.size, zoomAnchor.world))
}

function fit(): void {
  stopFollow()
  if (!renderer) return
  camera = fitCamera(view, renderer.size)
  userMoved = false
  zoomLabel.textContent = `${camera.zoom}×`
  scheduler.invalidate()
}

// ── HUD, tooltip, notices ────────────────────────────────────────────────────────────────

function updateHud(): void {
  const list = bots ?? []
  const busy = list.filter((bot) => bot.state === 'working').length
  const needs = list.filter((bot) => bot.state === 'blocked' || bot.state === 'waiting').length
  const rows = [`<b>${escapeHtml(world?.name ?? 'Pixel Office')}</b> <span style="opacity:.7">· ${daylight.look.label} · ${escapeHtml(theme.name)}</span>`, `🟢 ${working(busy)}${needs ? ` · 🟡 ${needs} ждут овнера` : ''} · ботов: ${list.length}`]
  if (list.length === 0 && bots) rows.push('Ботов не видно')
  pinBanner.style.display = pinning || decorating ? 'block' : 'none'
  if (decorating) pinBanner.textContent = '🎨 Оформление: кликните по комнате, предмету или человечку · Esc — выйти'
  if (pinning) pinBanner.textContent = `📌 ${whoName(pinning.kind, pinning.who)}: кликните по ${pinning.kind === 'bots' ? 'кабинету' : 'столу'} на карте или выберите в панели · Esc — отмена`
  if (animalErrors.length) rows.push(`<span style="color:${P.waiting}">животные: ${animalErrors.length} ошибк. (Shift+D)</span>`)
  if (themeErrors.length) rows.push(`<span style="color:${P.waiting}">пакеты скинов: ${themeErrors.length} ошибк. (Shift+D)</span>`)
  hud.innerHTML = rows.join('<br>')
}

function updateTooltip(): void {
  const showTip = () => {
    const r = window.devicePixelRatio || 1
    tooltip.style.display = 'block'
    tooltip.style.left = `${Math.min(pointer!.x / r + 14, window.innerWidth - 330)}px`
    tooltip.style.top = `${pointer!.y / r + 14}px`
  }
  if (pointer && hover?.startsWith('w:')) {
    const v = workerView(hover.slice(2))
    if (v) {
      tooltip.innerHTML = `<b>${escapeHtml(v.name)}</b> <span style="opacity:.7">сотрудник ${escapeHtml(v.parentName)}</span><br><span style="color:${v.color}">● ${escapeHtml(v.state)}</span><br>агент: ${escapeHtml(v.agent)}`
      return showTip()
    }
  }
  if (pointer && !hover && mailHover) {
    tooltip.innerHTML = mailHover.map((line, i) => (i === 0 ? `<b>${escapeHtml(line)}</b>` : `<span style="opacity:.8">${escapeHtml(line)}</span>`)).join('<br>')
    return showTip()
  }
  const bot = hover ? bots?.find((b) => b.key === hover) : undefined
  if (!bot || !pointer) {
    tooltip.style.display = 'none'
    return
  }
  const rule = ruleFor(bot.state, signals(bot))
  const since = bot.since === null ? '' : ` · ${formatDuration(Date.now() - bot.since)}`
  const target = targets.get(bot.key)
  const place = target?.doing ?? (target?.place === 'desk' ? placeTitle(target.slot.slice(5)) : target ? placeName(target.place) : '')
  tooltip.innerHTML = [
    `<b>${escapeHtml(bot.name)}</b>${bot.role ? ` <span style="opacity:.7">${escapeHtml(bot.role)}</span>` : ''}`,
    `<span style="color:${STATE_COLOR[bot.state]}">● ${rule.label}${since}</span>`,
    `агент: ${bot.agents.length ? escapeHtml(bot.agents.join(', ')) : '—'}`,
    place ? `<span style="opacity:.7">${escapeHtml(place)}</span>` : ''
  ]
    .filter(Boolean)
    .join('<br>')
  tooltip.style.display = 'block'
  const dpr = window.devicePixelRatio || 1
  tooltip.style.left = `${Math.min(pointer.x / dpr + 14, window.innerWidth - 300)}px`
  tooltip.style.top = `${pointer.y / dpr + 14}px`
}

function placeName(place: string): string {
  return { 'owner-wait': 'в приёмной у двери CEO', sofa: 'диван', kitchen: 'кухня', standby: 'без свободного стола' }[place] ?? place
}

function showNotice(text: string): void {
  notice.textContent = text
  notice.style.display = 'block'
}

function hideNotice(): void {
  notice.style.display = 'none'
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

async function toggleDebug(): Promise<void> {
  debugOn = !debugOn
  debugBox.style.display = debugOn ? 'block' : 'none'
  if (!debugOn) return
  try {
    const info: OfficeDebug = await orca.plugin.request('office.debug')
    lastEvent = info.lastEvent ? `${info.lastEvent.workspaceId} → ${info.lastEvent.state}` : 'нет'
  } catch (error) {
    lastEvent = `debug: ${(error as { code?: string }).code ?? String(error)}`
  }
  updateDebug()
}

function updateDebug(): void {
  debugBox.textContent = [
    `кадров ${scheduler.renders} · тиков ${scheduler.ticks} · таймер ${scheduler.running ? 'идёт' : 'стоит'} · чанков ${renderer?.chunkCount ?? 0}`,
    `камера ${camera.zoom}× (${Math.round(camera.x)},${Math.round(camera.y)}) · идут ${cast.walking()}`,
    ...(bots ?? []).map((b) => `${b.key}: ${b.state} → ${targets.get(b.key)?.slot ?? '—'}`),
    `последнее событие: ${lastEvent}`,
    `живность: ${ambientWanted() ? 'в кадре' : 'нет'}${reducedMotion ? ' · reduce motion' : ''} · жизнь: ${lifeOn ? 'вкл' : 'выкл'}, на рутине ${[...targets.values()].filter((t) => t.routine).length}`,
    `места: закреплено ботов ${Object.keys(pins.bots).length}, сотрудников ${Object.keys(pins.workers).length}; запомнено ${Object.keys(botMemory).length}${storageNote ? ' · ' + storageNote : ''}`,
    ...themeErrors,
    ...animalErrors
  ].join('\n')
}

// ── Input ────────────────────────────────────────────────────────────────────────────────

const zoomSteps = new ZoomAccumulator()

/** The pointer in canvas device pixels. */
function devicePoint(event: MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  return { x: (event.clientX - rect.left) * dpr, y: (event.clientY - rect.top) * dpr }
}
let drag: { x: number; y: number; id: number } | null = null
/** Where the button went down: a release near it is a click, not a drag. */
let pressAt: { x: number; y: number } | null = null

canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    stopFollow()
    if (!renderer) return
    const dpr = window.devicePixelRatio || 1
    if (event.ctrlKey || event.metaKey) {
      // A trackpad pinch arrives as ctrl+wheel with small deltas; a mouse notch as one big one.
      const unit = event.deltaMode === 1 ? 40 : 1
      const steps = zoomSteps.push(event.deltaY * unit * (event.ctrlKey && !event.metaKey ? 4 : 1))
      if (steps) zoomBy(steps, devicePoint(event))
      return
    }
    const unit = event.deltaMode === 1 ? 16 : 1
    moveCamera(panBy(camera, -event.deltaX * unit * dpr, -event.deltaY * unit * dpr, view, renderer.size))
  },
  { passive: false }
)

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 && event.button !== 1) return
  stopFollow()
  drag = { x: event.clientX, y: event.clientY, id: event.pointerId }
  pressAt = { x: event.clientX, y: event.clientY }
  try {
    canvas.setPointerCapture(event.pointerId)
  } catch {
    // Synthetic pointers (tests) cannot be captured; dragging still works inside the canvas.
  }
  canvas.style.cursor = 'grabbing'
})

canvas.addEventListener('pointermove', (event) => {
  const dpr = window.devicePixelRatio || 1
  pointer = devicePoint(event)
  if (drag && renderer) {
    const dx = (event.clientX - drag.x) * dpr
    const dy = (event.clientY - drag.y) * dpr
    drag.x = event.clientX
    drag.y = event.clientY
    moveCamera(panBy(camera, dx, dy, view, renderer.size))
    return
  }
  if (!renderer) return
  const point = screenToWorld(camera, view, pointer.x, pointer.y)
  const next = renderer.hit(cast.views(), point.x, point.y)
  mailHover = next ? null : mailUnder(point)
  if (next !== hover) {
    hover = next
    canvas.style.cursor = hover ? 'pointer' : 'grab'
    scheduler.invalidate()
  }
  updateTooltip()
})

const endDrag = (event: PointerEvent) => {
  if (!drag || drag.id !== event.pointerId) return
  drag = null
  canvas.style.cursor = hover ? 'pointer' : 'grab'
  const start = pressAt
  pressAt = null
  if (event.type !== 'pointerup' || !start || !renderer) return
  if (Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y) > 5) return
  // A click: on a bot opens its panel, on an empty place closes it.
  const point = devicePoint(event)
  const world = screenToWorld(camera, view, point.x, point.y)
  if (decorating) {
    // «Оформление»: a person opens its look; a thing or a room its skins.
    const pet = zoo ? renderer.hitAnimal(zoo.views(Date.now(), 0), world.x, world.y) : null
    const who = pet ? null : renderer.hit(cast.views(), world.x, world.y)
    if (pet) {
      editingLook = null
      decorTarget = { kind: 'animal', id: pet }
    } else if (who) {
      // Bots and employees alike; trainees wear their employee's look.
      selected = who
      editingLook = who
    } else {
      editingLook = null
      decorTarget = decorAt(world)
    }
    updatePanel()
    scheduler.invalidate()
    return
  }
  if (pinning) {
    // Picking a place: a click on an office (or a desk) chooses it; elsewhere does nothing.
    const desk = pickAt(world)
    if (desk) choosePlace(desk)
    return
  }
  const key = renderer.hit(cast.views(), world.x, world.y)
  if (key) openPanel(key)
  else closePanel()
}
canvas.addEventListener('pointerup', endDrag)
canvas.addEventListener('pointercancel', endDrag)
canvas.addEventListener('pointerleave', () => {
  pointer = null
  if (hover) {
    hover = null
    scheduler.invalidate()
  }
  updateTooltip()
})

window.addEventListener('keydown', (event) => {
  if (!event.metaKey && !event.ctrlKey && !event.altKey) stopFollow()
  if (event.key === 'Escape' && decorating) {
    if (editingLook) {
      editingLook = null
      updatePanel()
    } else toggleDecorating()
    return
  }
  if (event.key === 'Escape' && pinning) {
    stopPinning()
    updateHud()
    return
  }
  if (event.key === 'Escape' && selected) {
    closePanel()
    return
  }
  if (event.shiftKey && (event.key === 'D' || event.key === 'd')) {
    void toggleDebug()
    return
  }
  if (!renderer) return
  const step = 48 * camera.zoom
  const pans: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
  if (event.key in pans) {
    const [dx, dy] = pans[event.key]
    moveCamera(panBy(camera, dx, dy, view, renderer.size))
  } else if (event.key === '+' || event.key === '=') zoomBy(1)
  else if (event.key === '-' || event.key === '_') zoomBy(-1)
  else if (event.key === 'f' || event.key === 'F' || event.key === '0') fit()
  else return
  event.preventDefault()
})

new ResizeObserver(resize).observe(canvas)

// ── Start ────────────────────────────────────────────────────────────────────────────────

orca.plugin.on('office.desks', show)
orca.plugin.on('office.extras', (fresh) => {
  extras = fresh
  afterExtras()
})
orca.plugin.on('office.mail', onMail)
resize()
updateHud()
// The file's text is unused, but asking for it tells Orca the editor is ready.
void orca.document?.get()
try {
  await loadOffice()
} catch (error) {
  showNotice((error as Error).message)
}
try {
  show(await orca.plugin.request('office.desks'))
} catch (error) {
  const code = (error as { code?: string }).code ?? 'error'
  showNotice(`Нет связи с воркером плагина (${code})`)
}
// Workers and items: now, then at most every 30 s while this tab is open (the worker reads the
// CLI only when its cache is older than that).
// Mail every 15 s, workers and items every 30 s, only while this tab is open; the worker reads
// the CLI only when its own cache is older than that. The same tick lets the lines fade.
void loadExtras()
void loadMail()
let dataTicks = 0
setInterval(() => {
  dataTicks += 1
  // The time of day: checked at most once a minute (Daylight.check), redrawn only when it changes.
  if (daylight.check()) applyLook()
  void loadMail()
  if (dataTicks % 2 === 0) void loadExtras()
  scheduler.invalidate()
}, 15_000)
