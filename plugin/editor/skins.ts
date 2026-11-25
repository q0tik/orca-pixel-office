// Skin packs: data, not code. A pack is one JSON file in office/skins/ (listed in index.json): a
// manifest, an optional theme (palette, floors, furniture choices: «Дневной офис», «Тёмный лофт»),
// characters for people (editor/characters.ts) and variants the owner can pick in «Оформление»
// for a room's floor or walls or for one piece of furniture. A variant is either a recolour of a built-in picture (palette overrides, optionally on
// another built-in variant) or a sprite: rows of characters with a legend of colours. A bad pack
// or a bad variant is reported line by line and skipped; the office never breaks on it.
import { FLOORS, FURNITURE, WALLS, isFurnitureType, type FloorKind, type FurnitureType, type WallStyle } from '../engine/catalog'
import type { PlacedFurniture } from '../engine/world'
import { BASE_PALETTE, P, type PaletteKey } from './palette'
import { parseTheme, type Theme } from './theme'
import type { Paint } from './art'
import { parseCharacters, type CharacterSkin } from './characters'

export const SKIN_FORMAT = 1
export const DECOR_STORAGE_KEY = 'decor'

export type Sprite = { w: number; h: number; legend: Record<string, string>; rows: string[] }

/** What a variant dresses: a room's floor or walls, or one kind of furniture. */
export type SkinTarget = 'floor' | 'wall' | FurnitureType

export type SkinVariant = {
  /** `<pack>:<id>`; built-in ones are `builtin:<target>:<base>`. */
  id: string
  name: string
  target: SkinTarget
  pack: string
  /** The built-in picture to start from: a floor kind, a wall style or a furniture variant. */
  base?: string
  palette?: Partial<Record<PaletteKey, string>>
  sprite?: Sprite
}

export type SkinPack = { id: string; name: string; author: string; license: string; theme: Theme | null; variants: SkinVariant[]; characters: CharacterSkin[] }

const COLOR = /^#[0-9a-f]{6}$/i
const ID = /^[a-z0-9][a-z0-9-]*$/
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

const FLOOR_NAMES: Record<FloorKind, string> = {
  wood: 'Дерево',
  parquet: 'Паркет',
  'carpet-red': 'Красный ковролин',
  'carpet-blue': 'Синий ковролин',
  'carpet-green': 'Зелёный ковролин',
  tile: 'Плитка',
  concrete: 'Бетон',
  marble: 'Мрамор',
  raised: 'Фальшпол'
}
const WALL_NAMES: Record<WallStyle, string> = { plain: 'Светлая штукатурка', navy: 'Тёмно-синие', stripes: 'Обои в полоску', rose: 'Розовые', sage: 'Шалфей', bare: 'Голая штукатурка' }
/** Built-in pictures a piece of furniture can switch between (its `variant` in the map). */
const BUILTIN_ITEMS: Partial<Record<FurnitureType, [string, string][]>> = {
  rug: [
    ['red', 'Красный'],
    ['blue', 'Синий'],
    ['cream', 'Кремовый']
  ],
  plant: [
    ['', 'Куст'],
    ['cactus', 'Кактус']
  ],
  'big-plant': [
    ['', 'Куст'],
    ['cactus', 'Кактус']
  ],
  desk: [
    ['', 'Обычный'],
    ['multi', 'Три монитора'],
    ['phone', 'С телефоном'],
    ['tidy', 'Аккуратный, с ежедневником'],
    ['boxed', 'С коробкой']
  ],
  whiteboard: [
    ['', 'Заметки'],
    ['arch', 'Схема архитектуры']
  ]
}

/** What ships in the code itself: every floor, every wall style, the furniture's own variants. */
export function builtinVariants(): SkinVariant[] {
  const out: SkinVariant[] = []
  for (const f of FLOORS) out.push({ id: `builtin:floor:${f}`, name: FLOOR_NAMES[f], target: 'floor', pack: 'builtin', base: f })
  for (const w of WALLS) out.push({ id: `builtin:wall:${w}`, name: WALL_NAMES[w], target: 'wall', pack: 'builtin', base: w })
  for (const [type, list] of Object.entries(BUILTIN_ITEMS) as [FurnitureType, [string, string][]][]) {
    for (const [base, name] of list) out.push({ id: `builtin:${type}:${base || 'plain'}`, name, target: type, pack: 'builtin', base })
  }
  return out
}

/** Sprite limits per target: a floor tile is 16×16; furniture fits its footprint plus headroom. */
function spriteLimits(target: SkinTarget): { w: number; h: number } | null {
  if (target === 'floor') return { w: 16, h: 16 }
  if (target === 'wall') return null
  // Desk chairs share the chair's look and are drawn in one tile.
  if (target === 'chair') return { w: 16, h: 16 }
  const spec = FURNITURE[target]
  if (spec.mount === 'wall') return null
  return { w: spec.w * 16, h: spec.h * 16 + 20 }
}

function parsePalette(raw: unknown, at: (field: string, message: string) => void, field: string): Partial<Record<PaletteKey, string>> | undefined {
  if (raw === undefined) return undefined
  if (!isObj(raw)) {
    at(field, 'ожидается объект { "<цвет палитры>": "#rrggbb" }')
    return undefined
  }
  const out: Partial<Record<PaletteKey, string>> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in BASE_PALETTE) || key === 'books') at(`${field}.${key}`, 'нет такого цвета в палитре (см. docs/skin-packs.md)')
    else if (typeof value !== 'string' || !COLOR.test(value)) at(`${field}.${key}`, `${JSON.stringify(value)} — ожидается "#rrggbb"`)
    else out[key as PaletteKey] = value
  }
  return out
}

function parseSprite(raw: unknown, target: SkinTarget, at: (field: string, message: string) => void, field: string): Sprite | undefined {
  const limits = spriteLimits(target)
  if (!limits) {
    at(field, `спрайт для «${target}» не поддерживается: только палитра`)
    return undefined
  }
  if (!isObj(raw)) {
    at(field, 'ожидается объект { "w", "h", "legend", "rows" }')
    return undefined
  }
  const w = raw.w
  const h = raw.h
  if (typeof w !== 'number' || typeof h !== 'number' || !Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > limits.w || h > limits.h) {
    at(field, `размер ${JSON.stringify(w)}×${JSON.stringify(h)}: целые, не больше ${limits.w}×${limits.h}`)
    return undefined
  }
  if (!isObj(raw.legend)) {
    at(`${field}.legend`, 'ожидается объект { "a": "#rrggbb" | "@цветПалитры" }')
    return undefined
  }
  const legend: Record<string, string> = {}
  for (const [ch, color] of Object.entries(raw.legend)) {
    if ([...ch].length !== 1 || ch === '.' || ch === ' ') at(`${field}.legend.${ch}`, 'ключ — один символ, кроме «.» и пробела (они прозрачные)')
    else if (typeof color === 'string' && (COLOR.test(color) || (color.startsWith('@') && color.slice(1) in BASE_PALETTE && color !== '@books'))) legend[ch] = color
    else at(`${field}.legend.${ch}`, `${JSON.stringify(color)} — ожидается "#rrggbb" или "@цветПалитры"`)
  }
  const rows = raw.rows
  if (!Array.isArray(rows) || rows.length !== h) {
    at(`${field}.rows`, `ожидается ${h} строк`)
    return undefined
  }
  let ok = true
  rows.forEach((row, i) => {
    if (typeof row !== 'string' || [...row].length !== w) {
      at(`${field}.rows[${i}]`, `ожидается строка из ${w} символов`)
      ok = false
      return
    }
    for (const ch of row) {
      if (ch !== '.' && ch !== ' ' && !(ch in legend)) {
        at(`${field}.rows[${i}]`, `символ «${ch}» не описан в legend`)
        ok = false
        return
      }
    }
  })
  return ok ? { w, h, legend, rows: rows as string[] } : undefined
}

/** One pack file; every mistake is a line naming the file and the field. */
export function parsePack(raw: unknown, file: string): { pack: SkinPack | null; errors: string[] } {
  const errors: string[] = []
  const at = (field: string, message: string) => errors.push(`${file}: ${field}: ${message}`)
  if (!isObj(raw)) return { pack: null, errors: [`${file}: ожидается JSON-объект`] }
  if (raw.format !== SKIN_FORMAT) at('format', `должно быть ${SKIN_FORMAT}`)
  const id = typeof raw.id === 'string' && ID.test(raw.id) && raw.id !== 'builtin' ? raw.id : (at('id', 'латиница в нижнем регистре, цифры и «-» (не «builtin»)'), '')
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : (at('name', 'нужно название'), '')
  const author = typeof raw.author === 'string' ? raw.author : ''
  const license = typeof raw.license === 'string' ? raw.license : ''
  if (errors.length) return { pack: null, errors }
  let theme: Theme | null = null
  if (raw.theme !== undefined) {
    if (!isObj(raw.theme)) at('theme', 'ожидается объект { palette, floors, furniture }')
    else {
      const parsed = parseTheme({ version: 1, id, name, ...raw.theme }, file)
      errors.push(...parsed.errors.map((e) => e.replace(`${file}: `, `${file}: theme.`)))
      theme = parsed.theme
    }
  }
  const variants: SkinVariant[] = []
  const list = raw.variants === undefined ? [] : Array.isArray(raw.variants) ? raw.variants : (at('variants', 'ожидается массив'), [])
  const seen = new Set<string>()
  list.forEach((entry, i) => {
    const field = `variants[${i}]`
    const before = errors.length
    if (!isObj(entry)) return at(field, 'ожидается объект')
    const vid = typeof entry.id === 'string' && ID.test(entry.id) ? entry.id : (at(`${field}.id`, 'латиница в нижнем регистре, цифры и «-»'), '')
    if (vid && seen.has(vid)) at(`${field}.id`, `«${vid}» уже есть в этом пакете`)
    const vname = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : (at(`${field}.name`, 'нужно название'), '')
    const target = entry.target
    if (target !== 'floor' && target !== 'wall' && !isFurnitureType(target)) {
      at(`${field}.target`, `${JSON.stringify(target)} — ожидается "floor", "wall" или тип мебели (desk, sofa, server-rack…)`)
      return
    }
    let base: string | undefined
    if (entry.base !== undefined) {
      const known =
        target === 'floor' ? (FLOORS as readonly string[]) : target === 'wall' ? (WALLS as readonly string[]) : (BUILTIN_ITEMS[target] ?? [['', '']]).map(([b]) => b)
      if (typeof entry.base !== 'string' || !known.includes(entry.base)) at(`${field}.base`, `${JSON.stringify(entry.base)} — есть: ${known.map((k) => k || '""').join(', ')}`)
      else base = entry.base
    } else if (target === 'floor' || target === 'wall') {
      if (entry.sprite === undefined) at(`${field}.base`, `для «${target}» нужен base (${target === 'floor' ? 'вид пола' : 'стиль стены'}) или sprite`)
    }
    const palette = parsePalette(entry.palette, at, `${field}.palette`)
    const sprite = entry.sprite === undefined ? undefined : parseSprite(entry.sprite, target, at, `${field}.sprite`)
    if (!palette && !sprite && base === undefined) at(field, 'нужно хотя бы одно: base, palette или sprite')
    if (errors.length > before) return
    seen.add(vid)
    variants.push({ id: `${id}:${vid}`, name: vname, target, pack: id, ...(base !== undefined ? { base } : {}), ...(palette ? { palette } : {}), ...(sprite ? { sprite } : {}) })
  })
  // Characters for people: a robot, a fox, a knight (editor/characters.ts, docs/characters.md).
  const parsed = parseCharacters(raw.characters, id, file)
  errors.push(...parsed.errors)
  return { pack: { id, name, author, license, theme, variants, characters: parsed.characters }, errors }
}

/** office/skins/index.json and every pack it lists; bad files are skipped with their errors. */
export async function loadPacks(read: (file: string) => Promise<unknown>): Promise<{ packs: SkinPack[]; errors: string[] }> {
  let files: unknown
  try {
    files = await read('index.json')
  } catch (error) {
    return { packs: [], errors: [`skins/index.json: ${(error as Error).message}`] }
  }
  if (!Array.isArray(files)) return { packs: [], errors: ['skins/index.json: ожидается массив имён файлов'] }
  const packs: SkinPack[] = []
  const errors: string[] = []
  for (const file of files) {
    if (typeof file !== 'string' || !/^[a-z0-9-]+\.json$/.test(file)) {
      errors.push(`skins/index.json: ${JSON.stringify(file)} — ожидается имя файла вида "loft.json"`)
      continue
    }
    try {
      const { pack, errors: e } = parsePack(await read(file), `skins/${file}`)
      errors.push(...e)
      if (pack && packs.some((p) => p.id === pack.id)) errors.push(`skins/${file}: id «${pack.id}» уже есть`)
      else if (pack) packs.push(pack)
    } catch (error) {
      errors.push(`skins/${file}: ${(error as Error).message}`)
    }
  }
  return { packs, errors }
}

// ── The owner's choices («Оформление») ───────────────────────────────────────────────────

export type Decor = { rooms: Record<string, { floor?: string; wall?: string }>; items: Record<string, string> }

export const emptyDecor = (): Decor => ({ rooms: {}, items: {} })

/** The stable name of one piece of furniture: its room, type and tile. */
export function itemKey(item: Pick<PlacedFurniture, 'room' | 'type' | 'x' | 'y'>): string {
  return `${item.room}:${item.type}:${item.x},${item.y}`
}

/** A stored choice, field by field; unknown variants are dropped (a pack may have gone). */
export function parseDecor(raw: unknown, known: ReadonlySet<string>): Decor {
  const out = emptyDecor()
  if (!isObj(raw)) return out
  if (isObj(raw.rooms)) {
    for (const [room, v] of Object.entries(raw.rooms)) {
      if (!isObj(v)) continue
      const r: { floor?: string; wall?: string } = {}
      if (typeof v.floor === 'string' && known.has(v.floor)) r.floor = v.floor
      if (typeof v.wall === 'string' && known.has(v.wall)) r.wall = v.wall
      if (r.floor || r.wall) out.rooms[room] = r
    }
  }
  if (isObj(raw.items)) for (const [k, v] of Object.entries(raw.items)) if (typeof v === 'string' && known.has(v)) out.items[k] = v
  return out
}

export function serializeDecor(d: Decor): { v: 1; rooms: Decor['rooms']; items: Decor['items'] } {
  return { v: 1, rooms: JSON.parse(JSON.stringify(d.rooms)), items: { ...d.items } }
}

/** Sets (or with null clears) a room's floor or walls. */
export function chooseRoom(d: Decor, room: string, part: 'floor' | 'wall', variant: string | null): Decor {
  const next = { rooms: JSON.parse(JSON.stringify(d.rooms)) as Decor['rooms'], items: { ...d.items } }
  const r = { ...(next.rooms[room] ?? {}) }
  if (variant) r[part] = variant
  else delete r[part]
  if (r.floor || r.wall) next.rooms[room] = r
  else delete next.rooms[room]
  return next
}

/** Sets (or clears) the look of the given pieces of furniture. */
export function chooseItems(d: Decor, keys: readonly string[], variant: string | null): Decor {
  const next = { rooms: JSON.parse(JSON.stringify(d.rooms)) as Decor['rooms'], items: { ...d.items } }
  for (const k of keys) {
    if (variant) next.items[k] = variant
    else delete next.items[k]
  }
  return next
}

// ── Drawing with a skin ──────────────────────────────────────────────────────────────────

/** Runs a drawing with some palette colours swapped, then puts them back. */
export function withPalette<T>(overrides: Partial<Record<PaletteKey, string>> | undefined, draw: () => T): T {
  if (!overrides) return draw()
  const saved: Partial<Record<PaletteKey, unknown>> = {}
  for (const k of Object.keys(overrides) as PaletteKey[]) saved[k] = P[k]
  Object.assign(P, overrides)
  try {
    return draw()
  } finally {
    Object.assign(P, saved)
  }
}

/** Paints a sprite with its bottom-left at (x, bottom); «@name» colours follow the theme and the hour. */
export function drawSprite(p: Paint, sprite: Sprite, x: number, bottom: number): void {
  const top = bottom - sprite.h
  sprite.rows.forEach((row, dy) => {
    let dx = 0
    for (const ch of row) {
      const c = sprite.legend[ch]
      if (c) p(x + dx, top + dy, 1, 1, c.startsWith('@') ? (P[c.slice(1) as PaletteKey] as string) : c)
      dx += 1
    }
  })
}

/** The choices for a target: the built-in looks first, then every pack's, in pack order. */
export function variantsFor(all: readonly SkinVariant[], target: SkinTarget): SkinVariant[] {
  return all.filter((v) => v.target === target)
}
