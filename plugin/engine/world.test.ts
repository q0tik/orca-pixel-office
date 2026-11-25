import { assert, test } from 'orca/testing'
import { findPath } from './path'
import { realMap, tinyMap } from './fixtures'
import { parseMap, walkable } from './world'

test('the real office map is valid and has every department', () => {
  const world = realMap()
  const kinds = new Set(world.rooms.map((room) => room.kind))
  for (const kind of ['owner', 'reception', 'clevel', 'team', 'lounge', 'corridor'] as const) assert.ok(kinds.has(kind), kind)
  assert.ok(!world.rooms.some((room) => /meeting|переговор/i.test(`${room.id} ${room.label}`)), 'no meeting room any more')
  assert.ok(world.width >= 48 && world.height >= 32, 'a big office')
  const offices = world.rooms.filter((room) => room.kind === 'clevel')
  assert.ok(offices.length >= 5, 'four C-level offices and the mini office')
  for (const office of offices) {
    const desks = world.desks.filter((desk) => desk.room === office.id)
    assert.equal(desks.length, 1, `${office.id}: one desk, one bot`)
    assert.ok(world.doors.some((door) => door.room === office.id), `${office.id} has its own door`)
  }
  // Every office looks different: its floor, its wall or its furniture.
  const looks = offices.map((office) => {
    const things = world.furniture.filter((item) => item.room === office.id).map((item) => `${item.type}:${item.variant ?? ''}`).sort()
    return `${office.floor}|${office.wall}|${things.join(',')}`
  })
  assert.equal(new Set(looks).size, offices.length, 'no two offices alike')
  assert.equal(new Set(offices.map((office) => office.floor)).size, offices.length, 'a floor of its own each')
  assert.ok(world.desks.filter((desk) => desk.roomKind === 'team').length >= 8, 'empty desks for teams')
  assert.ok(world.doors.some((door) => door.owner))
  assert.ok(world.furniture.some((item) => item.type === 'ceo-desk' && item.room === 'ceo'), 'the owner desk')
  assert.ok(world.spots.some((spot) => spot.kind === 'owner-wait'))
  assert.ok(world.spots.some((spot) => spot.kind === 'sofa'))
  assert.ok(world.spots.some((spot) => spot.kind === 'kitchen'))
})

test('the owner office is entered only through the reception; the mini office opens into it', () => {
  const world = realMap()
  const owner = world.rooms.find((room) => room.kind === 'owner')!
  const reception = world.rooms.find((room) => room.kind === 'reception')!
  const at = (x: number, y: number) => world.roomAt[y * world.width + x]
  // Every door of the owner office leads into the reception, none into the corridor.
  const ownerDoors = world.doors.filter((door) => {
    const sides = door.orientation === 'h' ? [at(door.x, door.y - 1), at(door.x, door.y + 1)] : [at(door.x - 1, door.y), at(door.x + 1, door.y)]
    return sides.includes(owner.id)
  })
  assert.ok(ownerDoors.length >= 1)
  for (const door of ownerDoors) {
    const sides = door.orientation === 'h' ? [at(door.x, door.y - 1), at(door.x, door.y + 1)] : [at(door.x - 1, door.y), at(door.x + 1, door.y)]
    assert.ok(sides.includes(reception.id), 'the owner door opens into the reception')
  }
  // «Waits for the owner»: in the reception, and the walk there from the corridor goes through its door.
  for (const spot of world.spots.filter((s) => s.kind === 'owner-wait')) assert.equal(spot.room, reception.id)
  const hall = world.spots.find((s) => s.kind === 'entrance')!
  const wait = world.spots.find((s) => s.kind === 'owner-wait')!
  const path = findPath(world, hall, wait)!
  assert.ok(path.some((p) => at(p.x, p.y) === reception.id))
  const enter = path.find((p) => world.tiles[p.y * world.width + p.x] === 'door')!
  const receptionDoor = world.doors.find((d) => d.x === enter.x && d.y === enter.y)!
  assert.ok(receptionDoor && !receptionDoor.owner, 'enters by the reception door, not the owner one')
  // The mini office: a door into the reception.
  const mini = world.desks.find((d) => d.room === 'mini')!
  const toMini = findPath(world, wait, mini.seat)!
  assert.ok(toMini.every((p) => [reception.id, 'mini', null].includes(at(p.x, p.y)) || world.tiles[p.y * world.width + p.x] === 'door'))
})

test('a tiny map builds walls, floor, doors and seats', () => {
  const { world, errors } = parseMap(tinyMap())
  assert.deepEqual(errors, [])
  const w = world!
  assert.equal(w.width, 7)
  assert.equal(w.height, 11)
  const tile = (x: number, y: number) => w.tiles[y * w.width + x]
  assert.equal(tile(0, 0), 'wall')
  assert.equal(tile(1, 1), 'floor')
  assert.equal(tile(2, 4), 'door')
  assert.equal(tile(3, 6), 'door')
  assert.equal(w.desks.length, 2)
  assert.deepEqual(w.desks[0].seat, { x: 1, y: 8 })
  assert.equal(w.desks[0].id, 'work.a')
  assert.equal(w.spots.filter((spot) => spot.kind === 'sofa').length, 2)
  assert.ok(!walkable(w, 1, 7), 'a desk blocks')
  assert.ok(!walkable(w, 1, 9), 'a sofa is no passage')
  assert.ok(walkable(w, 1, 9, true), 'but one can sit on it')
})

test('mistakes come back as readable lines naming the place', () => {
  const unknown = parseMap(tinyMap((m) => m.stamps.work.furniture.push({ type: 'sofaa', x: 1, y: 1 })))
  assert.equal(unknown.world, null)
  assert.match(unknown.errors.join('\n'), /stamps\.work\.furniture\[3\]: неизвестный тип мебели "sofaa"/)

  const outside = parseMap(tinyMap((m) => m.stamps.work.furniture.push({ type: 'plant', x: 9, y: 1 })))
  assert.match(outside.errors.join('\n'), /выходит за пол комнаты «work»/)

  const overlap = parseMap(tinyMap((m) => m.stamps.work.furniture.push({ type: 'plant', x: 2, y: 1 })))
  assert.match(overlap.errors.join('\n'), /стоит на другой мебели/)

  const door = parseMap(tinyMap((m) => m.plan.doors.push({ x: 0, y: 2 })))
  assert.match(door.errors.join('\n'), /plan\.doors\[2\]: дверь \(0,2\) никуда не ведёт/)

  const stamp = parseMap(tinyMap((m) => (m.plan.rooms[1].stamp = 'nope')))
  assert.match(stamp.errors.join('\n'), /plan\.rooms\[1\]: нет штампа «nope»/)

  const clash = parseMap(tinyMap((m) => m.plan.rooms.push({ id: 'x', stamp: 'work', x: 2, y: 7 })))
  assert.match(clash.errors.join('\n'), /пересекается|заходит внутрь/)

  const dup = parseMap(tinyMap((m) => m.stamps.work.furniture.push({ type: 'desk', id: 'a', x: 4, y: 3, facing: 'down' })))
  assert.match(dup.errors.join('\n'), /стол «work\.a» уже есть/)

  const noOwner = parseMap(tinyMap((m) => (m.plan.doors[0].owner = false)))
  assert.match(noOwner.errors.join('\n'), /нет двери кабинета овнера/)

  const walled = parseMap(tinyMap((m) => m.plan.doors.pop()))
  assert.match(walled.errors.join('\n'), /стол «work\.a»: до стула не дойти/)

  const size = parseMap(tinyMap((m) => m.stamps.work.furniture.push({ type: 'plant', x: 5, y: 3, w: 2 })))
  assert.match(size.errors.join('\n'), /размер фиксированный/)

  assert.deepEqual(parseMap('nope').errors, ['map.json: ожидается JSON-объект'])
})

test('a new room is a JSON edit only', () => {
  const { world, errors } = parseMap(
    tinyMap((m) => {
      m.stamps.dept = { kind: 'team', label: 'Отдел продаж', w: 5, h: 5, floor: 'carpet-blue', furniture: [{ type: 'desk', id: 'd1', x: 1, y: 1 }] }
      m.plan.rooms.push({ id: 'sales', stamp: 'dept', x: 6, y: 0 })
      m.plan.corridors[0].w = 11
      m.plan.doors.push({ x: 8, y: 4 })
    })
  )
  assert.deepEqual(errors, [])
  assert.ok(world!.desks.some((desk) => desk.id === 'sales.d1' && desk.roomKind === 'team'))
  assert.equal(world!.rooms.find((room) => room.id === 'sales')?.label, 'Отдел продаж')
})

test('BFS finds the shortest walk through doors and around furniture', () => {
  const { world } = parseMap(tinyMap())
  const w = world!
  const path = findPath(w, { x: 1, y: 5 }, { x: 1, y: 8 })!
  assert.ok(path, 'a way to the chair')
  assert.deepEqual(path[path.length - 1], { x: 1, y: 8 })
  assert.ok(path.some((p) => p.x === 3 && p.y === 6), 'through the door')
  for (const p of path) assert.ok(walkable(w, p.x, p.y, p.x === 1 && p.y === 8))
  for (let i = 1; i < path.length; i += 1) {
    assert.equal(Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y), 1, 'one tile per step')
  }
  // (2,5) (3,5) door (3,6) (3,7) (3,8) (2,8) (1,8): round desk a, never through it.
  assert.equal(path.length, 7)
  assert.deepEqual(findPath(w, { x: 1, y: 5 }, { x: 1, y: 5 }), [])
  assert.equal(findPath(w, { x: 1, y: 5 }, { x: 0, y: 0 }), null, 'not into a wall')
  const sofa = findPath(w, { x: 5, y: 9 }, { x: 1, y: 9 })!
  assert.deepEqual(sofa[sofa.length - 1], { x: 1, y: 9 }, 'onto a sofa seat as the goal')
  assert.ok(!sofa.slice(0, -1).some((p) => p.y === 9 && p.x <= 2), 'never across the sofa')
})

test('BFS in the real office reaches every desk from the owner door', () => {
  const world = realMap()
  const door = world.spots.find((spot) => spot.kind === 'owner-wait')!
  for (const desk of world.desks) assert.ok(findPath(world, door, desk.seat), desk.id)
})
