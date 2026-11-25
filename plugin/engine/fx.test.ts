import { assert, test } from 'orca/testing'
import { fitCamera } from './camera'
import { Effects, envelopeAt, INTERN_FADE_MS, LINE_FADE_MS, linkAlpha, linkKey, PALE_ALPHA } from './fx'
import { Follow } from './follow'

const A = { x: 100, y: 100 }
const B = { x: 400, y: 100 }

test('an envelope flies from sender to recipient in an arc, then lands', () => {
  const fx = new Effects()
  fx.addMail({ id: 'm1', type: 'handoff', at: 1_000 }, 'bot:a', 'bot:b', A, B, 1_000, true)
  assert.equal(fx.envelopes.length, 1)
  const env = fx.envelopes[0]
  const start = envelopeAt(env, A, B, 1_000)!
  assert.deepEqual(start, A)
  const mid = envelopeAt(env, A, B, 1_000 + env.duration / 2)!
  assert.equal(mid.x, 250)
  assert.ok(mid.y < 100, 'lifted in the middle')
  assert.equal(envelopeAt(env, A, B, 1_000 + env.duration), null, 'landed')
  assert.ok(fx.animating(1_000 + 10))
  assert.deepEqual(fx.landed(1_000 + 10), [], 'still flying')
  fx.prune(1_000 + env.duration + 1)
  assert.equal(fx.envelopes.length, 1, 'a landed envelope waits until its landing is taken (the recipient reads)')
  assert.deepEqual(fx.landed(1_000 + env.duration + 1).map((e) => e.id), ['m1'])
  assert.deepEqual(fx.landed(1_000 + env.duration + 2), [], 'once')
  fx.prune(1_000 + env.duration + 1)
  assert.equal(fx.envelopes.length, 0)
  assert.equal(fx.animating(1_000 + env.duration + 1), false)
  fx.addMail({ id: 'm1', type: 'handoff', at: 1_000 }, 'bot:a', 'bot:b', A, B, 5_000, true)
  assert.equal(fx.envelopes.length, 1, 'a repeat is one more flight only once it landed')
})

test('old mail lights the line without an envelope; mail «до открытия» and to oneself draw nothing', () => {
  const fx = new Effects()
  fx.addMail({ id: 'old', type: 'status', at: 1_000 }, 'bot:a', 'bot:b', A, B, 2_000, false)
  assert.equal(fx.envelopes.length, 0)
  assert.equal(fx.links.size, 1)
  fx.addMail({ id: 'x', type: 'status', at: null }, 'bot:a', 'bot:c', A, B, 2_000, false)
  fx.addMail({ id: 'y', type: 'status', at: 2_000 }, 'bot:a', 'bot:a', A, A, 2_000, true)
  assert.equal(fx.links.size, 1)
  assert.equal(fx.envelopes.length, 0)
})

test('the line fades over ten minutes and goes; a new message renews it; one line per pair', () => {
  const fx = new Effects()
  fx.addMail({ id: 'm1', type: 'status', at: 0 }, 'bot:a', 'bot:b', A, B, 0, true)
  fx.addMail({ id: 'm2', type: 'question', at: 1_000 }, 'bot:b', 'bot:a', B, A, 1_000, true)
  assert.equal(fx.links.size, 1, 'a→b and b→a share a line')
  const link = fx.links.get(linkKey('bot:a', 'bot:b'))!
  assert.equal(link.type, 'question')
  assert.equal(linkAlpha(link, 1_000), 1)
  assert.ok(Math.abs(linkAlpha(link, 1_000 + LINE_FADE_MS / 2) - 0.5) < 1e-9)
  assert.equal(linkAlpha(link, 1_000 + LINE_FADE_MS), 0)
  fx.prune(1_000 + LINE_FADE_MS)
  assert.equal(fx.links.size, 0)
  assert.equal(fx.animating(1_000 + 60_000), false, 'a fading line needs no 12 Hz timer')
})

test('interns: already there at first sight, pop in when a worker starts, pale when done, fade when gone', () => {
  const fx = new Effects()
  fx.syncInterns(new Map([['w1', { key: 'cto', color: '#0f0', live: true }]]), 0)
  assert.deepEqual(fx.internLook('w1', 0), { alpha: 1, dy: 0, key: 'cto', color: '#0f0', live: true }, 'no pop-in on first sight')
  assert.equal(fx.animating(0), false)
  // A worker starts.
  fx.syncInterns(new Map([
    ['w1', { key: 'cto', color: '#0f0', live: true }],
    ['w2', { key: 'cto', color: '#0f0', live: true }]
  ]), 1_000)
  const popping = fx.internLook('w2', 1_000 + INTERN_FADE_MS / 2)!
  assert.ok(popping.alpha > 0 && popping.alpha < 1 && popping.dy < 0)
  assert.ok(fx.animating(1_000 + 10))
  assert.deepEqual(fx.internLook('w2', 1_000 + INTERN_FADE_MS), { alpha: 1, dy: 0, key: 'cto', color: '#0f0', live: true })
  // Its worker finished: pale.
  fx.syncInterns(new Map([
    ['w1', { key: 'cto', color: '#0f0', live: true }],
    ['w2', { key: 'cto', color: '#888', live: false }]
  ]), 5_000)
  assert.equal(fx.internLook('w2', 5_000)!.alpha, PALE_ALPHA)
  // Released: fades out, then gone.
  fx.syncInterns(new Map([['w1', { key: 'cto', color: '#0f0', live: true }]]), 9_000)
  assert.ok(fx.internLook('w2', 9_000 + INTERN_FADE_MS / 2)!.alpha < PALE_ALPHA)
  assert.equal(fx.internLook('w2', 9_000 + INTERN_FADE_MS), null)
  assert.deepEqual(fx.internsOf('cto'), ['w1', 'w2'])
  fx.prune(9_000 + INTERN_FADE_MS)
  assert.deepEqual(fx.internsOf('cto'), ['w1'])
})

test('camera follow: off by default, glides to the latest event, any input takes over', () => {
  const view = { width: 800, height: 600 }
  const world = { width: 896, height: 576 }
  const follow = new Follow()
  let camera = { ...fitCamera(view, world), zoom: 4 }
  follow.event({ x: 700, y: 400 })
  assert.equal(follow.moving(), false, 'off: events are ignored')
  assert.equal(follow.step(camera, view, world), null)
  assert.equal(follow.toggle(), true)
  follow.event({ x: 700, y: 400 })
  assert.ok(follow.moving())
  const before = camera
  camera = follow.step(camera, view, world)!
  assert.ok(camera.x > before.x && camera.y > before.y, 'a step towards the event')
  assert.ok(camera.x < 700, 'smoothly, not a jump')
  for (let i = 0; i < 200 && follow.moving(); i += 1) camera = follow.step(camera, view, world) ?? camera
  assert.equal(follow.moving(), false, 'arrived')
  follow.event({ x: 100, y: 100 })
  assert.equal(follow.interrupt(), true, 'the owner touched the camera')
  assert.equal(follow.on, false)
  assert.equal(follow.step(camera, view, world), null)
  assert.equal(follow.interrupt(), false)
})

test('trainees (subagents) pop in by their worker and fade out when they finish', () => {
  const fx = new Effects()
  fx.syncInterns(new Map(), 0)
  fx.syncInterns(new Map([['w1#s1', { key: 'w:w1', color: '#000000', live: true }]]), 1000)
  assert.deepEqual(fx.internsOf('w:w1'), ['w1#s1'])
  assert.ok(fx.internLook('w1#s1', 1000)!.alpha < 1, 'pops in')
  fx.syncInterns(new Map(), 5000)
  assert.ok(fx.internLook('w1#s1', 5100)!.alpha < 1, 'fades out')
  fx.prune(9000)
  assert.equal(fx.internLook('w1#s1', 9000), null, 'gone')
})
