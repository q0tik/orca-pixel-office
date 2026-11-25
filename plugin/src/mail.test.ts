// Fixtures are shaped like the real `orca orchestration inbox --json` and `worker-list --json`
// answers (checked 2026-11-24) with made-up text only.
import { assert, test } from 'orca/testing'
import type { CliRequest, RunResult } from './cli'
import { parseWorktreePs } from './extras'
import { JOURNAL_MAX, learnRuns, MailSource, parseInbox, parseWorkerList, resolve, SUBJECT_MAX, type Directory, type MailClock } from './mail'

const CTO_CHAT = 'orca_session_id:cto-chat'
const GRACE_CHAT = 'orca_session_id:grace-chat'
const WORKER_TERM = 'term_worker-1'
const SECRET = 'СЕКРЕТНЫЙ выдуманный текст письма'

const message = (id: string, from: string, to: string, type: string, subject = 'Выдуманная тема') => ({
  id,
  from,
  to,
  type,
  subject,
  handled: true,
  priority: 'normal',
  body: SECRET,
  payload: { secret: SECRET }
})

const INBOX = {
  messages: [
    message('msg_5', CTO_CHAT, GRACE_CHAT, 'status', 'Очень длинная выдуманная тема '.repeat(10)),
    message('msg_4', WORKER_TERM, 'run:run_1', 'worker_done'),
    message('msg_3', CTO_CHAT, 'dispatch:ctx_1', 'status'),
    message('msg_2', 'run:run_1', 'dispatch:ctx_1', 'question'),
    message('msg_1', 'orca:items', CTO_CHAT, 'heartbeat')
  ]
}

const PS = {
  worktrees: [
    { worktreeId: 'folder:cto', path: '/h/.orca/bots/cto', bot: '[CTO] Кто-то', botHome: true, agents: [{ address: CTO_CHAT, agentType: 'claude', state: 'done' }] },
    { worktreeId: 'folder:grace', path: '/h/.orca/bots/bot-2', bot: '[assistant] Некто', botHome: true, agents: [{ address: GRACE_CHAT, agentType: 'claude', state: 'done' }] },
    { worktreeId: 'repo::/w/one', path: '/w/one', bot: '[CTO] Кто-то', parent: { selector: 'folder:cto' }, agents: [{ address: WORKER_TERM, agentType: 'claude', state: 'working' }] }
  ]
}

const WORKERS = {
  scope: { source: 'all' },
  workers: [
    { dispatchId: 'ctx_1', terminal: WORKER_TERM, workspace: 'repo::/w/one', state: 'ready', outcome: 'in_progress', liveness: 'alive', agent: 'claude', taskId: 'task_x', attention: 'none', host: 'local' },
    { dispatchId: 'ctx_2', terminal: null, workspace: 'repo::/elsewhere', state: 'succeeded', outcome: null, liveness: null }
  ]
}

const BOT_KEYS = new Map([
  ['[CTO] Кто-то', 'cto'],
  ['[assistant] Некто', 'bot-2']
])

const dir = (): Directory => ({ botKeys: BOT_KEYS, ps: parseWorktreePs(PS), dispatches: parseWorkerList(WORKERS) })

test('inbox: metadata only — the body and the payload are dropped, heartbeats skipped, subjects clipped', () => {
  const rows = parseInbox(INBOX)
  assert.deepEqual(rows.map((r) => r.id), ['msg_5', 'msg_4', 'msg_3', 'msg_2'])
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ['from', 'id', 'subject', 'to', 'type'])
  assert.ok(!JSON.stringify(rows).includes('СЕКРЕТНЫЙ'), 'no body, no payload anywhere')
  assert.ok(rows[0].subject.length <= SUBJECT_MAX)
  assert.deepEqual(parseInbox(null), [])
  assert.deepEqual(parseInbox({ messages: [{ id: 'x' }] }), [])
})

test('worker-list: only the allowed fields', () => {
  const d = parseWorkerList(WORKERS).get('ctx_1')!
  assert.deepEqual(Object.keys(d).sort(), ['dispatchId', 'liveness', 'outcome', 'state', 'terminal', 'workspace'])
  assert.equal(d.terminal, WORKER_TERM)
})

test('addresses: bot chats to desks, workers and dispatches to interns, Runs to their coordinator', () => {
  const d = dir()
  const rows = parseInbox(INBOX)
  const runs = learnRuns(rows, d.dispatches)
  assert.equal(runs.get('run_1'), CTO_CHAT, 'learned from «CTO → dispatch:ctx_1» and «worker → run:run_1»')
  assert.deepEqual(resolve(CTO_CHAT, d, runs), { kind: 'bot', key: 'cto' })
  assert.deepEqual(resolve(GRACE_CHAT, d, runs), { kind: 'bot', key: 'bot-2' })
  assert.deepEqual(resolve(WORKER_TERM, d, runs), { kind: 'intern', key: 'cto', workerId: 'repo::/w/one' })
  assert.deepEqual(resolve('dispatch:ctx_1', d, runs), { kind: 'intern', key: 'cto', workerId: 'repo::/w/one' })
  assert.deepEqual(resolve('ctx_1', d, runs), { kind: 'intern', key: 'cto', workerId: 'repo::/w/one' })
  assert.deepEqual(resolve('run:run_1', d, runs), { kind: 'bot', key: 'cto' })
  assert.deepEqual(resolve('run:run_unknown', d, runs), { kind: 'outside', address: 'run:run_unknown' })
  assert.deepEqual(resolve('dispatch:ctx_2', d, runs), { kind: 'outside', address: 'dispatch:ctx_2' })
  assert.deepEqual(resolve('orca:items', d, runs), { kind: 'outside', address: 'orca:items' })
})

function fakeClock() {
  let now = 5_000_000
  const timers: { at: number; fn: () => void; id: number }[] = []
  let next = 1
  const clock: MailClock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      timers.push({ at: now + ms, fn, id: next })
      return next++
    },
    clearTimeout: (id) => {
      const i = timers.findIndex((t) => t.id === id)
      if (i >= 0) timers.splice(i, 1)
    }
  }
  return {
    clock,
    advance: async (ms: number) => {
      now += ms
      for (const t of timers.filter((t) => t.at <= now)) {
        timers.splice(timers.indexOf(t), 1)
        t.fn()
      }
      await new Promise((r) => setTimeout(r, 0))
    },
    get now() {
      return now
    }
  }
}

function source(inbox: () => unknown, fail = false) {
  const calls: CliRequest[] = []
  const fake = fakeClock()
  const posted: unknown[] = []
  const run = async (request: CliRequest): Promise<RunResult> => {
    calls.push(request)
    if (fail) return { ok: false, error: 'timeout' }
    if (request.kind === 'inbox') return { ok: true, json: inbox() }
    if (request.kind === 'worktree-ps') return { ok: true, json: PS }
    if (request.kind === 'worker-list') return { ok: true, json: WORKERS }
    return { ok: false, error: 'not expected' }
  }
  const mail = new MailSource(run, () => BOT_KEYS, parseWorktreePs, fake.clock, (m) => posted.push(m))
  return { mail, calls, fake, posted }
}

test('mail before the tab opened has no time («до открытия»); new ids get the time they were seen; dupes once', async () => {
  let inbox: { messages: unknown[] } = { messages: INBOX.messages.slice(1) }
  const { mail, fake } = source(() => inbox)
  const first = await mail.ask()
  assert.deepEqual(first.entries.map((e) => [e.id, e.at]), [
    ['msg_4', null],
    ['msg_3', null],
    ['msg_2', null]
  ])
  inbox = INBOX
  await fake.advance(16_000)
  const second = await mail.ask()
  assert.deepEqual(second.entries.map((e) => e.id), ['msg_5', 'msg_4', 'msg_3', 'msg_2'], 'newest first, each id once')
  assert.equal(second.entries[0].at, fake.now)
  assert.deepEqual(second.entries[0].from, { kind: 'bot', key: 'cto' })
  assert.deepEqual(second.entries[0].to, { kind: 'bot', key: 'bot-2' })
  assert.ok(!JSON.stringify(second).includes('СЕКРЕТНЫЙ'))
})

test('polling: at most every 15 s, only while a tab asks; events debounce', async () => {
  const { mail, calls, fake, posted } = source(() => INBOX)
  const inboxReads = () => calls.filter((c) => c.kind === 'inbox').length
  mail.poke()
  await fake.advance(5_000)
  assert.equal(inboxReads(), 0, 'no tab: no reads')
  await mail.ask()
  await mail.ask()
  assert.equal(inboxReads(), 1)
  await fake.advance(10_000)
  await mail.ask()
  assert.equal(inboxReads(), 1, 'within 15 s: the cache')
  await fake.advance(6_000)
  mail.poke()
  mail.poke()
  await fake.advance(2_500)
  assert.equal(inboxReads(), 2, 'a burst of events: one read')
  assert.equal(posted.length, 1)
  await fake.advance(120_000)
  mail.poke()
  await fake.advance(5_000)
  assert.equal(inboxReads(), 2, 'tab closed: events read nothing')
})

test('CLI down: an error, an empty journal, nothing thrown', async () => {
  const { mail } = source(() => INBOX, true)
  const m = await mail.ask()
  assert.equal(m.error, 'timeout')
  assert.deepEqual(m.entries, [])
})

test('the journal keeps the newest 50', async () => {
  const many = { messages: Array.from({ length: 80 }, (_, i) => message(`msg_${100 - i}`, CTO_CHAT, GRACE_CHAT, 'status')) }
  const { mail } = source(() => many)
  const m = await mail.ask()
  assert.equal(m.entries.length, JOURNAL_MAX)
  assert.equal(m.entries[0].id, 'msg_100')
})
