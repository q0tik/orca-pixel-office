// A bot's look, chosen in the panel's «Внешность» editor and kept in the plugin's own storage
// (`orca.storage`, key `appearance:<bot key>`), never in code or the repo's JSON. Colours are
// picked from the office palette presets, so the office keeps one palette. Without a stored
// look (or without storage at all) the look comes from the bot key, as it always did.
import { HAIRS, PANTS, SHIRTS, SKINS } from './palette'

export const HAIR_STYLES = ['короткая', 'длинная', 'ёжик', 'пучок', 'под ноль'] as const
export const ACCESSORIES = ['none', 'glasses', 'headphones', 'mug', 'badge'] as const
export type Accessory = (typeof ACCESSORIES)[number]
export const ACCESSORY_LABELS: Record<Accessory, string> = {
  none: 'нет',
  glasses: 'очки',
  headphones: 'наушники',
  mug: 'кружка',
  badge: 'бейдж'
}
export const PLATE_MAX = 16
export const STORAGE_PREFIX = 'appearance:'

export type Appearance = {
  hairStyle: number
  /** Indexes into the palette presets: HAIRS, SKINS, SHIRTS (with its shade). */
  hair: number
  skin: number
  outfit: number
  accessory: Accessory
  /** Text on the bot's desk plate (display only), at most 16 characters. */
  plate: string
}

export function hashText(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

/** The look a bot has had since stage 1: picked from its key. */
export function defaultAppearance(key: string): Appearance {
  const h = hashText(key)
  return {
    outfit: h % SHIRTS.length,
    skin: (h >>> 5) % SKINS.length,
    hair: (h >>> 9) % HAIRS.length,
    hairStyle: (h >>> 13) % 3,
    accessory: 'none',
    plate: ''
  }
}

/** Pants follow the key whatever the outfit, so every bot keeps its own. */
export function pantsFor(key: string): string {
  return PANTS[(hashText(key) >>> 17) % PANTS.length]
}

export function cleanPlate(text: unknown): string {
  if (typeof text !== 'string') return ''
  return [...text.replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, PLATE_MAX).join('')
}

const index = (value: unknown, size: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < size ? value : null

/** A stored look, field by field: anything missing or wrong falls back to the bot's default. */
export function parseAppearance(raw: unknown, key: string): Appearance {
  const base = defaultAppearance(key)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return base
  const r = raw as Record<string, unknown>
  return {
    hairStyle: index(r.hairStyle, HAIR_STYLES.length) ?? base.hairStyle,
    hair: index(r.hair, HAIRS.length) ?? base.hair,
    skin: index(r.skin, SKINS.length) ?? base.skin,
    outfit: index(r.outfit, SHIRTS.length) ?? base.outfit,
    accessory: (ACCESSORIES as readonly unknown[]).includes(r.accessory) ? (r.accessory as Accessory) : base.accessory,
    plate: r.plate === undefined ? base.plate : cleanPlate(r.plate)
  }
}

export function serializeAppearance(a: Appearance): { v: 1; hairStyle: number; hair: number; skin: number; outfit: number; accessory: Accessory; plate: string } {
  return { v: 1, hairStyle: a.hairStyle, hair: a.hair, skin: a.skin, outfit: a.outfit, accessory: a.accessory, plate: cleanPlate(a.plate) }
}

export type KeyValueStore = {
  get(key: string): Promise<unknown>
  set(key: string, value: never): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
  /** Someone (this tab, another tab, the worker) changed a key. */
  onDidChange?(listener: (change: { key: string }) => void): unknown
}

/**
 * The looks of all bots. Without storage (or when it fails) every bot keeps its default look
 * and the office goes on; `available` says whether changes can be kept.
 */
export class AppearanceStore {
  private readonly looks = new Map<string, Appearance>()
  available: boolean

  constructor(private readonly storage: KeyValueStore | null) {
    this.available = storage !== null
  }

  async load(): Promise<void> {
    if (!this.storage) return
    try {
      const keys = (await this.storage.keys()).filter((k) => k.startsWith(STORAGE_PREFIX))
      for (const storageKey of keys) {
        const botKey = storageKey.slice(STORAGE_PREFIX.length)
        this.looks.set(botKey, parseAppearance(await this.storage.get(storageKey), botKey))
      }
    } catch {
      this.available = false
    }
  }

  get(key: string): Appearance {
    return this.looks.get(key) ?? defaultAppearance(key)
  }

  /** Whether the owner changed this bot's look. */
  custom(key: string): boolean {
    return this.looks.has(key)
  }

  async save(key: string, look: Appearance): Promise<boolean> {
    const clean = parseAppearance(serializeAppearance(look), key)
    this.looks.set(key, clean)
    if (!this.storage || !this.available) return false
    try {
      await this.storage.set(STORAGE_PREFIX + key, serializeAppearance(clean) as never)
      return true
    } catch {
      return false
    }
  }

  async reset(key: string): Promise<boolean> {
    this.looks.delete(key)
    if (!this.storage || !this.available) return false
    try {
      await this.storage.delete(STORAGE_PREFIX + key)
      return true
    } catch {
      return false
    }
  }
}
