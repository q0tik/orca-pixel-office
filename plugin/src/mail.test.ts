// Fixtures are shaped like the real `orca orchestration inbox --json` and `worker-list --json`
// answers (checked 2026-11-24) with made-up text only.
import { assert, test } from 'orca/testing'
import type { CliRequest, RunResult } from './cli'
import { parseWorktreePs } from './extras'
import { JOURNAL_MAX, learnRuns, MailSource, parseChatIds, parseInbox, parseTaskIds, parseWorkerList, placeRow, resolve, SUBJECT_MAX, type Directory, type MailClock } from './mail'

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

const dir = (): Directory => ({ botKeys: BOT_KEYS, ps: parseWorktreePs(PS), dispatches: parseWorkerList(WORKERS), chats: new Map(), runTasks: new Map() })

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
  assert.deepEqual(Object.keys(d).sort(), ['dispatchId', 'liveness', 'outcome', 'state', 'taskId', 'terminal', 'workspace'])
  assert.equal(d.terminal, WORKER_TERM)
})

test('addresses: bot chats to desks, workers and dispatches to interns, Runs to their coordinator', () => {
  const d = dir()
  const rows = parseInbox(INBOX)
  const runs = learnRuns(rows, d.dispatches)
  assert.equal(runs.get('run_1')?.coordinator, CTO_CHAT, 'learned from «CTO → dispatch:ctx_1» and «worker → run:run_1»')
  assert.deepEqual(resolve(CTO_CHAT, d, runs), { kind: 'bot', key: 'cto' })
  assert.deepEqual(resolve(GRACE_CHAT, d, runs), { kind: 'bot', key: 'bot-2' })
  assert.deepEqual(resolve(WORKER_TERM, d, runs), { kind: 'intern', key: 'cto', workerId: 'repo::/w/one' })
  assert.deepEqual(resolve('dispatch:ctx_1', d, runs), { kind: 'intern', key: 'cto', workerId: 'repo::/w/one' })
  assert.deepEqual(resolve('ctx_1', d, runs), { kind: 'intern', key: 'cto', workerId: 'repo::/w/one' })
  assert.deepEqual(resolve('run:run_1', d, runs), { kind: 'bot', key: 'cto' })
  assert.deepEqual(resolve('run:run_unknown', d, runs), { kind: 'outside', address: 'run:run_unknown' })
  assert.deepEqual(resolve('dispatch:ctx_2', d, runs), { kind: 'outside', address: 'dispatch:ctx_2' })
})

// ── One case per kind of address the real inbox had (2026-11-25), with made-up ids and names ──

/** Another bot's structured worker: its terminal is not in `worktree ps`, only in `worker-list`. */
const SELLER_HOME = 'orca_session_id:seller-home'
const SELLER_SIDE_CHAT = 'orca_session_id:seller-side-chat'
const STRUCT = 'structworker_0a1b2c'
const PS_MORE = {
  worktrees: [
    ...PS.worktrees,
    { worktreeId: 'folder:seller', path: '/h/.orca/bots/seller', bot: '[CSO] Третий', botHome: true, agents: [{ address: SELLER_HOME, agentType: 'claude', state: 'done' }] },
    { worktreeId: 'repo::/w/sales', path: '/w/sales', bot: '[CSO] Третий', parent: { selector: 'folder:seller' }, agents: [] },
    { worktreeId: 'repo::/w/two', path: '/w/two', bot: '[CTO] Кто-то', parent: { selector: 'folder:cto' }, agents: [] }
  ]
}
const WORKERS_MORE = {
  workers: [
    ...WORKERS.workers,
    { dispatchId: 'ctx_s1', taskId: 'task_s1', terminal: STRUCT, workspace: 'repo::/w/sales', state: 'succeeded', liveness: 'exited', terminalState: 'released' },
    { dispatchId: 'ctx_c1', taskId: 'task_c1', terminal: 'structworker_9f8e', workspace: 'repo::/w/two', state: 'succeeded', liveness: 'exited' },
    { dispatchId: 'ctx_s2', taskId: 'task_s2', terminal: 'term_old', workspace: 'repo::/w/sales', state: 'succeeded', liveness: 'unverifiable' }
  ]
}
const BOT_KEYS_MORE = new Map([...BOT_KEYS, ['[CSO] Третий', 'seller']])
const dirMore = (): Directory => ({
  botKeys: BOT_KEYS_MORE,
  ps: parseWorktreePs(PS_MORE),
  dispatches: parseWorkerList(WORKERS_MORE),
  chats: new Map([[SELLER_SIDE_CHAT.slice('orca_session_id:'.length), '[CSO] Третий']]),
  runTasks: new Map([['run_sales', ['task_s2']]])
})
const row = (from: string, to: string, subject = 'Выдуманная тема', type = 'status') => ({ id: 'm', from, to, type, subject })

test('(а) a bot chat that is not its Home (and not in `worktree ps` now) → that bot, via `orca bot chats`', () => {
  const d = dirMore()
  assert.deepEqual(resolve(SELLER_SIDE_CHAT, d), { kind: 'bot', key: 'seller' })
  assert.deepEqual(resolve(SELLER_HOME, d), { kind: 'bot', key: 'seller' })
  assert.deepEqual(parseChatIds({ chats: [{ id: 'a1', title: SECRET, lastSaid: SECRET, home: true }, { title: 'no id' }] }), ['a1'])
})

test('(б) Orca\'s item notices: the owner\'s doing → the CEO\'s office; the bot\'s other chat → a notice, no line', () => {
  const d = dirMore()
  const owner = placeRow(row('orca:items', CTO_CHAT, 'Your owner updated (item 7 "Выдуманная задача")'), d, new Map())
  assert.deepEqual(owner.from, { kind: 'owner', address: 'orca:items' })
  assert.deepEqual(owner.to, { kind: 'bot', key: 'cto' })
  for (const subject of ['Your other chat marked it Done (item 7 "x")', 'Your other chat commented (item 7 "x")', 'Something new from Orca']) {
    assert.deepEqual(placeRow(row('orca:items', CTO_CHAT, subject), d, new Map()).from, { kind: 'system', address: 'orca:items' }, subject)
  }
  assert.deepEqual(placeRow(row(CTO_CHAT, 'orca:anything'), d, new Map()).to, { kind: 'system', address: 'orca:anything' })
})

test('(в) a worker or structured worker of any bot → its employee in that bot\'s team, a Run → the bot whose workers took its tasks', () => {
  const d = dirMore()
  const rows = [row(STRUCT, 'run:run_mail', 'Готово', 'worker_done'), row(CTO_CHAT, 'run:run_sales', 'Re: вопрос')]
  const runs = learnRuns(rows, d.dispatches)
  assert.deepEqual(resolve(STRUCT, d, runs), { kind: 'intern', key: 'seller', workerId: 'repo::/w/sales' })
  assert.deepEqual(resolve('structworker_9f8e', d, runs), { kind: 'intern', key: 'cto', workerId: 'repo::/w/two' })
  assert.deepEqual(resolve('term_old', d, runs), { kind: 'intern', key: 'seller', workerId: 'repo::/w/sales' })
  assert.deepEqual(resolve('run:run_mail', d, runs), { kind: 'bot', key: 'seller' }, 'learned from the worker that reports to it')
  assert.deepEqual(resolve('run:run_sales', d, runs), { kind: 'bot', key: 'seller' }, 'from `task-list --run`: its task went to a seller worker')
  assert.deepEqual(parseTaskIds({ tasks: [{ id: 'task_s2', title: SECRET }], runId: 'run_sales' }), ['task_s2'])
})

test('(г, д) only what is really outside goes to the entrance: another computer, an unknown chat, an unknown Run', () => {
  const d = dirMore()
  for (const address of ['orca_session_id:nobody-knows', 'run:run_nobody', 'term_elsewhere', 'ssh:remote/term_x', 'dispatch:ctx_none']) {
    assert.deepEqual(resolve(address, d), { kind: 'outside', address }, address)
  }
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
    if (request.kind === 'bot-chats') return { ok: true, json: { chats: [] } }
    if (request.kind === 'run-tasks') return { ok: true, json: { tasks: [] } }
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

test('chat ids and Run tasks are read only for unknown addresses, and cached', async () => {
  const calls: CliRequest[] = []
  const fake = fakeClock()
  const inbox = { messages: [message('m3', 'orca:items', SELLER_SIDE_CHAT, 'status', 'Your owner updated (item 1 "x")'), message('m2', SELLER_SIDE_CHAT, 'run:run_sales', 'status'), message('m1', CTO_CHAT, GRACE_CHAT, 'status')] }
  const run = async (request: CliRequest): Promise<RunResult> => {
    calls.push(request)
    if (request.kind === 'inbox') return { ok: true, json: inbox }
    if (request.kind === 'worktree-ps') return { ok: true, json: PS_MORE }
    if (request.kind === 'worker-list') return { ok: true, json: WORKERS_MORE }
    if (request.kind === 'bot-chats') return { ok: true, json: { chats: request.bot === '[CSO] Третий' ? [{ id: 'seller-side-chat', lastSaid: SECRET }] : [] } }
    if (request.kind === 'run-tasks') return { ok: true, json: { tasks: request.run === 'run_sales' ? [{ id: 'task_s2', title: SECRET }] : [] } }
    return { ok: false, error: 'not expected' }
  }
  const mail = new MailSource(run, () => BOT_KEYS_MORE, parseWorktreePs, fake.clock, () => {})
  const m = await mail.ask()
  assert.deepEqual(m.entries.map((e) => [e.from, e.to]), [
    [{ kind: 'owner', address: 'orca:items' }, { kind: 'bot', key: 'seller' }],
    [{ kind: 'bot', key: 'seller' }, { kind: 'bot', key: 'seller' }],
    [{ kind: 'bot', key: 'cto' }, { kind: 'bot', key: 'bot-2' }]
  ])
  assert.ok(!JSON.stringify(m).includes('СЕКРЕТНЫЙ'), 'chat texts and task titles are never kept')
  const count = (kind: string) => calls.filter((c) => c.kind === kind).length
  assert.equal(count('bot-chats'), 3, 'one per bot of the office')
  assert.equal(count('run-tasks'), 1)
  for (let i = 0; i < 4; i += 1) {
    await fake.advance(16_000)
    await mail.ask()
  }
  assert.equal(count('bot-chats'), 3, 'cached: nothing is unknown any more')
  assert.equal(count('run-tasks'), 1)
})
