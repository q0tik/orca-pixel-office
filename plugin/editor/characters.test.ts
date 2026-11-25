import { readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import { AppearanceStore, defaultAppearance, parseAppearance, serializeAppearance, type KeyValueStore } from './appearance'
import { CHAR_H, CHAR_W, drawCharacter, drawIntern, INTERN_H, INTERN_W, lookId, lookOf, type CharPose, type Paint } from './art'
import { coatOf, HEAD, MINI, ownerColorsUsed, parseCharacters, type CharacterSkin } from './characters'
import { renderAppearanceEditor } from './panel'
import { loadPacks, parsePack } from './skins'

const here = (file: string) => new URL(file, import.meta.url).pathname
const read = async (file: string) => JSON.parse(readFileSync(here(`../office/skins/${file}`), 'utf8'))

async function shipped(): Promise<CharacterSkin[]> {
  const { packs, errors } = await loadPacks(read)
  assert.deepEqual(errors, [])
  return packs.flatMap((p) => p.characters)
}

function canvas(): { paint: Paint; map: Map<string, string>; outside: string[] } {
  const map = new Map<string, string>()
  const outside: string[] = []
  return {
    map,
    outside,
    paint: (x, y, w, h, c) => {
      for (let yy = y; yy < y + h; yy += 1)
        for (let xx = x; xx < x + w; xx += 1) {
          // The top row may be lost while walking (the figure bobs up); anything else must fit.
          if (xx < 0 || xx >= CHAR_W || yy < -1 || yy >= CHAR_H) outside.push(`${xx},${yy}`)
          map.set(`${xx},${yy}`, c)
        }
    }
  }
}

/** Every pose the office draws, with the facings and frames it uses. */
const POSES: [CharPose, ('down' | 'up' | 'left' | 'right')[], number][] = [
  ['walk', ['down', 'up', 'left', 'right'], 4],
  ['stand', ['down', 'up', 'left', 'right'], 1],
  ['wait', ['down', 'up', 'left', 'right'], 1],
  ['type', ['down', 'up'], 2],
  ['sofa', ['down'], 1],
  ['read', ['down'], 4],
  ['phone', ['down'], 4],
  ['rock', ['down'], 4],
  ['feet', ['down'], 4],
  ['water', ['left', 'right'], 4],
  ['ball', ['down'], 4],
  ['window', ['up'], 1]
]

const dress = (c: CharacterSkin, coat: string) => lookOf({ ...defaultAppearance('cto'), character: c.id, coat }, 'cto', new Map([[c.id, c]]))

test('the shipped characters: robots, the furries asked for (with 2–3 coats each) and more, all MIT', async () => {
  const { packs } = await loadPacks(read)
  for (const p of packs.filter((x) => x.characters.length)) assert.equal(p.license, 'MIT', `${p.id} is MIT`)
  const all = await shipped()
  const ids = all.map((c) => c.id)
  for (const id of ['robots:retro-robot', 'robots:android', 'furries:cat', 'furries:fox', 'furries:deer']) assert.ok(ids.includes(id), `${id} is there`)
  for (const id of ['furries:cat', 'furries:fox', 'furries:deer']) {
    const c = all.find((x) => x.id === id)!
    assert.ok(c.coats.length >= 2 && c.coats.length <= 3, `${id}: 2–3 coats`)
    assert.ok(c.tail.side || c.tail.back, `${id}: a tail`)
  }
  assert.ok(all.length >= 12, `at least 12 characters, got ${all.length}`)
  assert.equal(new Set(ids).size, ids.length, 'ids are unique')
  assert.equal(new Set(all.map((c) => c.name)).size, all.length, 'names are unique')
})

test('every character in every coat has every pose, facing and frame, inside the figure', async () => {
  for (const c of await shipped()) {
    for (const coat of c.coats) {
      const look = dress(c, coat.id)
      assert.equal(look.dressed?.coat.id, coat.id)
      const seen = new Set<string>()
      for (const [pose, facings, frames] of POSES) {
        for (const facing of facings) {
          for (let f = 0; f < frames; f += 1) {
            const cv = canvas()
            drawCharacter(cv.paint, look, pose, facing, f)
            assert.deepEqual(cv.outside, [], `${c.id}/${coat.id} ${pose} ${facing} ${f}: inside ${CHAR_W}×${CHAR_H}`)
            assert.ok(cv.map.size > 60, `${c.id} ${pose} ${facing} ${f}: a whole figure`)
            seen.add([...cv.map].sort().join(';'))
          }
        }
      }
      assert.ok(seen.size >= 25, `${c.id}/${coat.id}: the poses look different (${seen.size})`)
      // Trainees: the small figure with the character's small head.
      const small = canvas()
      drawIntern(small.paint, look, '#00ff00')
      for (const k of small.map.keys()) {
        const [x, y] = k.split(',').map(Number)
        assert.ok(x >= 0 && x < INTERN_W && y >= 0 && y < INTERN_H, `${c.id}: the trainee fits ${INTERN_W}×${INTERN_H}`)
      }
    }
  }
})

test('a character changes the head, keeps the status space above it, and its coats differ', async () => {
  const person = lookOf(defaultAppearance('cto'), 'cto')
  const drawn = (look: ReturnType<typeof lookOf>, pose: CharPose, facing: 'down' | 'up' | 'right') => {
    const cv = canvas()
    drawCharacter(cv.paint, look, pose, facing, 0)
    return cv.map
  }
  for (const c of await shipped()) {
    const look = dress(c, '')
    for (const facing of ['down', 'up', 'right'] as const) {
      const a = drawn(person, 'stand', facing)
      const b = drawn(look, 'stand', facing)
      let differ = 0
      for (let y = 0; y < 12; y += 1) for (let x = 0; x < CHAR_W; x += 1) if (a.get(`${x},${y}`) !== b.get(`${x},${y}`)) differ += 1
      assert.ok(differ > 10, `${c.id} ${facing}: its own head`)
    }
    if (c.coats.length > 1) assert.notEqual(lookId(dress(c, c.coats[0].id)), lookId(dress(c, c.coats[1].id)), `${c.id}: coats are cached apart`)
    // Ears, antlers and plumes stay inside the figure: badges, signs and bubbles above it stay clear.
    for (const view of ['front', 'back', 'side'] as const) assert.equal(c.head[view].y, HEAD.y)
    assert.equal(c.mini.w, MINI.w)
  }
})

test('the owner keeps the colours a character still shows; a pirate keeps the face, a fox the shirt', async () => {
  const all = new Map((await shipped()).map((c) => [c.id, c]))
  const fox = all.get('furries:fox')!
  const pirate = all.get('costumes:pirate')!
  assert.ok(ownerColorsUsed(fox).has('shirt') && !ownerColorsUsed(fox).has('hair'))
  assert.ok(ownerColorsUsed(pirate).has('skin') && ownerColorsUsed(pirate).has('hair'))
  const a = { ...defaultAppearance('cto'), character: fox.id, coat: 'arctic' }
  const look = lookOf({ ...a, outfit: 1 }, 'cto', all)
  const other = lookOf({ ...a, outfit: 2 }, 'cto', all)
  assert.notEqual(look.shirt, other.shirt, 'a fox wears the shirt the owner picked')
  assert.equal(look.skin, coatOf(fox, 'arctic').colors.fur, 'its hands are paws in its coat')
  // A pack that is gone: a person again, nothing breaks.
  assert.equal(lookOf({ ...a, character: 'gone:fox' }, 'cto', all).dressed, undefined)
  // The editor offers the characters and the coats, and hides what a fox has no use for.
  const html = renderAppearanceEditor('CTO', a, true, { characters: [...all.values()], worker: false })
  assert.ok(html.includes('Персонаж') && html.includes('Лиса') && html.includes('Окрас') && html.includes('Песец'))
  assert.ok(!html.includes('Причёска') && !html.includes('Цвет волос'))
  const worker = renderAppearanceEditor('api', defaultAppearance('w:x'), true, { characters: [...all.values()], worker: true })
  assert.ok(!worker.includes('Табличка'), 'employees have no desk plate')
})

function memoryStorage(): KeyValueStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, JSON.parse(JSON.stringify(v))),
    delete: async (k) => void data.delete(k),
    keys: async () => [...data.keys()]
  }
}

test('the chosen character and coat are kept in the plugin storage, for bots and employees', async () => {
  const storage = memoryStorage()
  const first = new AppearanceStore(storage)
  await first.load()
  assert.equal(await first.save('cto', { ...first.get('cto'), character: 'robots:retro-robot', coat: 'red' }), true)
  assert.equal(await first.save('w:repo::/w/api', { ...first.get('w:repo::/w/api'), character: 'furries:deer', coat: 'reindeer' }), true)
  assert.deepEqual((storage.data.get('appearance:cto') as { character: string }).character, 'robots:retro-robot')
  const second = new AppearanceStore(storage)
  await second.load()
  assert.equal(second.get('cto').character, 'robots:retro-robot')
  assert.equal(second.get('cto').coat, 'red')
  assert.equal(second.get('w:repo::/w/api').character, 'furries:deer')
  // Old looks (stage 4) still read, as people; junk is dropped field by field.
  assert.equal(parseAppearance({ v: 1, hairStyle: 1, hair: 0, skin: 0, outfit: 0, accessory: 'none', plate: '' }, 'cto').character, '')
  assert.equal(parseAppearance({ character: 'not a skin!', coat: 42 }, 'cto').character, '')
  assert.deepEqual(parseAppearance(serializeAppearance({ ...defaultAppearance('x'), character: 'a:b', coat: 'c' }), 'x').coat, 'c')
})

test('a broken character is reported line by line and the rest of the pack still loads', () => {
  const good = JSON.parse(readFileSync(here('../office/skins/furries.json'), 'utf8'))
  const broken = structuredClone(good)
  broken.characters[0].head.front = broken.characters[0].head.front.slice(1)
  broken.characters[1].legend.f = '$nope'
  broken.characters[2].tail = { side: { x: 14, y: 20, rows: ['xxxx'] } }
  const { pack, errors } = parsePack(broken, 'skins/furries.json')
  assert.ok(errors.some((e) => e.includes('characters[0].head.front') && e.includes('12 строк')))
  assert.ok(errors.some((e) => e.includes('characters[1].legend.f') && e.includes('$nope')))
  assert.ok(errors.some((e) => e.includes('characters[2].tail.side')))
  assert.equal(pack!.characters.length, good.characters.length - 3)
  assert.deepEqual(parseCharacters('nope', 'p', 'f.json').errors, ['f.json: characters: ожидается массив'])
})

test('the example in docs/characters.md (docs/examples/frog.json) is a valid character with every pose', () => {
  const raw = JSON.parse(readFileSync(here('../../docs/examples/frog.json'), 'utf8'))
  const { pack, errors } = parsePack(raw, 'frog.json')
  assert.deepEqual(errors, [])
  const frog = pack!.characters[0]
  assert.equal(frog.id, 'pond:frog')
  for (const coat of frog.coats) {
    const look = dress(frog, coat.id)
    for (const [pose, facings, frames] of POSES)
      for (const facing of facings)
        for (let f = 0; f < frames; f += 1) {
          const cv = canvas()
          drawCharacter(cv.paint, look, pose, facing, f)
          assert.deepEqual(cv.outside, [])
        }
  }
})
