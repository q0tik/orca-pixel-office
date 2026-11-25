import { readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import {
  ACCESSORIES,
  AppearanceStore,
  cleanPlate,
  defaultAppearance,
  HAIR_STYLES,
  parseAppearance,
  PLATE_MAX,
  serializeAppearance,
  STORAGE_PREFIX,
  type KeyValueStore
} from './appearance'
import { CHAR_H, CHAR_W, drawCharacter, lookFor, lookOf, type Paint } from './art'
import { Daylight, phaseAt, PHASES } from './daylight'
import { BASE_PALETTE, HAIRS, P, SHIRTS, SKINS } from './palette'
import { applyPalette, DEFAULT_THEME, parseTheme, pickTheme } from './theme'
import { loadPacks } from './skins'

const here = (file: string) => new URL(file, import.meta.url).pathname

// ── Appearance ───────────────────────────────────────────────────────────────────────────

test('the default look comes from the bot key, as before stage 4', () => {
  assert.deepEqual(defaultAppearance('cto'), defaultAppearance('cto'))
  assert.deepEqual(lookOf(defaultAppearance('cto'), 'cto'), lookFor('cto'))
  const a = defaultAppearance('seller')
  assert.ok(a.hair < HAIRS.length && a.skin < SKINS.length && a.outfit < SHIRTS.length)
  assert.equal(a.accessory, 'none')
  assert.equal(a.plate, '')
})

test('a stored look is checked field by field; anything wrong falls back to the default', () => {
  const base = defaultAppearance('cto')
  assert.deepEqual(parseAppearance(null, 'cto'), base)
  assert.deepEqual(parseAppearance('x', 'cto'), base)
  const mixed = parseAppearance({ hairStyle: 99, hair: 1, skin: -1, outfit: 2.5, accessory: 'hat', plate: 'CTO' }, 'cto')
  assert.deepEqual(mixed, { ...base, hair: 1, plate: 'CTO' })
  assert.equal(cleanPlate('  Очень длинная табличка для стола  ').length, PLATE_MAX)
  assert.equal(cleanPlate('a\nb\u0007c'), 'abc')
  assert.equal(cleanPlate(42), '')
  assert.ok(HAIR_STYLES.length >= 4)
  assert.ok(ACCESSORIES.length >= 4 && ACCESSORIES.includes('none'))
})

test('a look survives storage and back', () => {
  const look = { hairStyle: 3, hair: 2, skin: 1, outfit: 4, accessory: 'headphones' as const, plate: 'Главный по коду' }
  const stored = JSON.parse(JSON.stringify(serializeAppearance(look)))
  assert.equal(stored.v, 1)
  assert.deepEqual(parseAppearance(stored, 'cto'), look)
})

function memoryStorage(fail = false) {
  const data = new Map<string, unknown>()
  const guard = () => {
    if (fail) throw Object.assign(new Error('denied'), { code: 'capability_denied' })
  }
  const store: KeyValueStore = {
    get: async (k) => (guard(), data.get(k) ?? null),
    set: async (k, v) => {
      guard()
      data.set(k, JSON.parse(JSON.stringify(v)))
    },
    delete: async (k) => {
      guard()
      data.delete(k)
    },
    keys: async () => (guard(), [...data.keys()])
  }
  return { store, data }
}

test('the store keeps a look across restarts and resets it', async () => {
  const { store, data } = memoryStorage()
  const first = new AppearanceStore(store)
  await first.load()
  assert.equal(first.custom('cto'), false)
  const look = { ...defaultAppearance('cto'), accessory: 'glasses' as const, plate: 'CTO' }
  assert.equal(await first.save('cto', look), true)
  assert.ok(data.has(`${STORAGE_PREFIX}cto`), 'kept under the bot key')
  // «A restart»: a new store reads what the first one wrote.
  const second = new AppearanceStore(store)
  await second.load()
  assert.deepEqual(second.get('cto'), look)
  assert.equal(second.custom('cto'), true)
  assert.equal(await second.reset('cto'), true)
  assert.deepEqual(second.get('cto'), defaultAppearance('cto'))
  assert.equal(data.size, 0)
})

test('storage unavailable: defaults, changes live in the tab only, nothing throws', async () => {
  const failing = new AppearanceStore(memoryStorage(true).store)
  await failing.load()
  assert.equal(failing.available, false)
  assert.deepEqual(failing.get('cto'), defaultAppearance('cto'))
  const look = { ...defaultAppearance('cto'), accessory: 'mug' as const }
  assert.equal(await failing.save('cto', look), false)
  assert.equal(failing.get('cto').accessory, 'mug', 'still shown until the tab closes')
  const none = new AppearanceStore(null)
  await none.load()
  assert.equal(none.available, false)
  assert.equal(await none.save('cto', look), false)
})

function picture(draw: (p: Paint) => void): string {
  const px: string[] = []
  draw((x, y, w, h, c) => {
    for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) px.push(`${xx},${yy},${c}`)
  })
  return px.join(';')
}

test('every hairstyle and accessory looks different and stays inside the sprite', () => {
  const base = defaultAppearance('cto')
  const shots = new Set<string>()
  for (let style = 0; style < HAIR_STYLES.length; style += 1) {
    shots.add(picture((p) => drawCharacter(p, lookOf({ ...base, hairStyle: style }, 'cto'), 'walk', 'down', 0)))
  }
  assert.equal(shots.size, HAIR_STYLES.length)
  const acc = new Set<string>()
  for (const accessory of ACCESSORIES) {
    let outside = 0
    const pic = picture((p) =>
      drawCharacter(
        (x, y, w, h, c) => {
          if (x < 0 || y < 0 || x + w > CHAR_W || y + h > CHAR_H) outside += 1
          p(x, y, w, h, c)
        },
        lookOf({ ...base, accessory }, 'cto'),
        'walk',
        'down',
        0
      )
    )
    assert.equal(outside, 0, accessory)
    acc.add(pic)
  }
  assert.equal(acc.size, ACCESSORIES.length)
})

// ── Themes ───────────────────────────────────────────────────────────────────────────────

const readPack = async (file: string) => JSON.parse(readFileSync(here(`../office/skins/${file}`), 'utf8'))
async function loadThemes(read: (file: string) => Promise<unknown>) {
  const { packs, errors } = await loadPacks(read)
  const themes = packs.flatMap((p) => (p.theme ? [p.theme] : []))
  return { themes: themes.length ? themes : [DEFAULT_THEME], errors }
}

test('the real themes load: at least two, the day office first', async () => {
  const { themes, errors } = await loadThemes(readPack)
  assert.deepEqual(errors, [])
  assert.ok(themes.length >= 2)
  assert.equal(themes[0].id, 'day')
  const loft = themes.find((t) => t.id === 'loft')!
  assert.ok(Object.keys(loft.palette).length > 10, 'a really different look')
  assert.equal(loft.floors['carpet-green'], 'concrete')
})

test('theme mistakes come back as readable lines; a bad pack is skipped', async () => {
  const bad = parseTheme({ version: 1, id: 'Bad Id', name: '', palette: { wallFace: 'red', nope: '#ffffff', books: [] }, floors: { wood: 'lava' }, furniture: { rug: 'pink' } }, 'themes/bad.json')
  assert.equal(bad.theme, null)
  const text = bad.errors.join('\n')
  for (const part of ['id:', 'name:', 'palette.wallFace', 'palette.nope', 'palette.books', 'floors.wood', 'furniture.rug']) assert.ok(text.includes(part), part)
  const files: Record<string, unknown> = { 'index.json': ['day.json', 'broken.json', '../evil.json'], 'day.json': { format: 1, id: 'day', name: 'Д', theme: { palette: {} } }, 'broken.json': { format: 2 } }
  const loaded = await loadThemes(async (f) => {
    if (!(f in files)) throw new Error('not found')
    return files[f]
  })
  assert.deepEqual(loaded.themes.map((t) => t.id), ['day'])
  assert.ok(loaded.errors.some((e) => e.includes('broken.json')))
  assert.ok(loaded.errors.some((e) => e.includes('evil')))
  const none = await loadThemes(async () => {
    throw new Error('offline')
  })
  assert.deepEqual(none.themes, [DEFAULT_THEME])
})

test('switching themes swaps the palette and back', async () => {
  const { themes } = await loadThemes(readPack)
  const loft = pickTheme(themes, 'loft')
  assert.equal(pickTheme(themes, 'nope').id, 'day', 'an unknown stored id falls back')
  applyPalette(loft, {})
  assert.equal(P.wallFace, loft.palette.wallFace)
  applyPalette(pickTheme(themes, 'day'), {})
  assert.equal(P.wallFace, BASE_PALETTE.wallFace)
  applyPalette(pickTheme(themes, 'day'), PHASES.night.sky)
  assert.equal(P.sky, PHASES.night.sky.sky, 'the sky of the hour on top of the theme')
  applyPalette(DEFAULT_THEME, {})
})

// ── Day and night ────────────────────────────────────────────────────────────────────────

test('phases by the clock, edges included', () => {
  const at: Record<number, string> = { 0: 'night', 5: 'night', 6: 'morning', 9: 'morning', 10: 'day', 16: 'day', 17: 'evening', 21: 'evening', 22: 'night', 23: 'night', 24: 'night', [-1]: 'night' }
  for (const [hour, phase] of Object.entries(at)) assert.equal(phaseAt(Number(hour)), phase, `${hour}:00`)
  assert.equal(PHASES.day.tint, null)
  assert.ok(PHASES.night.tint && PHASES.night.lamps)
  assert.ok(!PHASES.morning.lamps)
})

test('the clock is read at most once a minute and reports only a change', () => {
  let hour = 16
  let now = 0
  const d = new Daylight(() => hour, () => now)
  assert.equal(d.phase, 'day')
  hour = 17
  now = 30_000
  assert.equal(d.check(), false, 'not a minute yet')
  now = 60_000
  assert.equal(d.check(), true)
  assert.equal(d.phase, 'evening')
  now = 130_000
  assert.equal(d.check(), false, 'same phase')
})
