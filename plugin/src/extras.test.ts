// Fixtures are shaped like the real CLI answers (checked 2026-11-24) with made-up text only.
import { assert, test } from 'orca/testing'
import type { CliRequest, RunResult } from './cli'
import {
  releasedWorkspaces,
  ExtrasSource,
  LAST_SAID_MAX,
  parseBotList,
  parseCurrentChat,
  parseInterns,
  parseItems,
  parseWorktreePs,
  readExtras,
  type Clock,
  type Extras
} from './extras'

const BOT = '[CTO] Тестовый'
const BOT_WS = 'folder:bot-1'
const REPO = 'repo-1'

const BOT_LIST = {
  bots: [
    { id: 'uuid-1', name: BOT, agent: 'claude', paused: false, linked: [], specialty: 'выдумка', chats: { count: 2, home: true } },
    { id: 'uuid-2', name: '[CSO] Другой', agent: 'codex', paused: false, linked: [], specialty: '', chats: { count: 1, home: true } }
  ],
  unreachable: [{ name: 'far-away' }]
}

const WORK = {
  botName: BOT,
  items: [],
  workspaces: [
    { id: `${REPO}::/w/alpha`, name: 'alpha', agent: 'agent working' },
    { id: `${REPO}::/w/beta`, name: 'beta', agent: 'agent idle' },
    { id: `${REPO}::/w/gamma`, name: 'gamma', agent: 'agent working' },
    { id: BOT_WS, name: BOT, agent: 'agent idle' }
  ]
}

const PS = {
  worktrees: [
    { worktreeId: BOT_WS, path: '/home/.orca/bots/test', bot: BOT, botHome: true, parent: null, agents: [{ agentType: 'claude', state: 'done' }] },
    { worktreeId: `${REPO}::/w/alpha`, path: '/w/alpha', displayName: 'alpha', bot: BOT, parent: { state: 'known', selector: BOT_WS }, agents: [{ agentType: 'codex', state: 'working', lastAssistantMessage: 'выдуманный текст' }] },
    { worktreeId: `${REPO}::/w/beta`, path: '/w/beta', bot: BOT, parent: { state: 'known', selector: BOT_WS }, agents: [{ agentType: 'claude', state: 'done' }] },
    { worktreeId: `${REPO}::/w/delta`, path: '/w/delta', bot: null, parent: { state: 'known', selector: BOT_WS }, agents: [{ agentType: 'gemini', state: 'blocked' }, { agentType: 'gemini', state: 'working' }] },
    { worktreeId: `${REPO}::/w/other`, path: '/w/other', bot: '[CSO] Другой', parent: null, agents: [{ agentType: 'claude', state: 'working' }] },
    { worktreeId: `${REPO}::/main`, path: '/main', bot: null, parent: null, agents: [] }
  ]
}

const ITEMS = {
  botId: 'uuid-1',
  botName: BOT,
  counts: { needs_you: 2, planned: 1, done: 4 },
  items: [
    { uid: 'a', status: 'needs_you', title: 'Выдуманный пункт про кофе', description: 'не должно попасть никуда' },
    { uid: 'b', status: 'needs_you', title: 'Ещё один выдуманный пункт' },
    { uid: 'c', status: 'planned', title: 'План' }
  ]
}

const LONG = 'Выдуманный ответ. '.repeat(40)
const CHATS = {
  bot: BOT,
  chats: [
    { id: 'c-home', title: 'Home', home: true, self: false, closed: false, lastActivityAt: 100, lastAsked: 'вопрос', lastSaid: 'старый ответ' },
    { id: 'c-new', title: 'Свежий выдуманный чат', home: false, self: false, closed: false, lastActivityAt: 300, lastAsked: 'вопрос', lastSaid: LONG },
    { id: 'c-closed', title: 'Закрытый', home: false, self: false, closed: true, lastActivityAt: 999, lastAsked: '', lastSaid: 'закрыт' }
  ]
}

test('bot list: names to ids and agents', () => {
  const bots = parseBotList(BOT_LIST)
  assert.deepEqual(bots.get(BOT), { id: 'uuid-1', agent: 'claude' })
  assert.equal(parseBotList({ nope: 1 }).size, 0)
  assert.equal(parseBotList(null).size, 0)
})

test('workers: work list joined with worktree ps, plus ps rows that name the bot', () => {
  const ps = parseWorktreePs(PS)
  assert.equal(ps.get(`${REPO}::/w/delta`)?.state, 'blocked', 'the most urgent agent of a workspace')
  const interns = parseInterns(WORK, ps, BOT, BOT_WS)
  const byName = Object.fromEntries(interns.map((i) => [i.name, i]))
  assert.deepEqual(Object.keys(byName).sort(), ['alpha', 'beta', 'delta', 'gamma'])
  assert.deepEqual([byName.alpha.agent, byName.alpha.state, byName.alpha.live], ['codex', 'working', true])
  assert.deepEqual([byName.beta.state, byName.beta.live], ['done', false], 'ps knows better than «agent idle»')
  assert.deepEqual([byName.gamma.agent, byName.gamma.state], [null, 'working'], 'not in ps: the work list word')
  assert.equal(byName.delta.live, true, 'found through parent in ps')
  assert.ok(!interns.some((i) => i.name === 'other'), 'another bot’s worker is not ours')
  assert.deepEqual(interns.slice(0, 3).map((i) => i.live), [true, true, true], 'live ones first')
  assert.deepEqual(parseInterns({}, null, BOT, BOT_WS), [])
})

test('items: counts by status and Needs-you titles only, never descriptions', () => {
  const items = parseItems(ITEMS)!
  assert.deepEqual(items.counts, { needs_you: 2, planned: 1, done: 4 })
  assert.equal(items.needsYou, 2)
  assert.deepEqual(items.needsYouTitles, ['Выдуманный пункт про кофе', 'Ещё один выдуманный пункт'])
  assert.ok(!JSON.stringify(items).includes('не должно попасть'))
  assert.equal(parseItems({ counts: { in_progress: 1 }, items: [] })!.needsYou, 0)
  assert.equal(parseItems('garbage'), null)
})

test('current chat: the open one with the latest activity, its last answer clipped to ~280', () => {
  const chat = parseCurrentChat(CHATS)
  assert.ok(chat.ok)
  if (!chat.ok) return
  assert.equal(chat.title, 'Свежий выдуманный чат')
  assert.ok(chat.lastSaid.length <= LAST_SAID_MAX)
  assert.ok(chat.lastSaid.endsWith('…'))
  assert.equal(chat.chats, 2, 'closed chats are not counted')
  assert.deepEqual(parseCurrentChat({ chats: [] }), { ok: false, reason: 'нет открытых чатов' })
  assert.deepEqual(parseCurrentChat(null), { ok: false, reason: 'нет данных' })
})

function fakeRun(answers: Partial<Record<CliRequest['kind'], unknown>>, fail: CliRequest['kind'][] = []) {
  const calls: CliRequest[] = []
  const run = async (request: CliRequest): Promise<RunResult> => {
    calls.push(request)
    if (fail.includes(request.kind)) return { ok: false, error: 'timeout' }
    const json = answers[request.kind]
    return json === undefined ? { ok: false, error: 'failed' } : { ok: true, json }
  }
  return { run, calls }
}

test('reading extras: everything for each bot, and never the chats', async () => {
  const { run, calls } = fakeRun({ 'bot-list': BOT_LIST, 'worktree-ps': PS, 'bot-work': WORK, 'bot-items': ITEMS, 'worker-list': { workers: [] } })
  const extras = await readExtras(run, [{ key: 'cto', name: BOT, workspaceId: BOT_WS }], '/bin/orca')
  assert.equal(extras.error, null)
  assert.equal(extras.bots.cto.botId, 'uuid-1')
  assert.equal(extras.bots.cto.agent, 'claude')
  assert.equal(extras.bots.cto.interns?.filter((i) => i.live).length, 3)
  assert.equal(extras.bots.cto.items?.needsYou, 2)
  assert.ok(!calls.some((c) => c.kind === 'bot-chats'), 'chats are read only for an open panel')
})

test('CLI down or timing out: «no data» per part, nothing throws', async () => {
  const { run } = fakeRun({ 'bot-list': BOT_LIST }, ['worktree-ps', 'bot-work', 'bot-items', 'worker-list'])
  const extras = await readExtras(run, [{ key: 'cto', name: BOT, workspaceId: BOT_WS }], null)
  assert.equal(extras.error, 'timeout')
  assert.equal(extras.bots.cto.interns, null)
  assert.equal(extras.bots.cto.items, null)
  assert.equal(extras.bots.cto.botId, 'uuid-1')
  const none = await readExtras(fakeRun({}).run, [{ key: 'cto', name: BOT, workspaceId: BOT_WS }], null)
  assert.deepEqual([none.bots.cto.interns, none.bots.cto.items, none.bots.cto.botId], [null, null, null])
})

function fakeClock() {
  let now = 1_000_000
  const timers: { at: number; fn: () => void; id: number }[] = []
  let next = 1
  const clock: Clock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = next++
      timers.push({ at: now + ms, fn, id })
      return id
    },
    clearTimeout: (id) => {
      const i = timers.findIndex((t) => t.id === id)
      if (i >= 0) timers.splice(i, 1)
    }
  }
  const advance = async (ms: number) => {
    now += ms
    for (const t of timers.filter((t) => t.at <= now)) {
      timers.splice(timers.indexOf(t), 1)
      t.fn()
    }
    await new Promise((r) => setTimeout(r, 0))
  }
  return { clock, advance, timers, get now() {
    return now
  } }
}

test('polling: at most every 30 s per tab; events debounce and only while a tab is open', async () => {
  const fake = fakeClock()
  const empty = (): Extras => ({ at: fake.now, source: null, error: null, bots: {} })
  const posted: Extras[] = []
  const source = new ExtrasSource(async () => empty(), fake.clock, (e) => posted.push(e))
  source.poke()
  await fake.advance(5_000)
  assert.equal(source.reads, 0, 'no tab, no reads on events')
  await source.ask()
  assert.equal(source.reads, 1)
  await fake.advance(10_000)
  await source.ask()
  assert.equal(source.reads, 1, 'fresh cache within 30 s')
  await fake.advance(25_000)
  await source.ask()
  assert.equal(source.reads, 2)
  // Events: a burst becomes one read after the debounce.
  await fake.advance(11_000)
  source.poke()
  source.poke()
  source.poke()
  await fake.advance(2_000)
  assert.equal(source.reads, 2)
  await fake.advance(1_500)
  assert.equal(source.reads, 3)
  assert.equal(posted.length, 1)
  // The tab closed (no asks for long): events stop reading.
  await fake.advance(120_000)
  source.poke()
  await fake.advance(5_000)
  assert.equal(source.reads, 3)
})

test('a worker released with worker-release leaves at once (unless an agent still runs there)', () => {
  const released = releasedWorkspaces({
    workers: [
      { dispatchId: 'ctx_1', workspace: 'repo::/w/beta', terminalState: 'released' },
      { dispatchId: 'ctx_2', workspace: 'repo::/w/beta', terminalState: 'released' },
      { dispatchId: 'ctx_3', workspace: 'repo::/w/alpha', terminalState: 'released' },
      { dispatchId: 'ctx_4', workspace: 'repo::/w/alpha', terminalState: 'retained' }
    ]
  })
  assert.deepEqual([...released], ['repo::/w/beta'])
  assert.deepEqual([...releasedWorkspaces(null)], [])
})

test('reading extras drops released workers that have no live agent', async () => {
  const { run } = fakeRun({
    'bot-list': BOT_LIST,
    'worktree-ps': PS,
    'bot-work': WORK,
    'bot-items': ITEMS,
    'worker-list': { workers: [{ dispatchId: 'ctx_9', workspace: `${REPO}::/w/beta`, terminalState: 'released' }, { dispatchId: 'ctx_8', workspace: `${REPO}::/w/alpha`, terminalState: 'released' }] }
  })
  const extras = await readExtras(run, [{ key: 'cto', name: BOT, workspaceId: BOT_WS }], null)
  const names = extras.bots.cto.interns!.map((i) => i.name)
  assert.ok(!names.includes('beta'), 'released and done: gone')
  assert.ok(names.includes('alpha'), 'released but its agent still works: stays')
})

test('«стажёры»: a worker’s subagents come from worktree ps while they run, and leave when done', () => {
  const ps = (subs: unknown[] | null) => ({
    worktrees: [
      {
        worktreeId: 'repo::/w/one',
        displayName: 'one',
        bot: 'Ада',
        agents: [{ state: 'working', agentType: 'claude', stateStartedAt: 5, ...(subs ? { subagents: subs, subagentObservation: 'live' } : {}) }]
      }
    ]
  })
  const running = parseWorktreePs(ps([{ id: 'sub-1', state: 'working', startedAt: 7, agentType: 'general-purpose' }, { nope: true }]))
  assert.deepEqual(running.get('repo::/w/one')!.subagents, [{ id: 'sub-1', type: 'general-purpose', state: 'working', startedAt: 7 }])
  const interns = parseInterns({ workspaces: [] }, running, 'Ада', 'home')
  assert.equal(interns[0].subagents.length, 1, 'the worker carries its trainee')
  const done = parseWorktreePs(ps(null))
  assert.deepEqual(done.get('repo::/w/one')!.subagents, [], 'gone from the list once finished')
})
