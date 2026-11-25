import { assert, test } from 'orca/testing'
import { argsFor, FIXED_BINARY, findBinary, isAllowed, OrcaCli, safeBotName, TIMEOUT_MS, type Exec } from './cli'

test('the whitelist builds exactly the seven read-only commands', () => {
  assert.deepEqual(argsFor({ kind: 'bot-list' }), ['bot', 'list', '--json'])
  assert.deepEqual(argsFor({ kind: 'worktree-ps' }), ['worktree', 'ps', '--json'])
  assert.deepEqual(argsFor({ kind: 'bot-work', bot: '[CTO] Ада' }), ['bot', 'work', 'list', '--bot', '[CTO] Ада', '--json'])
  assert.deepEqual(argsFor({ kind: 'bot-items', bot: 'x' }), ['bot', 'item', 'list', '--bot', 'x', '--json'])
  assert.deepEqual(argsFor({ kind: 'bot-chats', bot: 'x' }), ['bot', 'chats', '--bot', 'x', '--json'])
  assert.deepEqual(argsFor({ kind: 'inbox' }), ['orchestration', 'inbox', '--json', '--limit', '50'])
  assert.deepEqual(argsFor({ kind: 'worker-list' }), ['orchestration', 'worker-list', '--json'])
  for (const kind of ['bot-list', 'worktree-ps', 'inbox', 'worker-list'] as const) assert.ok(isAllowed(argsFor({ kind })))
  for (const kind of ['bot-work', 'bot-items', 'bot-chats'] as const) assert.ok(isAllowed(argsFor({ kind, bot: '[CSO] Лео' })))
})

test('everything else is refused: writes, extra flags, other commands, flag-like names', () => {
  const refused: string[][] = [
    ['orchestration', 'send', '--to', 'bot:x', '--body', 'hi'],
    ['orchestration', 'inbox', '--json'],
    ['orchestration', 'inbox', '--limit', '50', '--json'],
    ['orchestration', 'inbox', '--json', '--limit', '500'],
    ['orchestration', 'inbox', '--json', '--limit', '50', '--full'],
    ['orchestration', 'inbox', '--json', '--limit', '50', '--terminal', 'term_x'],
    ['orchestration', 'worker-list', '--json', '--full'],
    ['orchestration', 'worker-list', '--json', '--limit', '100'],
    ['orchestration', 'worker-stop', '--json'],
    ['orchestration', 'check', '--json'],
    ['orchestration', 'reply', '--json'],
    ['orchestration', 'task-list', '--json'],
    ['bot', 'reply', '--json'],
    ['bot', 'create', '--json'],
    ['bot', 'item', 'set', '--bot', 'x', '--json'],
    ['bot', 'item', 'list', '--bot', 'x', '--json', '--all'],
    ['bot', 'item', 'list', '--bot', 'x'],
    ['bot', 'chats', '--bot', 'x', '--all', '--json'],
    ['bot', 'chats', '--json'],
    ['bot', 'list'],
    ['bot', 'list', '--json', '--pairing-code', 'orca://pair?x'],
    ['bot', 'work', 'list', '--bot', '--all', '--json'],
    ['bot', 'work', 'list', '--bot', '-x', '--json'],
    ['bot', 'work', 'list', '--bot', 'a\nb', '--json'],
    ['bot', 'work', 'list', '--bot', '', '--json'],
    ['worktree', 'rm', '--json'],
    ['worktree', 'ps', '--json', '--limit', '1'],
    ['terminal', 'send', '--json'],
    ['plugin', 'enable', 'x'],
    []
  ]
  for (const args of refused) assert.equal(isAllowed(args), false, args.join(' '))
  assert.equal(safeBotName('--help'), false)
  assert.equal(safeBotName('[CTO] Ада'), true)
})

function fakeExec(answers: Record<string, string | Error>) {
  const calls: { file: string; args: string[]; timeout: number; maxBuffer: number }[] = []
  const exec: Exec = async (file, args, options) => {
    calls.push({ file, args, ...options })
    const answer = answers[args.join(' ')]
    if (answer instanceof Error) throw answer
    if (answer === undefined) throw Object.assign(new Error('exit 1'), { code: 1 })
    return { stdout: answer }
  }
  return { exec, calls }
}

test('the runner refuses before any process starts, and runs allowed calls without a shell', async () => {
  const { exec, calls } = fakeExec({ 'bot list --json': JSON.stringify({ ok: true, result: { bots: [] } }) })
  const logs: string[] = []
  const cli = new OrcaCli(exec, {}, (l) => logs.push(l), async (p) => p === FIXED_BINARY)
  const refused = await cli.runArgs(['orchestration', 'send', '--to', 'bot:x'])
  assert.deepEqual(refused, { ok: false, error: 'refused: not a whitelisted read-only command' })
  assert.equal(calls.length, 0, 'no process for a refused command')
  const ok = await cli.run({ kind: 'bot-list' })
  assert.deepEqual(ok, { ok: true, json: { bots: [] } })
  assert.equal(calls[0].file, FIXED_BINARY)
  assert.deepEqual(calls[0].args, ['bot', 'list', '--json'])
  assert.ok(calls[0].timeout <= 15_000 && calls[0].timeout === TIMEOUT_MS)
  assert.ok(calls[0].maxBuffer > 0)
  assert.deepEqual(logs, [`orca CLI: ${FIXED_BINARY} (fixed)`])
})

test('timeouts, failures and a missing CLI come back as errors, never throws', async () => {
  const killed = Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' })
  const { exec } = fakeExec({ 'bot list --json': killed, 'worktree ps --json': 'not json' })
  const cli = new OrcaCli(exec, {}, () => {}, async () => true)
  assert.deepEqual(await cli.run({ kind: 'bot-list' }), { ok: false, error: 'timeout' })
  assert.equal((await cli.run({ kind: 'worktree-ps' })).ok, false)
  assert.equal((await cli.run({ kind: 'bot-work', bot: 'x' })).ok, false)
  const nowhere = new OrcaCli(exec, { PATH: '/nope' }, () => {}, async () => false)
  assert.deepEqual(await nowhere.run({ kind: 'bot-list' }), { ok: false, error: 'orca CLI not found' })
})

test('the binary: fixed path, else ORCA_CLI_COMMAND, else PATH', async () => {
  const has = (paths: string[]) => async (p: string) => paths.includes(p)
  assert.deepEqual(await findBinary({}, has([FIXED_BINARY])), { path: FIXED_BINARY, from: 'fixed' })
  assert.deepEqual(await findBinary({ ORCA_CLI_COMMAND: '/opt/orca/bin/orca' }, has(['/opt/orca/bin/orca'])), {
    path: '/opt/orca/bin/orca',
    from: 'ORCA_CLI_COMMAND'
  })
  assert.deepEqual(await findBinary({ ORCA_CLI_COMMAND: 'orca --evil', PATH: '/usr/local/bin:/bin' }, has(['/bin/orca'])), {
    path: '/bin/orca',
    from: 'PATH'
  })
  assert.equal(await findBinary({ PATH: 'relative:/x' }, has(['relative/orca'])), null)
})
