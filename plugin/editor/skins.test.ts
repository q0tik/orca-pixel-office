import { readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import { realMap } from '../engine/fixtures'
import { FLOORS, WALLS } from '../engine/catalog'
import type { Paint } from './art'
import { BASE_PALETTE, P } from './palette'
import { deskChair, paintSkinnedItem, paintSkinnedTile, Renderer, type Canvas } from './render'
import {
  builtinVariants,
  chooseItems,
  chooseRoom,
  drawSprite,
  emptyDecor,
  itemKey,
  loadPacks,
  parseDecor,
  parsePack,
  serializeDecor,
  variantsFor,
  withPalette
} from './skins'

const here = (file: string) => new URL(file, import.meta.url).pathname
const read = async (file: string) => JSON.parse(readFileSync(here(`../office/skins/${file}`), 'utf8'))

function pixels(): { paint: Paint; map: Map<string, string> } {
  const map = new Map<string, string>()
  return { map, paint: (x, y, w, h, c) => { for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) map.set(`${xx},${yy}`, c) } }
}

test('the shipped packs load clean: two themes and enough looks for every room and the key things', async () => {
  const { packs, errors } = await loadPacks(read)
  assert.deepEqual(errors, [])
  assert.deepEqual(packs.filter((p) => p.theme).map((p) => p.id), ['day', 'loft'], 'the built-in themes are packs now')
  for (const p of packs) assert.equal(p.license, 'MIT', `${p.id} is MIT`)
  const all = [...builtinVariants(), ...packs.flatMap((p) => p.variants)]
  assert.ok(variantsFor(all, 'floor').length >= FLOORS.length + 2)
  assert.ok(variantsFor(all, 'wall').length >= WALLS.length + 2)
  for (const t of ['rug', 'server-rack', 'sofa', 'desk', 'chair', 'armchair', 'aquarium', 'plant'] as const) assert.ok(variantsFor(all, t).length >= 2, `${t}: at least two looks`)
  assert.ok(all.some((v) => v.sprite), 'one look is a sprite')
  assert.equal(new Set(all.map((v) => v.id)).size, all.length, 'ids are unique')
})

test('a broken pack says what is wrong, line by line, and the good ones still load', async () => {
  const bad = parsePack(
    {
      format: 1,
      id: 'test',
      name: 'Тест',
      variants: [
        { id: 'ok', name: 'Хорошо', target: 'sofa', palette: { sofa: '#112233' } },
        { id: 'x1', name: 'Нет цели', target: 'teapot', palette: {} },
        { id: 'x2', name: 'Чужой цвет', target: 'desk', palette: { deskTop: 'red', nope: '#000000' } },
        { id: 'x3', name: 'Кривой спрайт', target: 'plant', sprite: { w: 4, h: 2, legend: { a: '#00ff00', '.': '#000000' }, rows: ['aaa', 'aaz'] } },
        { id: 'x4', name: 'Слишком большой', target: 'plant', sprite: { w: 99, h: 2, legend: {}, rows: [] } },
        { id: 'x5', name: 'Пол без основы', target: 'floor', palette: { wood: '#123456' } },
        { id: 'x6', name: 'Спрайт стены', target: 'wall', base: 'plain', sprite: { w: 1, h: 1, legend: { a: '#000000' }, rows: ['a'] } },
        { id: 'ok', name: 'Повтор', target: 'sofa', palette: { sofa: '#112233' } }
      ]
    },
    'skins/test.json'
  )
  assert.deepEqual(bad.pack?.variants.map((v) => v.id), ['test:ok'], 'only the good variant stays')
  const text = bad.errors.join('\n')
  for (const part of ['variants[1].target', 'variants[2].palette.deskTop', 'variants[2].palette.nope', 'variants[3].sprite.legend..', 'variants[3].sprite.rows[0]', 'variants[4].sprite', 'variants[5].base', 'variants[6].sprite', 'variants[7].id']) {
    assert.ok(text.includes(part), `${part} in:\n${text}`)
  }
  assert.equal(parsePack({ format: 2, id: 'Bad', name: '' }, 'skins/x.json').pack, null)
  const files: Record<string, unknown> = { 'index.json': ['day.json', 'junk.json', '../evil.json', 'gone.json'], 'day.json': await read('day.json'), 'junk.json': 'not an object' }
  const loaded = await loadPacks(async (f) => {
    if (!(f in files)) throw new Error('нет файла')
    return files[f]
  })
  assert.deepEqual(loaded.packs.map((p) => p.id), ['day'])
  for (const part of ['junk.json', 'evil', 'gone.json']) assert.ok(loaded.errors.some((e) => e.includes(part)), part)
  const offline = await loadPacks(async () => {
    throw new Error('offline')
  })
  assert.deepEqual(offline.packs, [])
  assert.equal(offline.errors.length, 1)
})

test('choices: apply, store, read back; unknown looks are dropped; «по умолчанию» clears', async () => {
  const world = realMap()
  const { packs } = await loadPacks(read)
  const known = new Set([...builtinVariants(), ...packs.flatMap((p) => p.variants)].map((v) => v.id))
  const sofa = world.furniture.find((f) => f.type === 'sofa')!
  const sofas = world.furniture.filter((f) => f.type === 'sofa').map(itemKey)
  let d = chooseRoom(emptyDecor(), 'office-1', 'floor', 'office-plus:checker')
  d = chooseRoom(d, 'office-1', 'wall', 'builtin:wall:sage')
  d = chooseItems(d, [itemKey(sofa)], 'office-plus:coral-sofa')
  d = chooseItems(d, sofas, 'office-plus:green-sofa')
  const stored = parseDecor(JSON.parse(JSON.stringify(serializeDecor(d))), known)
  assert.deepEqual(stored.rooms['office-1'], { floor: 'office-plus:checker', wall: 'builtin:wall:sage' })
  for (const k of sofas) assert.equal(stored.items[k], 'office-plus:green-sofa', 'the same for every sofa')
  // A pack that is gone: its looks are forgotten, the rest stays.
  const fewer = parseDecor(serializeDecor(d), new Set([...known].filter((id) => !id.startsWith('office-plus:'))))
  assert.deepEqual(fewer.rooms['office-1'], { wall: 'builtin:wall:sage' })
  assert.deepEqual(fewer.items, {})
  assert.deepEqual(chooseRoom(chooseRoom(d, 'office-1', 'floor', null), 'office-1', 'wall', null).rooms['office-1'], undefined)
  assert.deepEqual(parseDecor('junk', known), emptyDecor())
})

test('a skin draws: recolours swap palette colours only while drawing; sprites follow the theme colours', async () => {
  const { packs } = await loadPacks(read)
  const all = new Map([...builtinVariants(), ...packs.flatMap((p) => p.variants)].map((v) => [v.id, v]))
  const plain = pixels()
  paintSkinnedItem(plain.paint, { type: 'sofa', w: 3, h: 1, facing: 'down' }, null, {}, 20)
  const green = pixels()
  paintSkinnedItem(green.paint, { type: 'sofa', w: 3, h: 1, facing: 'down' }, all.get('office-plus:green-sofa')!, {}, 20)
  assert.ok([...plain.map.values()].includes(P.sofa))
  assert.ok([...green.map.values()].includes('#4f9a6a') && ![...green.map.values()].includes(BASE_PALETTE.sofa))
  assert.equal(P.sofa, BASE_PALETTE.sofa, 'the palette is back after drawing')
  assert.throws(() => withPalette({ sofa: '#000000' }, () => { throw new Error('boom') }))
  assert.equal(P.sofa, BASE_PALETTE.sofa, 'back even after a throw')
  const fern = pixels()
  paintSkinnedItem(fern.paint, { type: 'plant', w: 1, h: 1, facing: 'down' }, all.get('office-plus:fern')!, {}, 20)
  assert.ok([...fern.map.values()].includes(P.leaf), '«@leaf» is the palette leaf')
  for (const key of fern.map.keys()) {
    const [x, y] = key.split(',').map(Number)
    assert.ok(x >= 0 && x < 16 && y >= 0 && y < 36, 'inside the footprint and headroom')
  }
  const floor = pixels()
  paintSkinnedTile(floor.paint, all.get('office-plus:checker')!, 0, 0)
  assert.equal(floor.map.size, 256, 'a sprite floor fills its tile')
  const s = pixels()
  drawSprite(s.paint, { w: 2, h: 2, legend: { a: '#010203' }, rows: ['a.', ' a'] }, 5, 10)
  assert.deepEqual([...s.map.entries()].sort(), [['5,8', '#010203'], ['6,9', '#010203']])
})

test('the renderer redraws with the owner’s looks: floors, walls, things, desk chairs', async () => {
  const world = realMap()
  const { packs } = await loadPacks(read)
  const all = new Map([...builtinVariants(), ...packs.flatMap((p) => p.variants)].map((v) => [v.id, v]))
  const fills: string[] = []
  const canvas = (w: number, h: number) =>
    ({ width: w, height: h, getContext: () => ({ set fillStyle(c: string) { fills.push(c) }, fillRect() {}, drawImage() {}, imageSmoothingEnabled: false }) }) as unknown as Canvas
  const r = new Renderer(world, canvas)
  const chair = deskChair(world.desks[0])
  r.setDecor({
    room: (room, part) => (room === 'office-1' && part === 'floor' ? all.get('office-plus:checker')! : null),
    item: (item) => (itemKey(item) === itemKey(chair) ? all.get('office-plus:red-chair')! : null)
  })
  const screen = { fillStyle: '', fillRect() {}, drawImage() {}, save() {}, restore() {}, setLineDash() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, strokeRect() {}, measureText: () => ({ width: 10 }), fillText() {}, imageSmoothingEnabled: false, globalAlpha: 1, font: '', textAlign: '', textBaseline: '', lineWidth: 1, strokeStyle: '' }
  r.draw(screen as unknown as CanvasRenderingContext2D, { camera: { x: world.width * 8, y: world.height * 8, zoom: 1 }, view: { width: 2000, height: 1400 }, actors: [], labels: new Map(), desks: new Map(), typingFrame: 0, bobFrame: 0, dpr: 1, hover: null })
  assert.ok(fills.includes('#2c2a33'), 'the checker floor is drawn')
  assert.ok(fills.includes('#a8403f'), 'the red chair is drawn')
})

test('the example pack in docs/ is valid as written', () => {
  const raw = JSON.parse(readFileSync(here('../../docs/examples/neon.json'), 'utf8'))
  const { pack, errors } = parsePack(raw, 'docs/examples/neon.json')
  assert.deepEqual(errors, [])
  assert.equal(pack?.variants.length, 4)
  assert.ok(pack?.variants.some((v) => v.sprite) && pack?.variants.some((v) => v.palette))
})
