import { assert, test } from 'orca/testing'
import { realMap } from './fixtures'
import { stopsOf } from './life'
import {
  ACCENT_MAX,
  lightReach,
  appliancesInUse,
  buildLightMap,
  lampField,
  LIGHT_CELL,
  ROOM_LIT,
  collectLights,
  CORRIDOR_LEVEL,
  LightCache,
  lightKey,
  occupiedRooms,
  ROOM_FADE_MS,
  RoomLights,
  roomScreen,
  roomTargets,
  screenOf,
  standTile,
  workScreen,
  type LightInputs
} from './lights'
import { TILE } from './catalog'

const NIGHT = { color: '#2e3268', alpha: 1 }
const LIT = { color: '#fff0da', alpha: 1 }
const none: LightInputs = { on: true, off: new Set(), using: new Set(), screens: new Map() }

test('light: off by day, on in the evening and at night, from the lamps the map places', () => {
  const world = realMap()
  assert.deepEqual(collectLights(world, { ...none, on: false }), [], 'by day nothing shines')
  const lights = collectLights(world, none)
  const kinds = new Set(lights.map((l) => l.key.split(':')[1]))
  for (const kind of ['floor-lamp', 'wall-lamp', 'desk-lamp', 'candles', 'garland', 'neon-sign', 'night-light', 'ceo-desk', 'aquarium', 'server-rack']) {
    assert.ok(kinds.has(kind), `${kind} shines at night`)
  }
  const rooms = new Set(lights.map((l) => l.room))
  for (const room of ['teams', 'hall', 'ceo', 'reception', 'office-1', 'office-2', 'office-3', 'lounge']) assert.ok(rooms.has(room), `light in ${room}`)
  // Lamps stand where they would in a real office: nothing on the floor of the team room or the hall, no rows.
  const floorLamps = world.furniture.filter((f) => f.type === 'floor-lamp')
  assert.ok(!floorLamps.some((f) => f.room === 'teams' || f.room === 'hall'), 'no floor lamps in «Команды и отделы» or the hall')
  assert.ok(floorLamps.length <= 3, `a floor lamp or two by the sofas, the reception, the CEO (${floorLamps.length})`)
  for (const room of new Set(floorLamps.map((f) => f.room))) assert.ok(floorLamps.filter((f) => f.room === room).length <= 2, `${room}: at most two`)
  // A lamp's own light: a halo two tiles round at most, never a disc across the floor.
  for (const l of lights) assert.ok(l.radius <= ACCENT_MAX, `${l.key}: a radius of two tiles at most (${l.radius} px)`)
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
  const lamp = world.furniture.find((f) => f.type === 'floor-lamp' && f.room === 'lounge')!
  const on = collectLights(world, none)
  const off = collectLights(world, { ...none, off: new Set([lightKey(lamp)]) })
  assert.ok(on.some((l) => l.key === lightKey(lamp)))
  assert.ok(!off.some((l) => l.key === lightKey(lamp)))
  assert.equal(off.length, on.length - 1)
  // A pack's look changes the light's colour and reach, but an accent stays two tiles across at most.
  const looked = collectLights(world, { ...none, look: (item) => (item === lamp ? { light: { color: '#b8ffd8', radius: 20 } } : null) })
  const l = looked.find((x) => x.key === lightKey(lamp))!
  assert.equal(l.color, '#b8ffd8')
  assert.equal(l.radius, 20)
  const big = collectLights(world, { ...none, look: (item) => (item === lamp ? { light: { radius: 90 } } : null) }).find((x) => x.key === lightKey(lamp))!
  assert.equal(big.radius, ACCENT_MAX)
})

test('light by rooms: an empty room stays dark, a room with someone in it is lit evenly wall to wall, the hall dimly', () => {
  const world = realMap()
  const teams = world.rooms.find((r) => r.id === 'teams')!
  const desk = world.desks.find((d) => d.room === 'teams')!
  const occupied = occupiedRooms(world, [{ x: desk.seat.x, y: desk.seat.y }])
  assert.deepEqual([...occupied], ['teams'])
  const targets = roomTargets(world, occupied)
  assert.equal(targets.get('teams'), 1)
  assert.equal(targets.get('lounge'), 0)
  assert.equal(targets.get('hall'), CORRIDOR_LEVEL)
  const none = lampField(world, [])
  const map = buildLightMap(world, targets, none, NIGHT, LIT)
  const cellAt = (px: number, py: number) => {
    const i = Math.floor(py / LIGHT_CELL) * none.w + Math.floor(px / LIGHT_CELL)
    return [...map.slice(i * 4, i * 4 + 4)].join(',')
  }
  const floorOf = (room: string) => {
    const out = new Set<string>()
    for (let i = 0; i < world.tiles.length; i += 1) {
      if (world.tiles[i] !== 'floor' || world.roomAt[i] !== room) continue
      const x = (i % world.width) * TILE
      const y = Math.floor(i / world.width) * TILE
      for (const [dx, dy] of [[1, 1], [9, 13]]) out.add(cellAt(x + dx, y + dy))
    }
    return out
  }
  // Even: one value over the whole floor of each room, no pools.
  assert.equal(floorOf('teams').size, 1, 'the lit room is one even tone')
  assert.equal(floorOf('lounge').size, 1, 'the dark room is one even tone')
  assert.equal(floorOf('hall').size, 1, 'the hall is one even tone')
  const sum = (room: string) => [...floorOf(room)][0].split(',').slice(0, 3).map(Number).reduce((a, b) => a + b, 0)
  assert.equal([...floorOf('lounge')][0], '46,50,104,255', 'empty: the full night')
  assert.ok(sum('teams') > sum('hall') && sum('hall') > sum('lounge'), 'lit > the hall > dark')
  // The lit room's top wall too: wall to wall.
  assert.equal(cellAt((teams.x + 5) * TILE + 4, teams.y * TILE + 8), [...floorOf('teams')][0])
  // The night is cold blue-violet.
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(NIGHT.color.slice(i, i + 2), 16))
  assert.ok(b > r && b > g && r + g + b < 3 * 110)
  assert.ok(ROOM_LIT < 1, 'a lit room stays a little under day, so a lamp in it still shows')
})

test('light at night is never brighter than by day, and never above 1 where lamps overlap', () => {
  const world = realMap()
  const lounge = world.rooms.find((r) => r.id === 'lounge')!
  // Two and three strong lamps on the same spot and next to each other.
  const at = { x: (lounge.x + 8) * TILE, y: (lounge.y + 9) * TILE }
  const lamp = (dx: number, color: string) => ({ key: `t${dx}${color}`, x: at.x + dx, y: at.y, radius: 60, color, strength: 1, flicker: false, room: 'lounge' })
  for (const lights of [[lamp(0, '#ffc879'), lamp(0, '#ffffff')], [lamp(0, '#ffc879'), lamp(8, '#ffd38a'), lamp(-8, '#dff2ff')]]) {
    const field = lampField(world, lights)
    let max = 0
    for (const v of field.l) max = Math.max(max, v)
    assert.ok(max <= 1, `(б) the light map stays ≤ 1 (${max})`)
    assert.ok(max > 0.95, 'and is full where the lamps are')
    for (const levels of [new Map([['lounge', 0]]), new Map([['lounge', 1]])]) {
      const map = buildLightMap(world, levels, field, NIGHT, LIT)
      // (а) multiplied over any scene, every channel ≤ the day's: the factors never pass 255.
      for (let i = 0; i < map.length; i += 4) for (let c = 0; c < 3; c += 1) assert.ok(map[i + c] <= 255)
      const day = [200, 120, 40]
      const ci = Math.floor(at.y / LIGHT_CELL) * field.w + Math.floor(at.x / LIGHT_CELL)
      const night = day.map((v, c) => (v * map[ci * 4 + c]) / 255)
      for (let c = 0; c < 3; c += 1) assert.ok(night[c] <= day[c], `(а) not brighter than day at the overlap (${night[c]} > ${day[c]})`)
      assert.ok(night[0] > day[0] * 0.85, 'under the lamps the scene shows its own colours, nearly as by day')
    }
  }
})

test('light by rooms: switching on and off fades over about 0.7 s, without a jump', () => {
  const lights = new RoomLights()
  lights.set(new Map([['a', 0]]), 0)
  assert.equal(lights.now.get('a'), 0, 'the first frame: straight where it should be')
  lights.set(new Map([['a', 1]]), 1000)
  assert.ok(lights.moving())
  const seen: number[] = []
  for (let t = 1000; t <= 1000 + ROOM_FADE_MS + 100; t += 50) {
    lights.step(t)
    seen.push(lights.now.get('a')!)
  }
  for (let i = 1; i < seen.length; i += 1) assert.ok(seen[i] - seen[i - 1] <= 50 / ROOM_FADE_MS + 1e-9, 'no jump')
  assert.ok(seen[7] > 0.3 && seen[7] < 0.7, `half way after ~0.35 s (${seen[7]})`)
  assert.equal(seen.at(-1), 1)
  assert.ok(!lights.moving())
  assert.ok(ROOM_FADE_MS >= 500 && ROOM_FADE_MS <= 1000)
  const sig = lights.signature()
  lights.step(5000)
  assert.equal(lights.signature(), sig, 'still: the same signature, the shade is not built again')
})

test('lamps light their own room only: a wall stops the light, a doorway lets through only a little', () => {
  const world = realMap()
  const W = world.width
  const lAt = (f: { w: number; l: Float32Array }, x: number, y: number) => f.l[Math.floor(y / LIGHT_CELL) * f.w + Math.floor(x / LIGHT_CELL)]
  // A lamp by the wall between two offices (the server room and sales share a wall at x 28).
  const server = world.rooms.find((r) => r.id === 'office-1')!
  const sales = world.rooms.find((r) => r.id === 'office-2')!
  assert.equal(server.x + server.w - 1, sales.x, 'the two offices share a wall')
  const wall = sales.x * TILE
  const light = { key: 'test', x: wall - 6, y: (server.y + 6) * TILE, radius: 60, color: '#ffd38a', strength: 0.9, flicker: false, room: server.id }
  const f = lampField(world, [light])
  assert.ok(lAt(f, wall - 8, light.y) > 0.5, 'its own room is lit')
  for (let x = wall + TILE; x < wall + 50; x += 1) assert.equal(lAt(f, x, light.y), 0, `nothing behind the wall (${x})`)
  const reach = lightReach(world, light)
  for (let y = sales.y; y < sales.y + sales.h; y += 1) for (let x = sales.x + 1; x < sales.x + 4; x += 1) assert.ok(!reach.has(y * W + x), 'the next room stays dark')
  // A lamp in the hall by an office door: inside the office only a faint light, far less than in the hall.
  const door = world.doors.find((d) => d.y === 13 && d.x === 23)!
  const hallLight = { ...light, x: door.x * TILE + 8, y: (door.y + 2) * TILE + 8, room: 'hall' }
  const f2 = lampField(world, [hallLight])
  const hall = lAt(f2, hallLight.x, hallLight.y + 10)
  const inside = lAt(f2, hallLight.x, (door.y - 1) * TILE + 8)
  assert.ok(inside > 0 && inside < hall * 0.2, `a little through the doorway (${inside.toFixed(3)} vs ${hall.toFixed(3)})`)
  // Smooth inside a room: no step between cells.
  let worst = 0
  for (let x = wall - 50; x < wall - 2; x += LIGHT_CELL) worst = Math.max(worst, Math.abs(lAt(f, x, light.y) - lAt(f, x + LIGHT_CELL, light.y)))
  assert.ok(worst <= 0.06, `no steps (${worst.toFixed(3)})`)
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
