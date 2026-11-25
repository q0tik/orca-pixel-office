import { assert, test } from 'orca/testing'
import type { Desk } from '../src/bots'
import type { Extras } from '../src/extras'
import { FLAG_H, FLAG_W, INTERN_H, INTERN_W, drawFlag, drawIntern, lookFor, type Paint } from './art'
import { buildPanel, escapeHtml, NO_DATA, renderPanel } from './panel'
import { P } from './palette'
import { internSlots, MAX_INTERNS } from './render'

const NOW = 10_000_000

const desk = (over: Partial<Desk> = {}): Desk => ({
  id: 'folder:k',
  key: 'cto',
  hostId: null,
  agents: ['claude'],
  name: 'Ада',
  role: 'CTO',
  state: 'working',
  since: NOW - 12 * 60_000,
  sessions: 2,
  failed: false,
  ...over
})

const extras: Extras = {
  at: NOW - 60_000,
  source: '/bin/orca',
  error: null,
  bots: {
    cto: {
      name: '[CTO] Ада',
      botId: 'uuid',
      agent: 'claude',
      interns: [
        { id: 'w1', name: 'pixel-office-v3', agent: 'claude', state: 'working', live: true, since: null, subagents: [] },
        { id: 'w2', name: 'pixel-office-v2', agent: 'claude', state: 'done', live: false, since: null, subagents: [] }
      ],
      items: { counts: { in_progress: 1, needs_you: 2, done: 4 }, needsYou: 2, needsYouTitles: ['Выдуманный пункт'] }
    }
  }
}

test('the panel says who, what agent, which status and for how long', () => {
  const model = buildPanel(desk(), extras, { ok: true, title: 'Выдуманный чат', lastSaid: 'выдуманный ответ', at: NOW - 120_000, chats: 3 }, NOW)
  assert.equal(model.name, 'Ада')
  assert.equal(model.role, 'CTO')
  assert.equal(model.agent, 'claude')
  assert.deepEqual([model.status.label, model.status.since], ['работает', '12 мин'])
  assert.deepEqual(model.chat, { kind: 'ok', title: 'Выдуманный чат', lastSaid: 'выдуманный ответ', ago: '2 мин', chats: 3 })
  assert.equal(model.interns.kind, 'list')
  if (model.interns.kind === 'list') {
    assert.deepEqual(model.interns.list.map((i) => [i.name, i.agent, i.state, i.live]), [
      ['pixel-office-v3', 'claude', 'работает', true],
      ['pixel-office-v2', 'claude', 'закончил', false]
    ])
  }
  assert.equal(model.items.kind, 'ok')
  if (model.items.kind === 'ok') {
    assert.deepEqual(model.items.rows, [
      { label: 'Needs you', count: 2, highlight: true },
      { label: 'В работе', count: 1, highlight: false },
      { label: 'Готово', count: 4, highlight: false }
    ])
  }
  assert.equal(model.readAgo, '1 мин')
  assert.equal(buildPanel(desk(), extras, null, NOW, 'Технический директор').role, 'Технический директор', 'seating role wins')
})

test('missing data reads «нет данных», nothing is made up', () => {
  const model = buildPanel(desk({ agents: [], since: null, state: 'idle' }), null, null, NOW)
  assert.equal(model.agent, NO_DATA)
  assert.equal(model.status.since, null)
  assert.deepEqual(model.chat, { kind: 'none', text: NO_DATA })
  assert.deepEqual(model.interns, { kind: 'none', text: NO_DATA })
  assert.deepEqual(model.items, { kind: 'none', text: NO_DATA })
  assert.equal(model.readAgo, null)
  // CLI down: extras came back with nulls and an error.
  const down: Extras = { at: NOW, source: null, error: 'timeout', bots: { cto: { name: 'x', botId: null, agent: null, interns: null, items: null } } }
  const m2 = buildPanel(desk({ agents: [] }), down, { ok: false, reason: 'CLI не ответил' }, NOW)
  assert.equal(m2.agent, NO_DATA)
  assert.deepEqual(m2.interns, { kind: 'none', text: NO_DATA })
  assert.deepEqual(m2.items, { kind: 'none', text: NO_DATA })
  assert.deepEqual(m2.chat, { kind: 'none', text: 'CLI не ответил' })
  assert.equal(m2.readError, 'timeout')
  const html = renderPanel(m2)
  assert.ok(html.includes(NO_DATA))
  assert.ok(html.includes('Открыть бота в Orca'))
  assert.ok(html.includes('CLI: timeout'))
  assert.deepEqual(buildPanel(desk(), { ...extras, bots: { cto: { ...extras.bots.cto, interns: [] } } }, null, NOW).interns, { kind: 'none', text: 'сотрудников нет' })
  assert.deepEqual(buildPanel(desk(), null, 'loading', NOW).chat, { kind: 'loading' })
})

test('the panel escapes everything it shows', () => {
  const model = buildPanel(desk({ name: '<img src=x onerror=1>' }), extras, { ok: true, title: '<b>t</b>', lastSaid: '"><script>', at: null, chats: 1 }, NOW)
  const html = renderPanel(model)
  assert.ok(!html.includes('<img') && !html.includes('<script') && !html.includes('<b>t'))
  assert.equal(escapeHtml(`<a href="x">'`), '&lt;a href=&quot;x&quot;&gt;&#39;')
})

test('interns: up to three by the desk, the rest as «+N»', () => {
  const seat = { x: 15, y: 5 }
  assert.deepEqual(internSlots(seat, 0), { slots: [], more: 0 })
  const two = internSlots(seat, 2)
  assert.equal(two.slots.length, 2)
  assert.equal(two.more, 0)
  const many = internSlots(seat, 7)
  assert.equal(many.slots.length, MAX_INTERNS)
  assert.equal(many.more, 4)
  for (const slot of many.slots) {
    assert.equal(slot.y + INTERN_H, (seat.y + 2) * 16, 'standing on the row below the chair')
    assert.ok(slot.x >= seat.x * 16 && slot.x + INTERN_W <= seat.x * 16 + 40, 'next to the desk')
  }
  const xs = many.slots.map((s) => s.x)
  for (let i = 1; i < xs.length; i += 1) assert.ok(xs[i] - xs[i - 1] >= INTERN_W, 'not on top of each other')
})

test('intern and flag sprites fit their boxes', () => {
  const check = (w: number, h: number, draw: (p: Paint) => void) => {
    const outside: string[] = []
    const colors = new Set<string>()
    draw((x, y, pw, ph, c) => {
      colors.add(c)
      if (x < 0 || y < 0 || x + pw > w || y + ph > h) outside.push(`${x},${y},${pw},${ph}`)
    })
    assert.deepEqual(outside, [])
    return colors
  }
  const intern = check(INTERN_W, INTERN_H, (p) => drawIntern(p, lookFor('w1'), P.working))
  assert.ok(intern.has(P.working), 'laptop light shows the worker state')
  assert.ok(check(FLAG_W, FLAG_H, drawFlag).has(P.needsYou))
})
