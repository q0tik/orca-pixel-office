// Fixtures are shaped like the real CLI answers (checked 2026-11-24) with made-up text only.
import { assert, test } from 'orca/testing'
import type { CliRequest, RunResult } from './cli'
import { releasedWorkspaces, ExtrasSource, LAST_SAID_MAX, parseBotList, parseCurrentChat, parseInterns, parseItems, parseWorktreePs, readExtras, type Clock, type Extras, FinishTracker, type InternState, SubagentTracker } from './extras'
import { traineesView } from '../editor/panel'
import { presentWorkers } from '../engine/workers'

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

// ── «Стажёры»: subagents from `worktree ps` (agents[].children), only what Orca observes ─────────

const child = (id: string, state: string, extra: Record<string, unknown> = {}) => ({ id, providerId: 'p', kind: 'agent', name: 'general-purpose', agentType: 'general-purpose', model: 'some-model', state, membership: 'live', firstObservedAt: 100, observedAt: 200, ...extra })
const agentWith = (children: unknown[] | undefined, observation: string | null = 'live') => ({ state: 'working', agentType: 'claude', stateStartedAt: 5, subagentObservation: observation, ...(children ? { children } : {}) })

test('«стажёры»: children working → a trainee with what it does; done → pale with its time; no field → none', () => {
  const ps = parseWorktreePs({
    worktrees: [
      {
        worktreeId: 'repo::/w/one',
        displayName: 'one',
        bot: 'Тест',
        agents: [
          agentWith([
            child('c1', 'working', { description: 'Probe subagent visibility', operation: { toolName: 'Bash', basis: 'reported' } }),
            child('c2', 'done', { observedAt: 9_000 }),
            child('c3', 'working', { kind: 'tool' }),
            child('c4', 'working', { description: undefined, agentType: undefined, name: 'Explore' }),
            { nope: true }
          ])
        ]
      },
      { worktreeId: 'repo::/w/two', displayName: 'two', bot: 'Тест', agents: [agentWith(undefined)] },
      { worktreeId: 'repo::/w/three', displayName: 'three', bot: 'Тест', agents: [agentWith([child('x', 'working')], 'unverifiable')] },
      { worktreeId: 'repo::/w/four', displayName: 'four', bot: 'Тест', agents: [agentWith([child('y', 'working')], null)] }
    ]
  })
  const one = ps.get('repo::/w/one')!
  assert.deepEqual(
    one.subagents.map((s) => [s.id, s.label, s.live, s.tool, s.model, s.endedAt]),
    [
      ['c1', 'Probe subagent visibility', true, 'Bash', 'some-model', null],
      ['c2', 'general-purpose', false, null, 'some-model', 9_000],
      ['c4', 'Explore', true, null, 'some-model', null]
    ],
    'description, else agentType, else name; a child that is not an agent is not a trainee'
  )
  assert.equal(one.subagentsObserved, true)
  assert.deepEqual(ps.get('repo::/w/two')!.subagents, [], 'no children field: none')
  // Orca does not observe the subagents (unverifiable, or not at all): nothing is made up.
  for (const id of ['repo::/w/three', 'repo::/w/four']) {
    assert.deepEqual(ps.get(id)!.subagents, [], `${id}: none`)
    assert.equal(ps.get(id)!.subagentsObserved, false)
  }
  // The worker carries its trainees and says whether they are observed.
  const interns = parseInterns({ workspaces: [] }, ps, 'Тест', 'home')
  assert.equal(interns.find((i) => i.id === 'repo::/w/one')!.subagents.length, 3)
  assert.equal(interns.find((i) => i.id === 'repo::/w/three')!.subagentsObserved, false)
})

test('«стажёры»: only children of kind agent; a background command (kind command) is not a trainee', () => {
  const ps = parseWorktreePs({
    worktrees: [
      {
        worktreeId: 'repo::/w/home',
        displayName: 'home',
        bot: 'Тест',
        botHome: true,
        agents: [
          agentWith([
            child('a1', 'done', { description: 'Probe intern one', membership: 'settled' }),
            { id: 'cmd1', kind: 'command', state: 'working', membership: 'live', description: 'Sleep 150 seconds then echo done' },
            child('a2', 'working', { description: 'Working intern probe', operation: { toolName: 'Bash' } })
          ])
        ]
      }
    ]
  })
  assert.deepEqual(ps.get('repo::/w/home')!.subagents.map((s) => [s.id, s.live]), [['a1', false], ['a2', true]])
})

test('«стажёры»: a finished trainee stays pale 10 minutes from when it finished, then leaves', () => {
  const tracker = new SubagentTracker()
  const sub = (live: boolean, endedAt: number | null = null) => ({ id: 's', label: 'x', type: null, model: null, tool: null, state: (live ? 'working' : 'done') as InternState, live, startedAt: 0, endedAt })
  const t0 = 1_000_000
  assert.equal(tracker.stamp('w:a', [sub(true)], t0).length, 1)
  // Done, with Orca's time: pale until ten minutes after it.
  assert.deepEqual(tracker.stamp('w:a', [sub(false, t0 + MIN)], t0 + 2 * MIN).map((s) => [s.live, s.endedAt]), [[false, t0 + MIN]])
  assert.deepEqual(tracker.stamp('w:a', [sub(false, t0 + MIN)], t0 + 12 * MIN), [], 'gone after 10 minutes')
  // Gone from the list while it worked: finished when the plugin noticed, pale, then gone.
  tracker.stamp('bot:b', [sub(true)], t0)
  assert.deepEqual(tracker.stamp('bot:b', [], t0 + MIN).map((s) => [s.live, s.endedAt]), [[false, t0 + MIN]])
  assert.deepEqual(tracker.stamp('bot:b', [], t0 + 12 * MIN), [])
  // A trainee never seen working, done with no time: not shown.
  assert.deepEqual(tracker.stamp('w:c', [sub(false)], t0), [])
})

test('«стажёры» of a bot come from its own chats (its home row), summed over all of them; a worker’s stay with the worker', async () => {
  const ps = {
    worktrees: [
      // The bot's home: an agent per chat; two chats run subagents, one is not observed.
      {
        worktreeId: BOT_WS, path: '/home/.orca/bots/test', bot: BOT, botHome: true, parent: null,
        agents: [agentWith([child('h1', 'working', { description: 'Home chat probe' })]), agentWith([child('h2', 'working'), child('h3', 'blocked')]), agentWith([child('h4', 'working')], 'unverifiable')]
      },
      { worktreeId: `${REPO}::/w/alpha`, path: '/w/alpha', displayName: 'alpha', bot: BOT, parent: { state: 'known', selector: BOT_WS }, agents: [agentWith([child('w1', 'working')])] }
    ]
  }
  const work = { botName: BOT, items: [], workspaces: [{ id: `${REPO}::/w/alpha`, name: 'alpha', agent: 'agent working' }] }
  const { run } = fakeRun({ 'bot-list': BOT_LIST, 'worktree-ps': ps, 'bot-work': work, 'bot-items': ITEMS, 'worker-list': { workers: [] } })
  const extras = await readExtras(run, [{ key: 'cto', name: BOT, workspaceId: BOT_WS }], '/bin/orca')
  const bot = extras.bots.cto
  assert.deepEqual(bot.trainees?.map((t) => t.id).sort(), ['h1', 'h2', 'h3'], 'all the bot’s observed chats, summed')
  assert.equal(bot.traineesObserved, true)
  assert.deepEqual(bot.interns?.find((i) => i.name === 'alpha')!.subagents.map((s) => s.id), ['w1'], 'the worker’s trainee stays with the worker')
  // Not observed at all: none, and the panel says so.
  const { run: run2 } = fakeRun({ 'bot-list': BOT_LIST, 'worktree-ps': { worktrees: [{ ...ps.worktrees[0], agents: [agentWith([child('h1', 'working')], 'unverifiable')] }] }, 'bot-work': work, 'bot-items': ITEMS, 'worker-list': { workers: [] } })
  const unseen = (await readExtras(run2, [{ key: 'cto', name: BOT, workspaceId: BOT_WS }], '/bin/orca')).bots.cto
  assert.deepEqual(unseen.trainees, [])
  assert.equal(unseen.traineesObserved, false)
  assert.equal(traineesView(unseen.trainees, unseen.traineesObserved ?? false, 0).kind === 'none' && (traineesView(unseen.trainees, false, 0) as { text: string }).text, 'субагенты не наблюдаются')
  const shown = traineesView(bot.trainees, true, 0)
  assert.ok(shown.kind === 'list' && shown.list.some((t) => t.label === 'Home chat probe' && t.hint.includes('some-model')))
})

// ── Who is in «Команды и отделы»: workers by their agents, not by their workspaces ─────────────

const MIN = 60_000

function teamToday(now: number) {
  const ps = parseWorktreePs({
    worktrees: [
      // A shell left open, no agent: the workspace says «active», but nobody works there.
      { worktreeId: 'w-shell', displayName: 'shell-open', path: '/w/shell-open', bot: '[CTO] Ада', status: 'active', liveTerminalCount: 1, agents: [] },
      // Its dispatch succeeded long ago: the agent is done since 11 minutes.
      { worktreeId: 'w-old', displayName: 'old', path: '/w/old', bot: '[CTO] Ада', status: 'active', liveTerminalCount: 1, agents: [{ state: 'done', stateStartedAt: now - 11 * MIN, agentType: 'claude', subagentObservation: 'live', children: [{ id: 'stale', kind: 'agent', state: 'working', agentType: 'Explore', firstObservedAt: now - 30 * MIN }] }] },
      // Finished three minutes ago.
      { worktreeId: 'w-recent', displayName: 'recent', path: '/w/recent', bot: '[CTO] Ада', status: 'inactive', liveTerminalCount: 0, agents: [{ state: 'done', stateStartedAt: now - 3 * MIN, agentType: 'claude' }] },
      // At work, with a trainee.
      { worktreeId: 'w-busy', displayName: 'busy', path: '/w/busy', bot: '[CTO] Ада', status: 'working', liveTerminalCount: 1, agents: [{ state: 'working', stateStartedAt: now - MIN, agentType: 'claude', subagentObservation: 'live', children: [{ id: 's1', kind: 'agent', state: 'working', agentType: 'Explore', firstObservedAt: now - 10_000 }] }] },
      // An old workspace with nothing in it.
      { worktreeId: 'w-ancient', displayName: 'ancient', path: '/w/ancient', bot: '[CTO] Ада', status: 'inactive', liveTerminalCount: 0, agents: [] }
    ]
  })
  const work = { workspaces: ['w-shell', 'w-old', 'w-recent', 'w-busy', 'w-ancient'].map((id) => ({ id, name: id.slice(2), agent: id === 'w-busy' ? 'agent working' : 'agent idle' })) }
  return parseInterns(work, ps, '[CTO] Ада', 'folder:ada')
}

const asWorkers = (interns: ReturnType<typeof teamToday>) => interns.map((i) => ({ id: i.id, name: i.name, parentKey: 'ada', agent: i.agent, state: i.state, live: i.live, since: i.since, subagents: i.subagents }))

test('in the team room only workers whose agent works, or finished less than 10 minutes ago (pale)', () => {
  const now = 10_000_000
  const present = presentWorkers(asWorkers(teamToday(now)), now)
  // A live terminal with no agent, an «active» workspace, an old one, a dispatch done 11 min ago: nobody.
  assert.deepEqual(present.map((w) => w.id).sort(), ['w-busy', 'w-recent'])
  assert.equal(present.find((w) => w.id === 'w-busy')!.live, true, 'working: at the desk')
  assert.equal(present.find((w) => w.id === 'w-recent')!.live, false, 'done 3 min ago: pale (the tab draws finished workers at 45%)')
  // Ten minutes after it finished, the recent one has left too; opening the office again brings nobody back.
  assert.deepEqual(presentWorkers(asWorkers(teamToday(now)), now + 8 * MIN).map((w) => w.id), ['w-busy'])
  assert.deepEqual(presentWorkers(asWorkers(teamToday(now)), now + 8 * MIN).map((w) => w.id), ['w-busy'])
})

test('trainees leave with their worker', () => {
  const now = 10_000_000
  const present = presentWorkers(asWorkers(teamToday(now)), now)
  const trainees = present.flatMap((w) => (w.subagents ?? []).map((s) => `${w.id}#${s.id}`))
  assert.deepEqual(trainees, ['w-busy#s1'], 'the old worker’s stale subagent is gone with it')
})

test('a worker the plugin saw working, whose agent then went away, stays pale 10 minutes from that moment', () => {
  const tracker = new FinishTracker()
  const t0 = 1_000_000
  const intern = (live: boolean) => ({ id: 'w-x', name: 'x', agent: live ? 'claude' : null, state: (live ? 'working' : 'idle') as InternState, live, since: live ? t0 : null, subagents: [] })
  const never = { id: 'w-never', name: 'never', agent: null, state: 'idle' as InternState, live: false, since: null, subagents: [] }
  tracker.stamp([intern(true), never], t0)
  // The dispatch succeeded and its agent left: no time from Orca, the plugin stamps when it saw it stop.
  const after = tracker.stamp([intern(false), never], t0 + MIN)
  assert.equal(after[0].since, t0 + MIN)
  assert.equal(after[1].since, null, 'never seen working: no time')
  const show = (now: number) => presentWorkers(asWorkers(tracker.stamp([intern(false), never], now)), now).map((w) => w.id)
  assert.deepEqual(show(t0 + 5 * MIN), ['w-x'])
  assert.deepEqual(show(t0 + 12 * MIN), [])
})
