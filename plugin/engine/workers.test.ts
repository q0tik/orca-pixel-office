import { assert, test } from 'orca/testing'
import { addressKind, distanceToSegment, hitPoint, hitSegment, LEGEND_TYPES, mailTooltip, typeName } from '../editor/mailview'
import { Cast } from './actors'
import { realMap } from './fixtures'
import { planTargets } from './locations'
import { assignWorkerDesks, parseWorkerDesks, presentWorkers, workerLabels, WORKER_LINGER_MS, WORKER_ROOM, workerKey, workerTarget, type WorkerInfo } from './workers'

const worker = (id: string, over: Partial<WorkerInfo> = {}): WorkerInfo => ({
  id,
  name: id,
  parentKey: 'cto',
  agent: 'claude',
  state: 'working',
  live: true,
  since: null,
  ...over
})

test('workers sit at desks of «Команды и отделы», the same desk after a reload', () => {
  const world = realMap()
  const desks = world.desks.filter((d) => d.room === WORKER_ROOM)
  assert.ok(desks.length >= 24)
  const first = assignWorkerDesks([worker('a'), worker('b'), worker('c')], desks, {})
  assert.equal(first.seats.size, 3)
  for (const desk of first.seats.values()) assert.equal(desk.room, WORKER_ROOM)
  // «Reload»: b left, a new one came; a and c keep their desks, the new one takes b's free desk.
  const stored = parseWorkerDesks(JSON.parse(JSON.stringify(first.stored)))
  const second = assignWorkerDesks([worker('c'), worker('new'), worker('a')], desks, stored)
  assert.equal(second.seats.get('a')!.id, first.seats.get('a')!.id)
  assert.equal(second.seats.get('c')!.id, first.seats.get('c')!.id)
  assert.equal(second.seats.get('new')!.id, first.seats.get('b')!.id)
  assert.deepEqual(Object.keys(second.stored).sort(), ['a', 'c', 'new'], 'gone workers are dropped from storage')
  assert.deepEqual(parseWorkerDesks('junk'), {})
  assert.deepEqual(parseWorkerDesks({ a: 'x', b: 1 }), { a: 'x' })
})

test('more workers than desks: the rest is «+N»', () => {
  const world = realMap()
  const desks = world.desks.filter((d) => d.room === WORKER_ROOM).slice(0, 2)
  const r = assignWorkerDesks([worker('a'), worker('b'), worker('c'), worker('d')], desks, {})
  assert.equal(r.seats.size, 2)
  assert.deepEqual(r.overflow, ['c', 'd'])
})

test('a finished worker stays pale for 10 minutes, then leaves; a released one leaves at once', () => {
  const seen = new Map<string, number>()
  const now = 1_000_000
  const list = [worker('live'), worker('done-old', { live: false, state: 'done', since: now - WORKER_LINGER_MS - 1 }), worker('done-new', { live: false, state: 'done', since: now - 60_000 }), worker('done-unknown', { live: false, state: 'done' })]
  assert.deepEqual(presentWorkers(list, now, seen).map((w) => w.id), ['live', 'done-new', 'done-unknown'])
  // Without a time from Orca, the clock starts when the office saw it finished.
  assert.deepEqual(presentWorkers(list, now + WORKER_LINGER_MS, seen).map((w) => w.id), ['live'])
  // Released: not in the list any more → gone, and forgotten.
  assert.deepEqual(presentWorkers([worker('live')], now + 1, seen).map((w) => w.id), ['live'])
  assert.equal(seen.size, 0)
  const desk = realMap().desks.find((d) => d.room === WORKER_ROOM)!
  assert.equal(workerTarget(worker('x', { live: false, state: 'done' }), desk).still, true, 'sits still, no typing')
  assert.equal(workerTarget(worker('x', { state: 'blocked' }), desk).bubble, 'blocked')
})

test('no run on open: the first state is placed, a later change walks', () => {
  const world = realMap()
  const cast = new Cast()
  const desk = world.desks.find((d) => d.room === WORKER_ROOM)!
  const first = planTargets(world, [{ key: 'cto', state: 'done', desk: null, needsYou: 2 }])
  first.set(workerKey('w1'), workerTarget(worker('w1'), desk))
  cast.sync(world, first, { snap: true, spawn: () => ({ x: 54, y: 13 }) })
  assert.equal(cast.walking(), 0, 'nobody walks when the tab opens')
  assert.equal(cast.actors.get('cto')!.target.place, 'owner-wait')
  // Then a real change: the bot starts working, a new worker arrives.
  const second = planTargets(world, [{ key: 'cto', state: 'working', desk: world.desks[0] }], first)
  second.set(workerKey('w1'), first.get(workerKey('w1'))!)
  second.set(workerKey('w2'), workerTarget(worker('w2'), world.desks.filter((d) => d.room === WORKER_ROOM)[1]))
  cast.sync(world, second, { spawn: (key) => (key.startsWith('w:') ? { x: 54, y: 13 } : null) })
  assert.ok(cast.actors.get('cto')!.path.length > 0, 'the bot walks to its desk')
  assert.ok(cast.actors.get(workerKey('w2'))!.path.length > 0, 'the new worker walks in from the entrance')
  assert.equal(cast.actors.get(workerKey('w1'))!.path.length, 0)
})

test('tooltips and the legend speak Russian and say why an end went to the entrance', () => {
  assert.deepEqual(['handoff', 'question', 'status', 'worker_done'].map(typeName), ['передача', 'вопрос', 'статус', 'готово'])
  assert.equal(typeName('weird'), 'weird')
  assert.ok(LEGEND_TYPES.length >= 4)
  assert.deepEqual(mailTooltip({ from: 'Ада', to: 'Грейс', type: 'question', subject: 'Выдуманная тема', unknown: [] }), ['Ада → Грейс · вопрос', 'Выдуманная тема'])
  const outside = mailTooltip({ from: 'вход (адрес не опознан)', to: 'Ада', type: 'status', subject: '', unknown: ['run:run_x'] })
  assert.match(outside.join('\n'), /адрес не опознан: Run/)
  assert.equal(addressKind('dispatch:ctx_1'), 'сотрудник не из этого офиса')
  assert.equal(addressKind('orca:items'), 'сама Orca')
  assert.equal(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 3)
  assert.equal(hitSegment([{ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }], { x: 5, y: 3 }, 4), 0)
  assert.equal(hitSegment([{ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }], { x: 5, y: 9 }, 4), -1)
  assert.equal(hitPoint([{ x: 0, y: 0 }, { x: 20, y: 20 }], { x: 19, y: 18 }, 8), 1)
})

test('desk labels stay different: the shared prefix goes, long names are cut from the start', () => {
  const two = workerLabels(['pixel-office-poc', 'pixel-office-v3'])
  assert.equal(two.get('pixel-office-poc'), 'poc')
  assert.equal(two.get('pixel-office-v3'), 'v3')
  assert.notEqual(two.get('pixel-office-poc'), two.get('pixel-office-v3'))
  assert.equal(workerLabels(['pixel-office-v3']).get('pixel-office-v3'), '…office-v3', 'alone: cut from the start')
  const long = workerLabels(['team-alpha-very-long-branch-one', 'team-alpha-very-long-branch-two'])
  assert.equal(long.get('team-alpha-very-long-branch-one'), 'one')
  assert.equal(workerLabels(['x-a-very-long-unique-name', 'x-b']).get('x-a-very-long-unique-name'), '…ique-name', 'still long after the prefix: cut from the start')
  assert.notEqual(long.get('team-alpha-very-long-branch-one'), long.get('team-alpha-very-long-branch-two'))
  assert.equal(workerLabels(['abc', 'abd']).get('abc'), 'abc', 'no separator: nothing dropped')
})
