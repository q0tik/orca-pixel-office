// The worker over a mock host shaped like the real Orca: three bots, a worker worktree a bot
// dispatched, project workspaces and a plain folder workspace.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, assert, mockHost, mountWorker, test, type TestWorker } from 'orca/testing'
import type { Office } from './protocol'
import * as main from './worker'

const ADA = 'folder:5b06'
const LEO = 'folder:4f8c'
const GRACE = 'folder:b6a9'
const WORKER = 'identity:wt2:local:worker'

type Row = { id: string; kind: 'worktree' | 'folder'; name: string; path: string; branch: string | null; hostId: string | null }

function rows(): Row[] {
  return [
    { id: ADA, kind: 'folder', name: '[CTO] Ада', path: '/home/demo/.orca/bots/cto', branch: null, hostId: null },
    { id: LEO, kind: 'folder', name: '[CSO] Лео', path: '/home/demo/.orca/bots/seller', branch: null, hostId: null },
    { id: GRACE, kind: 'folder', name: '[assistant] Грейс', path: '/home/demo/.orca/bots/bot-2', branch: null, hostId: null },
    { id: WORKER, kind: 'worktree', name: 'pixel-office-v2', path: '/home/demo/orca/workspaces/orca-pixel-office/pixel-office-v2', branch: 'demo/pixel-office-v2', hostId: 'local' },
    { id: 'identity:wt2:local:app', kind: 'worktree', name: 'main', path: '/home/demo/projects/app', branch: 'main', hostId: 'local' },
    { id: 'folder:notes', kind: 'folder', name: 'Notes', path: '/home/demo/Notes', branch: null, hostId: null }
  ]
}

const agentsByWorkspace: Record<string, { state: string; stateStartedAt: number; sessionId: string }[]> = {
  [ADA]: [
    { state: 'done', stateStartedAt: 100, sessionId: 'k1' },
    { state: 'done', stateStartedAt: 200, sessionId: 'k2' }
  ],
  [LEO]: [{ state: 'done', stateStartedAt: 300, sessionId: 'v1' }],
  [GRACE]: [{ state: 'working', stateStartedAt: 400, sessionId: 'r1' }],
  [WORKER]: [{ state: 'working', stateStartedAt: 1, sessionId: 'w1' }],
  'identity:wt2:local:app': [{ state: 'blocked', stateStartedAt: 1, sessionId: 'q1' }],
  'folder:notes': [{ state: 'working', stateStartedAt: 1, sessionId: 'c1' }]
}

function host(list: Row[] = rows(), focused: string | null = WORKER) {
  return mockHost({
    results: {
      'workspace.list': () => ({ workspaces: list, truncated: false }),
      'agents.list': (params: { workspaceId?: string }) => ({
        agents: (agentsByWorkspace[params.workspaceId ?? ''] ?? []).map((agent) => ({
          terminalId: null,
          title: null,
          agent: 'claude',
          ...agent
        }))
      }),
      'workspace.readContext': () => (focused ? { workspaceId: focused, branch: 'x', displayName: 'x', terminals: [] } : null),
      'statusBar.update': () => ({ ok: true }),
      'editor.open': () => ({ opened: true }),
      'workspace.open': () => ({ opened: true })
    }
  })
}

let worker: TestWorker | undefined
afterEach(async () => {
  await worker?.deactivate()
  worker = undefined
})

const names = (office: Office) => office.desks.map((desk) => `${desk.name}:${desk.state}`)

test('shows only the Orca bots: workers, projects and other folders are left out', async () => {
  const h = host()
  worker = await mountWorker(main, { host: h })
  const office = await worker.request('office.desks')
  assert.deepEqual(names(office), ['Ада:done', 'Грейс:working', 'Лео:done'])
  // agents.list is read only for the bots' workspaces.
  const read = h.callsOf('agents.list').map((params) => (params as { workspaceId: string }).workspaceId)
  assert.deepEqual([...new Set(read)].sort(), [ADA, GRACE, LEO].sort())
  assert.deepEqual(worker.refusals, [])
})

test('an agent event changes the desk and the status bar, with no new reads', async () => {
  const h = host()
  worker = await mountWorker(main, { host: h })
  await worker.request('office.desks')
  const listsBefore = h.callsOf('workspace.list').length
  await worker.emit('agent.status.changed', {
    workspaceId: LEO,
    paneKey: 'pane-v',
    sessionId: 'v1',
    state: 'working',
    receivedAt: 5000
  })
  const posted = worker.posts.at(-1)
  assert.equal(posted?.event, 'office.desks')
  const leo = (posted?.payload as Office).desks.find((desk) => desk.name === 'Лео')
  assert.deepEqual([leo?.state, leo?.since, leo?.sessions], ['working', 5000, 1])
  assert.equal(h.callsOf('workspace.list').length, listsBefore)
  const bar = h.callsOf('statusBar.update').at(-1) as { text: string; tone: string }
  assert.equal(bar.text, '🟢 2 работают')
  assert.equal(bar.tone, 'success')

  // The tab opened later gets the event's state, not a fresh re-read.
  assert.deepEqual(names(await worker.request('office.desks')), ['Ада:done', 'Грейс:working', 'Лео:working'])

  await worker.emit('agent.status.changed', {
    workspaceId: GRACE,
    paneKey: 'pane-r',
    state: 'blocked',
    receivedAt: 6000,
    mainAgent: { state: 'blocked', stateStartedAt: 5900 }
  })
  const grace = (worker.posts.at(-1)?.payload as Office).desks.find((desk) => desk.name === 'Грейс')
  assert.deepEqual([grace?.state, grace?.since, grace?.sessions], ['blocked', 5900, 1])
  const warn = h.callsOf('statusBar.update').at(-1) as { text: string; tone: string }
  assert.equal(warn.tone, 'warning')
  assert.deepEqual(worker.refusals, [])
})

test('events from workers and projects do not touch the office', async () => {
  worker = await mountWorker(main, { host: host() })
  await worker.request('office.desks')
  const posts = worker.posts.length
  await worker.emit('agent.status.changed', { workspaceId: WORKER, paneKey: 'p', state: 'blocked', receivedAt: 1 })
  await worker.emit('agent.status.changed', { workspaceId: 'folder:notes', paneKey: 'p', state: 'blocked', receivedAt: 1 })
  assert.equal(worker.posts.length, posts)
  assert.deepEqual(names(await worker.request('office.desks')), ['Ада:done', 'Грейс:working', 'Лео:done'])
})

test('a new bot shows up by itself', async () => {
  const list = rows()
  worker = await mountWorker(main, { host: host(list) })
  await worker.request('office.desks')
  list.push({ id: 'folder:new', kind: 'folder', name: '[CFO] Зина', path: '/home/demo/.orca/bots/cfo', branch: null, hostId: null })
  await worker.emit('agent.status.changed', { workspaceId: 'folder:new', paneKey: 'p', state: 'working', receivedAt: 9 })
  assert.deepEqual(names(await worker.request('office.desks')), ['Ада:done', 'Грейс:working', 'Зина:working', 'Лео:done'])
})

test('Open Pixel Office creates a git-ignored office file in the focused workspace and opens it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pixel-office-'))
  try {
    const list = rows().map((row) => (row.id === WORKER ? { ...row, path: dir } : row))
    const h = host(list, WORKER)
    worker = await mountWorker(main, { host: h })
    assert.equal(await worker.command('pixel-office.open'), 'Pixel Office открыт')
    assert.equal(readFileSync(join(dir, '.pixel-office', '.gitignore'), 'utf8'), '*\n')
    assert.ok(existsSync(join(dir, '.pixel-office', 'office.pixel')))
    assert.deepEqual(h.callsOf('editor.open').at(-1), {
      workspaceId: WORKER,
      path: '.pixel-office/office.pixel'
    })
    // Running it again reopens the same file.
    await worker.command('pixel-office.open')
    assert.equal(h.callsOf('editor.open').length, 2)
    assert.deepEqual(worker.refusals, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('«Открыть бота в Orca» opens the bot home; unknown bots run nothing', async () => {
  const h = host()
  worker = await mountWorker(main, { host: h })
  await worker.request('office.desks')
  assert.deepEqual(await worker.request('office.openBot', { key: 'cto' }), { opened: true })
  assert.deepEqual(h.callsOf('workspace.open'), [{ workspaceId: ADA }])
  assert.deepEqual(await worker.request('office.openBot', { key: 'nope' }), { opened: false, reason: 'бот не найден' })
  // A chat for a bot that does not exist never reaches the CLI.
  assert.deepEqual(await worker.request('office.chat', { key: '--all' }), { ok: false, reason: 'бот не найден' })
  assert.deepEqual(worker.refusals, [])
})

/** A host whose bots' chats the test changes as it goes (what `orca agent list` would show now). */
function liveHost(chats: Record<string, { state: string; stateStartedAt: number; sessionId: string }[]>) {
  return mockHost({
    results: {
      'workspace.list': () => ({ workspaces: rows(), truncated: false }),
      'agents.list': (params: { workspaceId?: string }) => ({
        agents: (chats[params.workspaceId ?? ''] ?? []).map((agent) => ({ terminalId: null, title: null, agent: 'claude', ...agent }))
      }),
      'workspace.readContext': () => null,
      'statusBar.update': () => ({ ok: true })
    }
  })
}

test('a bot works only while one of its chats works: all done → free, one working → working, one blocked → blocked', async () => {
  const chats: Record<string, { state: string; stateStartedAt: number; sessionId: string }[]> = {
    [ADA]: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ state: 'done', stateStartedAt: n, sessionId: `k${n}` })),
    [LEO]: [
      { state: 'done', stateStartedAt: 1, sessionId: 'v1' },
      { state: 'working', stateStartedAt: 2, sessionId: 'v2' }
    ],
    [GRACE]: [
      { state: 'done', stateStartedAt: 1, sessionId: 'r1' },
      { state: 'blocked', stateStartedAt: 2, sessionId: 'r2' }
    ],
    // A worker the CTO dispatched works: that is its employee, not the CTO.
    [WORKER]: [{ state: 'working', stateStartedAt: 1, sessionId: 'w1' }]
  }
  worker = await mountWorker(main, { host: liveHost(chats) })
  assert.deepEqual(names(await worker.request('office.desks')), ['Ада:done', 'Грейс:blocked', 'Лео:working'])
  // Its worker working does not make the CTO work either.
  await worker.emit('agent.status.changed', { workspaceId: WORKER, paneKey: 'p', sessionId: 'w1', state: 'working', receivedAt: 10 })
  assert.deepEqual(names(await worker.request('office.desks')), ['Ада:done', 'Грейс:blocked', 'Лео:working'])
})

test('a stale «working» event whose «done» never came does not keep the bot at work once a fresh list says done', async () => {
  const chats: Record<string, { state: string; stateStartedAt: number; sessionId: string }[]> = {
    [ADA]: [
      { state: 'done', stateStartedAt: 1, sessionId: 'k1' },
      { state: 'done', stateStartedAt: 2, sessionId: 'k2' }
    ],
    [LEO]: [{ state: 'done', stateStartedAt: 1, sessionId: 'v1' }],
    [GRACE]: [{ state: 'done', stateStartedAt: 1, sessionId: 'r1' }]
  }
  worker = await mountWorker(main, { host: liveHost(chats) })
  await worker.request('office.desks')
  // A chat starts working: the event (keyed only by its pane, as Orca sometimes sends it) shows it at once.
  chats[ADA][0] = { state: 'working', stateStartedAt: 50, sessionId: 'k1' }
  await worker.emit('agent.status.changed', { workspaceId: ADA, paneKey: 'pane-k1', state: 'working', receivedAt: 50 })
  assert.deepEqual(names(await worker.request('office.desks')), ['Ада:working', 'Грейс:done', 'Лео:done'])
  // It finishes, but its «done» event never comes; Orca lists it as done. The next event of the bot (another chat)
  // brings a fresh list: nothing stays «working».
  chats[ADA][0] = { state: 'done', stateStartedAt: 90, sessionId: 'k1' }
  await worker.emit('agent.status.changed', { workspaceId: ADA, paneKey: 'pane-k2', sessionId: 'k2', state: 'done', receivedAt: 100 })
  const office = await worker.request('office.desks')
  assert.deepEqual(names(office), ['Ада:done', 'Грейс:done', 'Лео:done'])
  assert.equal(office.desks.find((d) => d.name === 'Ада')?.sessions, 2, 'as many chats as Orca lists, no ghosts')
  // A working event keyed by a pane, then a «done» keyed by the session: one chat, not two.
  chats[LEO][0] = { state: 'working', stateStartedAt: 120, sessionId: 'v1' }
  await worker.emit('agent.status.changed', { workspaceId: LEO, paneKey: 'pane-v1', state: 'working', receivedAt: 120 })
  chats[LEO][0] = { state: 'done', stateStartedAt: 130, sessionId: 'v1' }
  await worker.emit('agent.status.changed', { workspaceId: LEO, paneKey: 'pane-v1', sessionId: 'v1', state: 'done', receivedAt: 130 })
  const after = await worker.request('office.desks')
  assert.deepEqual(names(after), ['Ада:done', 'Грейс:done', 'Лео:done'])
  assert.equal(after.desks.find((d) => d.name === 'Лео')?.sessions, 1)
})
