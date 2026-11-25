// Read-only access to Orca's own CLI from the trusted worker, decided by the CTO (stages 2 and 3):
// exactly seven commands, built here and checked again right before they run. No shell (execFile
// with an argument array), a fixed binary, a timeout and an output cap. Anything else, every
// writing command included (send, reply, item set, create…), is refused before a process starts.
import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { delimiter, join } from 'node:path'

export const TIMEOUT_MS = 15_000
export const MAX_BUFFER = 8 * 1024 * 1024
/** Where Orca installs its CLI on macOS; checked first. */
export const FIXED_BINARY = '/Applications/Orca.app/Contents/Resources/bin/orca'

export type CliRequest =
  | { kind: 'bot-list' }
  | { kind: 'bot-work'; bot: string }
  | { kind: 'bot-items'; bot: string }
  | { kind: 'worktree-ps' }
  /** Only when the owner opens that bot's panel; the answer is never stored or logged. */
  | { kind: 'bot-chats'; bot: string }
  /** Mail between all mailboxes, newest first; only metadata is kept (src/mail.ts drops bodies). */
  | { kind: 'inbox' }
  /** Dispatch → terminal and workspace, to tell whose worker a `dispatch:` address is. */
  | { kind: 'worker-list' }

/** How many messages one read asks for (the CLI has no «since» filter). */
export const INBOX_LIMIT = '50'

/** A bot name passed as one argument: never something the CLI could read as a flag. */
export function safeBotName(name: string): boolean {
  return name.length > 0 && name.length <= 200 && !name.startsWith('-') && !/[\0\r\n]/.test(name)
}

export function argsFor(request: CliRequest): string[] {
  switch (request.kind) {
    case 'bot-list':
      return ['bot', 'list', '--json']
    case 'worktree-ps':
      return ['worktree', 'ps', '--json']
    case 'bot-work':
      return ['bot', 'work', 'list', '--bot', request.bot, '--json']
    case 'bot-items':
      return ['bot', 'item', 'list', '--bot', request.bot, '--json']
    case 'bot-chats':
      return ['bot', 'chats', '--bot', request.bot, '--json']
    case 'inbox':
      return ['orchestration', 'inbox', '--json', '--limit', INBOX_LIMIT]
    case 'worker-list':
      return ['orchestration', 'worker-list', '--json']
  }
}

/** The exact argument lists allowed. `<bot>` stands for one safe bot name. Declared after the limits it uses. */
const ALLOWED: readonly (readonly string[])[] = [
  ['bot', 'list', '--json'],
  ['worktree', 'ps', '--json'],
  ['bot', 'work', 'list', '--bot', '<bot>', '--json'],
  ['bot', 'item', 'list', '--bot', '<bot>', '--json'],
  ['bot', 'chats', '--bot', '<bot>', '--json'],
  ['orchestration', 'inbox', '--json', '--limit', INBOX_LIMIT],
  ['orchestration', 'worker-list', '--json']
]

/** Whether an argument list is one of the seven read-only shapes, word for word. */
export function isAllowed(args: readonly string[]): boolean {
  return ALLOWED.some(
    (shape) =>
      shape.length === args.length &&
      shape.every((word, i) => (word === '<bot>' ? typeof args[i] === 'string' && safeBotName(args[i]) : word === args[i]))
  )
}

export type RunResult = { ok: true; json: unknown } | { ok: false; error: string }

/** Runs a binary with arguments and no shell; the seam tests replace. */
export type Exec = (file: string, args: string[], options: { timeout: number; maxBuffer: number }) => Promise<{ stdout: string }>

export const nodeExec: Exec = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { ...options, windowsHide: true }, (error, stdout) => {
      if (error) reject(error)
      else resolve({ stdout: String(stdout) })
    })
  })

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, 1 /* X_OK */)
    return true
  } catch {
    return false
  }
}

/**
 * The CLI binary: the fixed macOS path, else `ORCA_CLI_COMMAND` (an absolute path Orca exports
 * in some setups), else `orca` found on PATH. Null when none is there.
 */
export async function findBinary(
  env: Record<string, string | undefined>,
  isExecutable: (path: string) => Promise<boolean> = executable
): Promise<{ path: string; from: 'fixed' | 'ORCA_CLI_COMMAND' | 'PATH' } | null> {
  if (await isExecutable(FIXED_BINARY)) return { path: FIXED_BINARY, from: 'fixed' }
  const fromEnv = env.ORCA_CLI_COMMAND
  if (fromEnv && fromEnv.startsWith('/') && !/\s/.test(fromEnv) && (await isExecutable(fromEnv))) {
    return { path: fromEnv, from: 'ORCA_CLI_COMMAND' }
  }
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir.startsWith('/')) continue
    const candidate = join(dir, 'orca')
    if (await isExecutable(candidate)) return { path: candidate, from: 'PATH' }
  }
  return null
}

export class OrcaCli {
  private binary: Promise<{ path: string; from: string } | null> | null = null

  constructor(
    private readonly exec: Exec,
    private readonly env: Record<string, string | undefined>,
    private readonly log: (line: string) => void,
    private readonly isExecutable?: (path: string) => Promise<boolean>
  ) {}

  /** Which binary runs (for the log and the debug line). */
  async source(): Promise<string | null> {
    this.binary ??= findBinary(this.env, this.isExecutable).then((found) => {
      // Only the path and how it was found: never arguments or output.
      this.log(found ? `orca CLI: ${found.path} (${found.from})` : 'orca CLI not found: extras show «нет данных»')
      return found
    })
    return (await this.binary)?.path ?? null
  }

  async run(request: CliRequest): Promise<RunResult> {
    const args = argsFor(request)
    return this.runArgs(args)
  }

  /** The guard every call goes through; public so tests can feed it anything. */
  async runArgs(args: string[]): Promise<RunResult> {
    if (!isAllowed(args)) return { ok: false, error: 'refused: not a whitelisted read-only command' }
    const binary = await this.source()
    if (!binary) return { ok: false, error: 'orca CLI not found' }
    try {
      const { stdout } = await this.exec(binary, args, { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER })
      const parsed = JSON.parse(stdout) as { ok?: boolean; result?: unknown; error?: { code?: string } }
      if (parsed.ok === false) return { ok: false, error: parsed.error?.code ?? 'cli error' }
      return { ok: true, json: parsed.result ?? parsed }
    } catch (error) {
      const e = error as { killed?: boolean; signal?: string; code?: unknown; message?: string }
      if (e.killed || e.signal === 'SIGTERM') return { ok: false, error: 'timeout' }
      return { ok: false, error: typeof e.code === 'string' ? e.code : 'failed' }
    }
  }
}
