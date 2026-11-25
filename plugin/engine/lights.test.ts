import { assert, test } from 'orca/testing'
import { realMap } from './fixtures'
import { stopsOf } from './life'
import {
  appliancesInUse,
  buildLightMap,
  collectLights,
  falloff,
  LIGHT_CELL,
  LightCache,
  lightKey,
  roomScreen,
  screenOf,
  standTile,
  workScreen,
  type LightInputs
} from './lights'
import { TILE } from './catalog'

const NIGHT = { color: '#060a26', alpha: 0.6 }
const none: LightInputs = { on: true, off: new Set(), using: new Set(), screens: new Map() }

test('light: off by day, on in the evening and at night, from the lamps the map places', () => {
  const world = realMap()
  assert.deepEqual(collectLights(world, { ...none, on: false }), [], 'by day nothing shines')
  const lights = collectLights(world, none)
  const kinds = new Set(lights.map((l) => l.key.split(':')[1]))
  for (const kind of ['floor-lamp', 'wall-lamp', 'desk-lamp', 'candles', 'garland', 'neon-sign', 'night-light', 'ceo-desk', 'aquarium', 'server-rack']) {
    assert.ok(kinds.has(kind), `${kind} shines at night`)
  }
  // Where the owner asked for light: the open space aisles and the hall, the offices, the CEO, the kitchen.
  const rooms = new Set(lights.map((l) => l.room))
  for (const room of ['teams', 'hall', 'ceo', 'reception', 'office-1', 'office-2', 'office-3', 'lounge']) assert.ok(rooms.has(room), `light in ${room}`)
  assert.ok(lights.filter((l) => l.room === 'teams' && l.key.includes('floor-lamp')).length >= 6, 'floor lamps along the aisles of «Команды и отделы»')
  assert.ok(lights.some((l) => l.key.includes('candles') && l.flicker), 'candles flicker')
  // Appliances and screens only while used.
  assert.ok(!lights.some((l) => /microwave|fridge|coffee-machine|screen:/.test(l.key)), 'nothing in use, no screen lit')
})

test('light: a monitor shines while its bot works, shows a screensaver while it is away, and is off when nobody owns the desk', () => {
  const world = realMap()
  assert.equal(screenOf({ working: true, owned: true, role: 'CTO', office: null, key: 'a' }), 'logs')
  assert.equal(screenOf({ working: true, owned: true, role: 'CSO', office: null, key: 'a' }), 'chart')
  assert.equal(screenOf({ working: true, owned: true, role: 'assistant', office: null, key: 'a' }), 'chat')
  assert.equal(screenOf({ working: true, owned: true, role: '', office: null, key: 'a' }), 'code')
  // By the office when the role says nothing: logs by the server racks, charts in sales.
  assert.equal(roomScreen(world, 'office-1'), 'logs')
  assert.equal(roomScreen(world, 'office-2'), 'chart')
  assert.equal(workScreen('', roomScreen(world, 'office-1')), 'logs')
  const idle = ['t1', 't2', 't3', 't4'].map((key) => screenOf({ working: false, owned: true, role: 'CTO', office: null, key }))
  assert.ok(idle.every((k) => k === 'saver-logo' || k === 'saver-stars'), 'away: a screensaver')
  assert.ok(new Set(idle).size === 2, 'flying logos and stars, by desk')
  assert.equal(screenOf({ working: false, owned: false, role: 'CTO', office: null, key: 'a' }), 'off', 'nobody’s desk: dark')
  // In the light: a working screen glows strongly on the desk and the face, a screensaver faintly, an off one not at all.
  const desk = world.desks.find((d) => d.room === 'teams')!
  const other = world.desks.find((d) => d.room === 'teams' && d.id !== desk.id)!
  const lights = collectLights(world, { ...none, screens: new Map([[desk.id, 'code'], [other.id, 'saver-stars']]) })
  const work = lights.find((l) => l.key === `screen:${desk.id}`)!
  const saver = lights.find((l) => l.key === `screen:${other.id}`)!
  assert.ok(work && saver)
  assert.ok(work.strength > saver.strength && work.radius > saver.radius)
  assert.ok(Math.abs(work.x - (desk.x + 1) * TILE) < TILE, 'over the middle of the desk')
  assert.equal(collectLights(world, { ...none, screens: new Map([[desk.id, 'off']]) }).filter((l) => l.key.startsWith('screen:')).length, 0)
})

test('light: the microwave, the coffee machine and the fridge shine only while a bot uses them', () => {
  const world = realMap()
  const appliance = (type: string) => world.furniture.find((f) => f.type === type)!
  const microwave = appliance('microwave')
  const fridge = appliance('fridge')
  const coffee = appliance('coffee-machine')
  const at = (item: typeof microwave, walking = false, facing = 'up') => ({ walking, target: { ...standTile(item), facing } })
  assert.deepEqual([...appliancesInUse(world, [])], [])
  assert.deepEqual([...appliancesInUse(world, [at(microwave)])], [lightKey(microwave)], 'standing at the microwave: in use')
  assert.deepEqual([...appliancesInUse(world, [at(microwave, true)])], [], 'walking past: not in use')
  assert.deepEqual([...appliancesInUse(world, [at(microwave, false, 'down')])], [], 'its back to it: not in use')
  const using = appliancesInUse(world, [at(fridge), at(coffee)])
  assert.ok(using.has(lightKey(fridge)) && using.has(lightKey(coffee)) && !using.has(lightKey(microwave)))
  const lit = collectLights(world, { ...none, using })
  assert.ok(lit.some((l) => l.key === lightKey(fridge)) && lit.some((l) => l.key === lightKey(coffee)))
  assert.ok(!lit.some((l) => l.key === lightKey(microwave)), 'the microwave nobody uses stays dark')
  // «Жизнь» sends resting bots there: the microwave and the fridge are stops in the kitchen.
  const stops = stopsOf(world).rest
  for (const item of [microwave, fridge, coffee]) assert.ok(stops.some((s) => s.x === standTile(item).x && s.y === standTile(item).y && s.facing === 'up'), `${item.type} is a stop`)
  assert.ok(stops.some((s) => s.doing.includes('микроволнов')))
})

test('light: a lamp switched off stays dark and its light leaves the map', () => {
  const world = realMap()
  const lamp = world.furniture.find((f) => f.type === 'floor-lamp' && f.room === 'teams')!
  const on = collectLights(world, none)
  const off = collectLights(world, { ...none, off: new Set([lightKey(lamp)]) })
  assert.ok(on.some((l) => l.key === lightKey(lamp)))
  assert.ok(!off.some((l) => l.key === lightKey(lamp)))
  assert.equal(off.length, on.length - 1)
  // A pack's look changes the light's colour and reach.
  const looked = collectLights(world, { ...none, look: (item) => (item === lamp ? { light: { color: '#b8ffd8', radius: 30 } } : null) })
  const l = looked.find((x) => x.key === lightKey(lamp))!
  assert.equal(l.color, '#b8ffd8')
  assert.equal(l.radius, 30)
})

test('light map: pools of light in soft pixel rings, on the floor and walls of their own room only', () => {
  const world = realMap()
  const lamp = world.furniture.find((f) => f.type === 'floor-lamp' && f.room === 'teams')!
  const light = collectLights(world, none).find((l) => l.key === lightKey(lamp))!
  const map = buildLightMap(world, [light], NIGHT)
  const alphaAt = (x: number, y: number) => map.shade[(Math.floor(y / LIGHT_CELL) * map.w + Math.floor(x / LIGHT_CELL)) * 4 + 3]
  const dark = Math.round(255 * NIGHT.alpha)
  assert.ok(alphaAt(light.x, light.y) < dark * 0.4, 'under the lamp: mostly light')
  assert.ok(alphaAt(light.x + light.radius * 0.6, light.y) < dark && alphaAt(light.x + light.radius * 0.6, light.y) > alphaAt(light.x, light.y), 'fading out')
  assert.equal(alphaAt(light.x + light.radius + 8, light.y), dark, 'past its reach: the dark')
  // Rings, not a smooth gradient: few distinct levels.
  const levels = new Set<number>()
  for (let d = 0; d < light.radius; d += 1) levels.add(alphaAt(light.x + d, light.y))
  assert.ok(levels.size <= 6, `soft pixel rings (${levels.size} levels)`)
  assert.ok(falloff(0, 10) === 1 && falloff(10, 10) === 0)
  // Never through a wall: a lamp by the wall of the team room does not light the hall behind it.
  const hall = world.rooms.find((r) => r.id === 'hall')!
  const wallLamp = { ...light, x: (hall.x + 5) * TILE, y: (hall.y + hall.h) * TILE + 6, radius: 60 }
  const m2 = buildLightMap(world, [wallLamp], NIGHT)
  const a2 = (x: number, y: number) => m2.shade[(Math.floor(y / LIGHT_CELL) * m2.w + Math.floor(x / LIGHT_CELL)) * 4 + 3]
  assert.equal(a2(wallLamp.x, (hall.y + 2) * TILE), dark, 'the hall stays dark')
  assert.ok(a2(wallLamp.x, wallLamp.y + 4) < dark, 'its own room is lit')
  // The glow is warm and only where light falls.
  assert.equal(map.glow[(Math.floor((light.y + 300) / LIGHT_CELL) * map.w + Math.floor(light.x / LIGHT_CELL)) * 4 + 3] ?? 0, 0)
})

test('light map: built once per change, not per frame', () => {
  const cache = new LightCache<number>()
  let builds = 0
  const build = () => (builds += 1)
  cache.get('night|a', build)
  cache.get('night|a', build)
  cache.get('night|a', build)
  assert.equal(builds, 1)
  cache.get('night|b', build)
  assert.equal(builds, 2)
  assert.equal(cache.builds, 2)
  cache.reset()
  cache.get('night|b', build)
  assert.equal(builds, 3, 'a new look or theme: built again')
})
