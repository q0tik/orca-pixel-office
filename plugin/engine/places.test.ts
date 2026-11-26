import { readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import { findPath } from './path'
import { parseMap } from './world'
import { assignBotSeats, isBotPlace, placesLabel } from './seating'
import type { DeskSeat } from './world'

const desk = (id: string, roomKind: DeskSeat['roomKind']): DeskSeat => ({ id, room: id.split('.')[0], roomKind, role: null, facing: 'up', x: 0, y: 0, seat: { x: 0, y: 1 } })

test('a specialists’ room holds bots’ places: offices first, then its places, then the team room', () => {
  const desks = [desk('office.desk', 'clevel'), desk('open.s1', 'specialists'), desk('open.s2', 'specialists'), desk('teams.t1', 'team')]
  assert.ok(isBotPlace(desks[1]) && !isBotPlace(desks[3]), 'a specialist’s place is a bot’s place, a team desk is not')
  const r = assignBotSeats(['a', 'b', 'c', 'd'], desks, {}, {}, () => 0)
  assert.deepEqual([...r.seats].map(([k, d]) => [k, d?.id ?? null]), [['a', 'office.desk'], ['b', 'open.s1'], ['c', 'open.s2'], ['d', 'teams.t1']])
  // Remembered like an office; a pin to a specialist’s place wins.
  assert.deepEqual(r.memory, { a: 'office.desk', b: 'open.s1', c: 'open.s2' })
  const pinned = assignBotSeats(['a', 'b'], desks, { a: 'open.s2' }, {}, () => 0)
  assert.equal(pinned.seats.get('a')?.id, 'open.s2')
  assert.equal(pinned.seats.get('b')?.id, 'office.desk', 'the office is still free: offices first')
})

test('a room of bots’ places is labelled with who sits there, or how many places are free', () => {
  const office = { label: 'Серверная', kind: 'clevel' }
  const open = { label: 'Open-space', kind: 'specialists' }
  assert.equal(placesLabel(office, [{ name: 'Ада', pinned: true }], true), 'Серверная · Ада 📌')
  assert.equal(placesLabel(office, [{ name: null, pinned: false }], true), 'Серверная · свободен')
  assert.equal(placesLabel(open, [{ name: null, pinned: false }, { name: null, pinned: false }, { name: null, pinned: false }], true), 'Open-space · свободно мест: 3')
  assert.equal(placesLabel(open, [{ name: 'Юрист', pinned: false }, { name: null, pinned: false }], true), 'Open-space · Юрист')
  assert.equal(placesLabel(open, [{ name: null, pinned: false }], false), null, 'from afar: names only')
})

test('a place for a role: a [QA] bot remembered elsewhere sits in the QA room; a pin beats it; others leave it', () => {
  const qa = { ...desk('qa.desk', 'clevel'), role: 'QA' }
  const desks = [desk('office-1.desk', 'clevel'), qa, desk('office-3.desk', 'clevel'), desk('open.s1', 'specialists')]
  // Remembered in «Светлый кабинет» (office-3), but the map keeps the anteroom for QA.
  const r = assignBotSeats(['cto', 'qa'], desks, { cto: 'office-1.desk' }, { qa: 'office-3.desk' }, () => 0, { cto: 'CTO', qa: 'QA' })
  assert.equal(r.seats.get('qa')?.id, 'qa.desk')
  assert.equal(r.memory.qa, 'qa.desk', 'and remembers it')
  // The role compares without case.
  assert.equal(assignBotSeats(['qa'], desks, {}, {}, () => 0, { qa: 'qa' }).seats.get('qa')?.id, 'qa.desk')
  // The owner's pin beats the role.
  const pinned = assignBotSeats(['qa'], desks, { qa: 'office-3.desk' }, {}, () => 0, { qa: 'QA' })
  assert.equal(pinned.seats.get('qa')?.id, 'office-3.desk')
  // A bot of another role (or none) does not take the QA place, by chance or by memory…
  for (const seed of [0, 0.3, 0.6, 0.99]) {
    const other = assignBotSeats(['lawyer'], desks, { x: 'office-1.desk' }, { lawyer: 'qa.desk' }, () => seed, { lawyer: 'Юрист' })
    assert.notEqual(other.seats.get('lawyer')?.id, 'qa.desk', `seed ${seed}`)
  }
  // …but the owner may pin anyone there.
  assert.equal(assignBotSeats(['lawyer'], desks, { lawyer: 'qa.desk' }, {}, () => 0).seats.get('lawyer')?.id, 'qa.desk')
})

test('the office map: the anteroom is for QA, and the CTO’s chair is reached only through it', () => {
  const raw = JSON.parse(readFileSync(new URL('../office/map.json', import.meta.url).pathname, 'utf8'))
  const { world, errors } = parseMap(raw)
  assert.deepEqual(errors, [])
  if (!world) return
  assert.deepEqual(world.desks.filter((d) => d.role === 'QA').map((d) => d.id), ['qa.desk'], 'the anteroom’s desk carries its room’s role')
  const cto = world.desks.find((d) => d.id === 'office-1.desk')!
  const hall = world.doors.find((d) => d.room === 'qa')!
  const path = findPath(world, { x: hall.x, y: hall.y + 2 }, cto.seat)!
  const rooms = [...new Set(path.map((p) => world.roomAt[p.y * world.width + p.x]).filter(Boolean))]
  assert.deepEqual(rooms.filter((r) => r === 'qa' || r === 'office-1'), ['qa', 'office-1'], 'hall → anteroom → CTO')
  // Without the door in the partition the map itself says the CTO's chair cannot be reached.
  const inner = world.doors.find((d) => d.room === 'office-1')!
  const cut = JSON.parse(JSON.stringify(raw))
  cut.plan.doors = cut.plan.doors.filter((d: { x: number; y: number }) => !(d.x === inner.x && d.y === inner.y))
  assert.ok(parseMap(cut).errors.some((e) => e.includes('office-1.desk')))
})
