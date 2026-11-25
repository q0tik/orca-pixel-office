import { readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import { BASE_PALETTE } from '../editor/palette'
import { realMap } from './fixtures'
import { seededRandom } from './life'
import { loadSpecies, parseAnimalChoices, parseSpecies, spotsFor, Zoo, type Species } from './animals'
import { walkable } from './world'

const here = (file: string) => new URL(file, import.meta.url).pathname
const KEYS = new Set(Object.keys(BASE_PALETTE))
const read = async (file: string) => JSON.parse(readFileSync(here(`../office/animals/${file}`), 'utf8'))

async function shipped(): Promise<Species[]> {
  const { species, errors } = await loadSpecies(read, KEYS)
  assert.deepEqual(errors, [])
  return species
}

test('the shipped animals load clean: cats, a dog and a parrot, as data', async () => {
  const species = await shipped()
  assert.deepEqual(species.map((s) => s.id), ['cat', 'dog', 'parrot'])
  for (const s of species) {
    assert.ok(s.instances.length >= 1 && s.coats.length >= 2, `${s.id}: an animal and coats to pick`)
    assert.equal(s.license, 'MIT')
  }
  const cat = species.find((s) => s.id === 'cat')!
  for (const at of ['sofa', 'desk', 'window', 'bot', 'aquarium'] as const) assert.ok(cat.routines.some((r) => r.at === at), `the cat goes to: ${at}`)
  const dog = species.find((s) => s.id === 'dog')!
  for (const at of ['bot', 'owner-door', 'bowl'] as const) assert.ok(dog.routines.some((r) => r.at === at), `the dog goes to: ${at}`)
  assert.ok(dog.routines.find((r) => r.at === 'bot')!.follow, 'the dog follows a bot')
  const parrot = species.find((s) => s.id === 'parrot')!
  assert.equal(parrot.moves, 'fly')
  for (const at of ['cage', 'shelf', 'shoulder'] as const) assert.ok(parrot.routines.some((r) => r.at === at), `the parrot goes to: ${at}`)
})

test('the example species in docs/ is valid as written', () => {
  const { species, errors } = parseSpecies(JSON.parse(readFileSync(here('../../docs/examples/turtle.json'), 'utf8')), 'docs/examples/turtle.json', KEYS)
  assert.deepEqual(errors, [])
  assert.equal(species?.instances[0].id, 'turtle-tortila')
})

test('a broken species file says what is wrong and loads nothing', () => {
  const { species, errors } = parseSpecies(
    {
      format: 1,
      id: 'Bad',
      name: '',
      moves: 'swim',
      speed: 0,
      size: [100, 2],
      rooms: ['attic'],
      coats: [],
      instances: [],
      sprites: { legend: { a: 'red' }, walk: [], sit: [['x']] },
      routines: [{ at: 'moon', pose: 'sit', stay: [1, 2] }, { at: 'shoulder', pose: 'sit', stay: [1, 2] }]
    },
    'animals/bad.json',
    KEYS
  )
  assert.equal(species, null)
  const text = errors.join('\n')
  for (const part of ['id:', 'name:', 'moves:', 'speed:', 'size:', 'rooms:', 'sprites.legend.a', 'coats:', 'instances:', 'routines[0].at', 'routines[1].at']) assert.ok(text.includes(part), `${part} in:\n${text}`)
})

test('animals go where their routines say, never on furniture they cannot stand on, and never block anyone', async () => {
  const world = realMap()
  const species = await shipped()
  const zoo = new Zoo(world, seededRandom(5))
  zoo.sync(species, {}, 0)
  const bots = [{ key: 'a', x: 40, y: 28, walking: false }]
  const seen = new Map<string, Set<string>>()
  for (let t = 0; t <= 20 * 60_000; t += 100) {
    zoo.tick(t, bots)
    for (const v of zoo.views(t, 0)) {
      const s = seen.get(v.id) ?? new Set<string>()
      if (v.pose !== 'walk' && v.pose !== 'fly') s.add(v.doing)
      seen.set(v.id, s)
      if (v.pose === 'walk') assert.ok(walkable(world, Math.round(v.x), Math.round(v.y), true), `${v.id} walks on the floor at (${v.x},${v.y})`)
    }
  }
  assert.equal(seen.size, 4, 'two cats, a dog, a parrot')
  for (const [id, did] of seen) assert.ok(did.size >= 3, `${id} does several things: ${[...did].join(', ')}`)
  // Animals never enter the map's blocking: bots still walk everywhere.
  assert.ok(walkable(world, 40, 28))
})

test('switched off animals leave; a coat choice is kept; junk reads as nothing', async () => {
  const world = realMap()
  const species = await shipped()
  const zoo = new Zoo(world, seededRandom(1))
  zoo.sync(species, parseAnimalChoices(JSON.parse(JSON.stringify({ 'cat-murka': { off: true }, 'dog-bobik': { coat: 'spotty' } }))), 0)
  const ids = zoo.views(0, 0).map((v) => v.id)
  assert.ok(!ids.includes('cat-murka') && ids.includes('cat-ryzhik'))
  assert.equal(zoo.views(0, 0).find((v) => v.id === 'dog-bobik')!.coat, 'spotty')
  assert.deepEqual(parseAnimalChoices('junk'), {})
  assert.deepEqual(parseAnimalChoices({ x: { off: 'yes', coat: 3 } }), {})
})

test('places: a cat sleeps on a desk or a sill (perched), the parrot rides a bot’s shoulder and follows it', async () => {
  const world = realMap()
  const species = await shipped()
  const cat = species.find((s) => s.id === 'cat')!
  const desk = spotsFor(world, cat, 'desk', [])[0]
  assert.ok(desk.perch && desk.dy < 0 && walkable(world, desk.x, desk.y), 'walks to the desk, hops up')
  assert.ok(spotsFor(world, cat, 'window', []).every((s) => s.perch && s.perch.y === s.y - 1), 'the sill is above the tile it walks to')
  const parrot = species.find((s) => s.id === 'parrot')!
  const only = { ...parrot, routines: parrot.routines.filter((r) => r.at === 'shoulder').map((r) => ({ ...r, stay: [600, 600] as [number, number] })) }
  const zoo = new Zoo(world, seededRandom(2))
  const bot = { key: 'b', x: 44, y: 22, walking: false }
  zoo.sync([only], {}, 0)
  for (let t = 0; t <= 20_000; t += 100) zoo.tick(t, [bot])
  let v = zoo.views(20_000, 0)[0]
  assert.deepEqual([v.x, v.y, v.over], [44, 22, 'b'], 'on the shoulder')
  bot.x = 45
  zoo.tick(20_100, [bot])
  v = zoo.views(20_100, 0)[0]
  assert.equal(v.x, 45, 'rides along')
})
