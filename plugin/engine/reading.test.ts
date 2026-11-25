import { assert, test } from 'orca/testing'
import { Cast } from './actors'
import { envelopeAt, Effects } from './fx'
import { realMap } from './fixtures'
import { Life, seededRandom } from './life'
import { planTargets } from './locations'
import { mailPoint, ownerPoint, Reading, READ_MS } from './reading'
import { assignBotSeats } from './seating'

test('a letter flies to where the recipient is now and follows it while it walks; it leaves from the sender, not its desk', () => {
  const fx = new Effects()
  const seat = { x: 4, y: 4 }
  // The sender stands in the kitchen, far from its desk.
  const sender = mailPoint({ x: 40, y: 20 }, seat, null, 'bot')
  assert.deepEqual(sender, { x: 40 * 16 + 8, y: 20 * 16 }, 'from the bot itself')
  assert.deepEqual(mailPoint(null, seat, null, 'bot'), { x: 4 * 16 + 16, y: 4 * 16 }, 'its desk only when it is not on the map')
  assert.deepEqual(mailPoint(null, null, { x: 54, y: 15 }, 'outside'), { x: 54 * 16 + 8, y: 15 * 16 + 8 })
  let walker = { x: 10, y: 15 }
  fx.addMail({ id: 'm', type: 'question', at: 0 }, 'bot:a', 'bot:b', sender, mailPoint(walker, null, null, 'bot'), 0, true)
  const env = fx.envelopes[0]
  // Later the sender has walked off: the envelope still started where it was.
  const start = envelopeAt(env, mailPoint({ x: 1, y: 1 }, null, null, 'bot'), mailPoint(walker, null, null, 'bot'), 0)!
  assert.deepEqual(start, sender)
  // The recipient walks; the end of the flight moves with it.
  const late = env.start + env.duration * 0.99
  walker = { x: 30, y: 15 }
  const near = envelopeAt(env, sender, mailPoint(walker, null, null, 'bot'), late)!
  assert.ok(Math.abs(near.x - (30 * 16 + 8)) < 16, 'it reaches the bot where it walked to')
  assert.deepEqual(fx.landed(env.start + env.duration).map((e) => e.to), ['bot:b'])
})

test('the recipient stops to read, then goes on with its routine or its work', () => {
  const world = realMap()
  const { seats } = assignBotSeats(['a', 'b'], world.desks, {}, {}, () => 0)
  const base = planTargets(world, [
    { key: 'a', state: 'done', desk: seats.get('a') ?? null },
    { key: 'b', state: 'working', desk: seats.get('b') ?? null }
  ])
  const cast = new Cast()
  cast.sync(world, base)
  const life = new Life(world, seededRandom(4))
  const reading = new Reading()
  // `a` is on its way somewhere; the letter lands mid-walk.
  const away = { ...base.get('a')!, x: base.get('a')!.x - 6, y: base.get('a')!.y - 6 }
  cast.sync(world, new Map([...base, ['a', away]]))
  cast.tick()
  cast.tick()
  const views = () => new Map(cast.views().map((v) => [v.key, v]))
  reading.start('a', 1000)
  reading.start('b', 1000)
  life.interrupt('a', 1000, READ_MS)
  const during = reading.apply(new Map([...base, ['a', away]]), views(), 1500)
  const a = during.get('a')!
  const va = views().get('a')!
  assert.deepEqual([a.pose, a.reading, a.x, a.y], ['read', true, Math.round(va.x), Math.round(va.y)], 'stops where it is and reads')
  const b = during.get('b')!
  assert.deepEqual([b.pose, b.reading, b.place], ['type', true, 'desk'], 'at the desk it keeps sitting, the letter over its head')
  assert.ok(reading.isReading('a', 1000 + READ_MS - 1) && !reading.isReading('a', 1000 + READ_MS))
  assert.equal(reading.nextAt(1500), 1000 + READ_MS)
  assert.equal(reading.nextAt(1000 + READ_MS + 50), 1000 + READ_MS, 'still due after the time is up, until re-planned')
  const after = reading.apply(new Map([...base, ['a', away]]), views(), 1000 + READ_MS)
  assert.equal(reading.nextAt(), Infinity, 'nobody reads any more')
  assert.deepEqual([after.get('a')!.x, after.get('a')!.y, after.get('a')!.reading], [away.x, away.y, undefined], 'then on to where it was going')
  assert.equal(after.get('b')!.reading, undefined)
})

test('the owner\'s letters start at the CEO\'s desk (its chair stays empty), else at the owner\'s door', () => {
  const world: ReturnType<typeof realMap> | null = realMap()
  const desk = world!.furniture.find((f) => f.type === 'ceo-desk')!
  const at = ownerPoint(world!)!
  assert.deepEqual(at, { x: (desk.x + 1.5) * 16, y: (desk.y + 1) * 16 })
  const room = world!.rooms.find((r) => r.kind === 'owner')!
  assert.ok(at.x > room.x * 16 && at.x < (room.x + room.w) * 16 && at.y > room.y * 16 && at.y < (room.y + room.h) * 16, 'inside the CEO\'s office')
  const noDesk = { ...world!, furniture: world!.furniture.filter((f) => f.type !== 'ceo-desk') }
  const door = world!.doors.find((d) => d.owner)!
  assert.deepEqual(ownerPoint(noDesk), { x: door.x * 16 + 8, y: door.y * 16 + 8 })
})
