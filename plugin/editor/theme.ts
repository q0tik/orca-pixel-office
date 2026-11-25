// Office themes as data: the `theme` section of a skin pack (office/skins/*.json, see
// editor/skins.ts). A theme overrides palette colours, can draw one floor kind as another, and
// picks furniture variants. A new theme is a new pack, no code. The chosen theme id lives in the
// plugin's storage.
import { FLOORS, type FloorKind } from '../engine/catalog'
import { BASE_PALETTE, setPalette, type PaletteKey } from './palette'

export const RUG_VARIANTS = ['red', 'blue', 'cream'] as const
export const PLANT_VARIANTS = ['leafy', 'cactus'] as const

export type Theme = {
  id: string
  name: string
  palette: Partial<Record<PaletteKey, string | readonly string[]>>
  /** Draw a floor kind as another (a loft paves the carpets with concrete). */
  floors: Partial<Record<FloorKind, FloorKind>>
  furniture: { rug?: (typeof RUG_VARIANTS)[number]; plant?: (typeof PLANT_VARIANTS)[number] }
}

export const DEFAULT_THEME: Theme = { id: 'day', name: 'Дневной офис', palette: {}, floors: {}, furniture: {} }
export const THEME_STORAGE_KEY = 'theme'

const COLOR = /^#[0-9a-f]{6}$/i
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Reads one theme file; every mistake comes back as a line naming the file and the field. */
export function parseTheme(raw: unknown, file: string): { theme: Theme | null; errors: string[] } {
  const errors: string[] = []
  const at = (field: string, message: string) => errors.push(`${file}: ${field}: ${message}`)
  if (!isObj(raw)) return { theme: null, errors: [`${file}: ожидается JSON-объект`] }
  if (raw.version !== 1) at('version', 'должно быть 1')
  const id = typeof raw.id === 'string' && /^[a-z0-9-]+$/.test(raw.id) ? raw.id : (at('id', 'латиница в нижнем регистре, цифры и «-»'), '')
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : (at('name', 'нужно название'), '')
  const palette: Theme['palette'] = {}
  if (raw.palette !== undefined && !isObj(raw.palette)) at('palette', 'ожидается объект { "<цвет>": "#rrggbb" }')
  for (const [key, value] of Object.entries(isObj(raw.palette) ? raw.palette : {})) {
    if (!(key in BASE_PALETTE)) {
      at(`palette.${key}`, 'нет такого цвета в палитре')
      continue
    }
    if (key === 'books') {
      if (Array.isArray(value) && value.length > 0 && value.every((c) => typeof c === 'string' && COLOR.test(c))) palette.books = value as string[]
      else at('palette.books', 'ожидается непустой массив "#rrggbb"')
      continue
    }
    if (typeof value === 'string' && COLOR.test(value)) palette[key as PaletteKey] = value
    else at(`palette.${key}`, `${JSON.stringify(value)} — ожидается "#rrggbb"`)
  }
  const floors: Theme['floors'] = {}
  for (const [from, to] of Object.entries(isObj(raw.floors) ? raw.floors : {})) {
    if (!(FLOORS as readonly string[]).includes(from) || !(FLOORS as readonly string[]).includes(String(to))) {
      at(`floors.${from}`, `пол «${String(to)}»: есть только ${FLOORS.join(', ')}`)
      continue
    }
    floors[from as FloorKind] = to as FloorKind
  }
  const furniture: Theme['furniture'] = {}
  const f = isObj(raw.furniture) ? raw.furniture : {}
  if (f.rug !== undefined) {
    if ((RUG_VARIANTS as readonly unknown[]).includes(f.rug)) furniture.rug = f.rug as Theme['furniture']['rug']
    else at('furniture.rug', `ожидается одно из: ${RUG_VARIANTS.join(', ')}`)
  }
  if (f.plant !== undefined) {
    if ((PLANT_VARIANTS as readonly unknown[]).includes(f.plant)) furniture.plant = f.plant as Theme['furniture']['plant']
    else at('furniture.plant', `ожидается одно из: ${PLANT_VARIANTS.join(', ')}`)
  }
  return errors.length ? { theme: null, errors } : { theme: { id, name, palette, floors, furniture }, errors: [] }
}

/** The stored choice, or the first theme when it is unknown. */
export function pickTheme(themes: readonly Theme[], stored: unknown): Theme {
  return themes.find((t) => t.id === stored) ?? themes[0] ?? DEFAULT_THEME
}

/** Makes `P` the theme's palette with the sky of the hour on top. */
export function applyPalette(theme: Theme, sky: Partial<Record<PaletteKey, string>>): void {
  setPalette(theme.palette, sky)
}
