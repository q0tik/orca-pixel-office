import { assert, test } from 'orca/testing'
import { botKey, deskState, isBotWorkspace, makeDesk, splitBotName, type WorkspaceRow } from './bots'

const row = (over: Partial<WorkspaceRow>): WorkspaceRow => ({
  id: 'folder:x',
  kind: 'folder',
  name: '[CTO] Ада',
  path: '/home/demo/.orca/bots/cto',
  hostId: null,
  ...over
})

test('only bot homes are bots', () => {
  // The three real bots.
  assert.ok(isBotWorkspace(row({ path: '/home/demo/.orca/bots/cto' })))
  assert.ok(isBotWorkspace(row({ path: '/home/demo/.orca/bots/bot-2' })))
  assert.ok(isBotWorkspace(row({ path: '/home/demo/.orca/bots/seller/' })))
  assert.ok(isBotWorkspace(row({ path: 'C:\\Users\\q\\.orca\\bots\\seller' })))
  // A worktree a bot dispatched (a worker), even if its path looks like a bot's.
  assert.ok(!isBotWorkspace(row({ kind: 'worktree', path: '/home/demo/orca/workspaces/orca-pixel-office/pixel-office-v2' })))
  assert.ok(!isBotWorkspace(row({ kind: 'worktree', path: '/home/demo/.orca/bots/cto' })))
  // Other folder workspaces: project folders, the bots root, something nested in a bot home.
  assert.ok(!isBotWorkspace(row({ path: '/home/demo/Notes' })))
  assert.ok(!isBotWorkspace(row({ path: '/home/demo/.orca/bots' })))
  assert.ok(!isBotWorkspace(row({ path: '/home/demo/.orca/bots/cto/notes' })))
  assert.ok(!isBotWorkspace(row({ path: '/home/demo/bots/cto' })))
})

test('splits the role prefix off the bot name', () => {
  assert.deepEqual(splitBotName('[assistant] Грейс'), { name: 'Грейс', role: 'assistant' })
  assert.deepEqual(splitBotName('[CSO] Лео'), { name: 'Лео', role: 'CSO' })
  assert.deepEqual(splitBotName('Петя'), { name: 'Петя', role: '' })
  assert.deepEqual(splitBotName('[CTO]'), { name: '[CTO]', role: '' })
})

test('a desk shows the most urgent session, timed from its earliest start', () => {
  assert.deepEqual(deskState([]), { state: 'idle', since: null })
  assert.deepEqual(deskState([{ state: 'done', since: 5 }]), { state: 'done', since: 5 })
  assert.deepEqual(
    deskState([
      { state: 'done', since: 1 },
      { state: 'working', since: 30 },
      { state: 'working', since: 20 }
    ]),
    { state: 'working', since: 20 }
  )
  assert.deepEqual(
    deskState([
      { state: 'working', since: 1 },
      { state: 'waiting', since: 9 }
    ]),
    { state: 'waiting', since: 9 }
  )
  assert.deepEqual(
    deskState([
      { state: 'waiting', since: 1 },
      { state: 'blocked', since: 9 }
    ]),
    { state: 'blocked', since: 9 }
  )
})

test('makeDesk names the bot and counts its sessions', () => {
  const desk = makeDesk(row({ id: 'folder:k' }), [
    { state: 'working', since: 7, agent: 'claude' },
    { state: 'done', since: 3, agent: 'codex' },
    { state: 'done', since: 4, agent: 'claude' }
  ])
  assert.deepEqual(desk, {
    id: 'folder:k',
    key: 'cto',
    hostId: null,
    agents: ['claude', 'codex'],
    name: 'Ада',
    role: 'CTO',
    state: 'working',
    since: 7,
    sessions: 3,
    failed: false
  })
})

test('the seating key is the bot home folder, with the host for another machine', () => {
  assert.equal(botKey({ path: '/home/demo/.orca/bots/cto', hostId: null }), 'cto')
  assert.equal(botKey({ path: '/home/demo/.orca/bots/bot-2/', hostId: 'local' }), 'bot-2')
  assert.equal(botKey({ path: 'C:\\Users\\q\\.orca\\bots\\seller', hostId: null }), 'seller')
  assert.equal(botKey({ path: '/home/demo/.orca/bots/cto', hostId: 'ssh:devbox' }), 'ssh:devbox/cto')
})
