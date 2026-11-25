// Real interactions between bots, from `orca orchestration inbox` (every mailbox on this Orca,
// newest first). Only metadata is kept: id, from, to, type and the subject clipped to 80
// characters. The body and the payload are dropped while parsing and never stored. Orca's
// concise inbox has no time, so an entry's time is when the office first saw it; mail that was
// there before the tab opened is listed as «до открытия» and never animated.
import type { CliRequest, RunResult } from './cli'
import { clip, type PsRow } from './extras'

export const SUBJECT_MAX = 80
export const JOURNAL_MAX = 50
export const MAIL_POLL_MS = 15_000
export const MAIL_DEBOUNCE_MS = 2_000
/** A tab that asked within this long counts as open. */
export const MAIL_TAB_ALIVE_MS = 60_000
/** Workspaces and dispatches are re-read at most this often (or when an address is unknown). */
export const DIRECTORY_MAX_AGE_MS = 30_000
/** The bots' chat ids (`orca bot chats`): every 10 minutes, or after a minute for an unknown chat. */
export const CHATS_MAX_AGE_MS = 10 * 60_000
export const CHATS_RETRY_MS = 60_000
/** A Run's tasks (`task-list --run`): at most this many Runs per read, each asked again after 10 minutes. */
export const RUNS_PER_READ = 3
export const RUN_RETRY_MS = 10 * 60_000

/** Kinds of mail that are interactions; heartbeats are keep-alive noise and are skipped. */
const SKIP_TYPES = new Set(['heartbeat'])

export type InboxRow = { id: string; from: string; to: string; type: string; subject: string }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

/** Metadata only: the body (and its preview) and the payload are never copied out. */
export function parseInbox(json: unknown): InboxRow[] {
  const messages = isObj(json) && Array.isArray(json.messages) ? json.messages : []
  const out: InboxRow[] = []
  for (const message of messages) {
    if (!isObj(message)) continue
    const id = str(message.id)
    const from = str(message.from)
    const to = str(message.to)
    const type = str(message.type)
    if (!id || !from || !to || !type || SKIP_TYPES.has(type)) continue
    out.push({ id, from, to, type, subject: clip(str(message.subject) ?? '', SUBJECT_MAX) })
  }
  return out
}

export type DispatchRow = {
  dispatchId: string
  /** The task it works: ties a Run (`task-list --run`) to the bot whose worker took it. */
  taskId: string | null
  terminal: string | null
  workspace: string | null
  state: string | null
  outcome: string | null
  liveness: string | null
}

/** `orca orchestration worker-list`: only the fields the CTO allowed. */
export function parseWorkerList(json: unknown): Map<string, DispatchRow> {
  const out = new Map<string, DispatchRow>()
  const workers = isObj(json) && Array.isArray(json.workers) ? json.workers : []
  for (const w of workers) {
    if (!isObj(w) || !str(w.dispatchId)) continue
    out.set(w.dispatchId as string, {
      dispatchId: w.dispatchId as string,
      taskId: str(w.taskId),
      terminal: str(w.terminal),
      workspace: str(w.workspace),
      state: str(w.state),
      outcome: str(w.outcome),
      liveness: typeof w.liveness === 'string' ? w.liveness : null
    })
  }
  return out
}

/** Where a mail end is in the office. */
export type Party =
  | { kind: 'bot'; key: string }
  | { kind: 'intern'; key: string; workerId: string }
  /** The owner: Orca says the owner did it (an item the owner changed). Drawn at the CEO's desk. */
  | { kind: 'owner'; address: string }
  /** Orca's own notice that is not the owner's doing: a journal line, no envelope, no line. */
  | { kind: 'system'; address: string }
  /** Not a bot of this office (another computer, an unknown address): the entrance, with a «?». */
  | { kind: 'outside'; address: string }

export type Directory = {
  /** Bot key by bot name as `worktree ps` spells it (`[CTO] Кто-то`). */
  botKeys: Map<string, string>
  ps: Map<string, PsRow>
  dispatches: Map<string, DispatchRow>
  /** Chat id (an `orca_session_id`) → bot name, from `orca bot chats` of every bot in the office. */
  chats: Map<string, string>
  /** Run id → task ids, from `orca orchestration task-list --run`. */
  runTasks: Map<string, string[]>
}

export const emptyDirectory = (): Directory => ({ botKeys: new Map(), ps: new Map(), dispatches: new Map(), chats: new Map(), runTasks: new Map() })

/** `orca bot chats`: the chat ids only (titles and what was said are never read here). */
export function parseChatIds(json: unknown): string[] {
  const chats = isObj(json) && Array.isArray(json.chats) ? json.chats : []
  return chats.filter(isObj).map((c) => str(c.id)).filter((id): id is string => id !== null)
}

/** `orca orchestration task-list --run`: the task ids only (titles are never read here). */
export function parseTaskIds(json: unknown): string[] {
  const tasks = isObj(json) && Array.isArray(json.tasks) ? json.tasks : []
  return tasks.filter(isObj).map((t) => str(t.id)).filter((id): id is string => id !== null)
}

/**
 * Orca's own senders (`orca:items`…). Orca has no field for who did it: only the subject it
 * writes, «Your owner updated (item …)» for the owner and «Your other chat …» for the bot's own
 * other chat. The first is the owner (the CEO's office); anything else from Orca is a notice.
 */
export const OWNER_SUBJECT = /^Your owner\b/

export function orcaParty(address: string, subject: string): Party | null {
  if (!address.startsWith('orca:')) return null
  return OWNER_SUBJECT.test(subject) ? { kind: 'owner', address } : { kind: 'system', address }
}

/** Address (`orca_session_id:…`, `term_…`) → the workspace whose agent has it. */
function addressIndex(ps: Map<string, PsRow>): Map<string, PsRow> {
  const out = new Map<string, PsRow>()
  for (const row of ps.values()) for (const address of row.addresses) out.set(address, row)
  return out
}

function partyOfWorkspace(row: PsRow | undefined, dir: Directory): Party | null {
  if (!row?.bot) return null
  const key = dir.botKeys.get(row.bot)
  if (!key) return null
  return row.home ? { kind: 'bot', key } : { kind: 'intern', key, workerId: row.id }
}

const SESSION = 'orca_session_id:'

/** A dispatch's worker: its workspace in `worktree ps`, else the agent's terminal there. */
function partyOfDispatch(d: DispatchRow | undefined, dir: Directory, byAddress: Map<string, PsRow>): Party | null {
  if (!d) return null
  return (d.terminal ? partyOfWorkspace(byAddress.get(d.terminal), dir) : null) ?? (d.workspace ? partyOfWorkspace(dir.ps.get(d.workspace), dir) : null)
}

/** The bot a Run belongs to: the one whose workers took its tasks (all of them name one bot). */
function botOfRun(run: string, dir: Directory, byAddress: Map<string, PsRow>, viaMail: Set<string>): Party | null {
  const tasks = new Set(dir.runTasks.get(run) ?? [])
  const keys = new Set<string>()
  for (const d of dir.dispatches.values()) {
    if (!(d.taskId && tasks.has(d.taskId)) && !viaMail.has(d.dispatchId)) continue
    const party = partyOfDispatch(d, dir, byAddress)
    if (party && 'key' in party) keys.add(party.key)
  }
  return keys.size === 1 ? { kind: 'bot', key: [...keys][0] } : null
}

/** `dispatch:ctx_x` or `ctx_x` → its dispatch id. */
function dispatchOf(address: string): string | null {
  const m = /^(?:dispatch:)?(ctx_[A-Za-z0-9]+)$/.exec(address)
  return m ? m[1] : null
}

const runOf = (address: string) => /^run:(run_[A-Za-z0-9]+)$/.exec(address)?.[1] ?? null

/**
 * Who coordinates each Run, learned from the mail itself: a dispatch belongs to the Run that mails
 * it (`run:R → dispatch:D`) or that it reports to (`D → run:R`, D also by its terminal, a
 * structured worker's `structworker_…` included), and its coordinator is whoever else mails that
 * dispatch from a bot chat or a terminal.
 */
export function learnRuns(rows: readonly InboxRow[], dispatches: Map<string, DispatchRow>): Runs {
  const terminalToDispatch = new Map<string, string>()
  for (const d of dispatches.values()) if (d.terminal) terminalToDispatch.set(d.terminal, d.dispatchId)
  const runOfDispatch = new Map<string, string>()
  const coordOfDispatch = new Map<string, string>()
  const senderDispatch = (address: string) => dispatchOf(address) ?? terminalToDispatch.get(address) ?? null
  for (const row of rows) {
    const toRun = runOf(row.to)
    const fromRun = runOf(row.from)
    const toDispatch = dispatchOf(row.to)
    const fromDispatch = senderDispatch(row.from)
    if (toRun && fromDispatch) runOfDispatch.set(fromDispatch, toRun)
    if (fromRun && toDispatch) runOfDispatch.set(toDispatch, fromRun)
    if (toDispatch && !fromRun && !dispatchOf(row.from) && !coordOfDispatch.has(toDispatch)) coordOfDispatch.set(toDispatch, row.from)
  }
  const out: Runs = new Map()
  for (const [dispatch, run] of runOfDispatch) {
    const entry = out.get(run) ?? { coordinator: null, dispatches: new Set<string>() }
    entry.dispatches.add(dispatch)
    entry.coordinator ??= coordOfDispatch.get(dispatch) ?? null
    out.set(run, entry)
  }
  return out
}

/** Per Run seen in the mail: who mails its workers (when seen) and the dispatches that belong to it. */
export type Runs = Map<string, { coordinator: string | null; dispatches: Set<string> }>

/**
 * Places a mail address in the office: a bot's desk (any of its chats), one of its workers, the
 * bot a Run belongs to, or outside. Orca's own senders are placed per message (`placeRow`).
 */
export function resolve(address: string, dir: Directory, runs: Runs = new Map(), depth = 0): Party {
  const byAddress = addressIndex(dir.ps)
  const direct = partyOfWorkspace(byAddress.get(address), dir)
  if (direct) return direct
  // A chat of a bot that `worktree ps` does not list now (closed, or not live): `orca bot chats`.
  if (address.startsWith(SESSION)) {
    const key = dir.botKeys.get(dir.chats.get(address.slice(SESSION.length)) ?? '')
    if (key) return { kind: 'bot', key }
  }
  const dispatch = dispatchOf(address)
  if (dispatch) {
    const viaDispatch = partyOfDispatch(dir.dispatches.get(dispatch), dir, byAddress)
    if (viaDispatch) return viaDispatch
  }
  // A worker's terminal that is gone from `worktree ps` (a released or structured worker): its
  // dispatch still names the workspace, and the workspace names the bot.
  if (/^(term|structworker)_/.test(address)) {
    for (const d of dir.dispatches.values()) {
      if (d.terminal !== address) continue
      const viaTerminal = partyOfDispatch(d, dir, byAddress)
      if (viaTerminal) return viaTerminal
    }
  }
  const run = runOf(address)
  if (run && depth === 0) {
    const learned = runs.get(run)
    const coordinator = learned?.coordinator ? resolve(learned.coordinator, dir, runs, 1) : null
    if (coordinator && coordinator.kind !== 'outside') return coordinator
    const owner = botOfRun(run, dir, byAddress, learned?.dispatches ?? new Set())
    if (owner) return owner
  }
  return { kind: 'outside', address }
}

/** Both ends of one message: Orca's own notices by their subject, everything else by address. */
export function placeRow(row: InboxRow, dir: Directory, runs: Runs): { from: Party; to: Party } {
  return {
    from: orcaParty(row.from, row.subject) ?? resolve(row.from, dir, runs),
    to: row.to.startsWith('orca:') ? { kind: 'system', address: row.to } : resolve(row.to, dir, runs)
  }
}

export type MailEntry = {
  id: string
  /** When the office first saw it (ms); null: it was there before the tab opened. */
  at: number | null
  type: string
  subject: string
  from: Party
  to: Party
}

export type Mail = { entries: MailEntry[]; error: string | null; at: number }

export type MailClock = { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void }

/**
 * Reads the inbox at most every 15 s while a tab asks, and after agent events with a debounce;
 * never without an open tab. Each message id is taken once; the newest 50 are kept.
 */
export class MailSource {
  private seen = new Map<string, { row: InboxRow; at: number | null }>()
  private order: string[] = []
  private first = true
  private lastRead = -Infinity
  private lastAsked = -Infinity
  private reading: Promise<Mail> | null = null
  private debounce: unknown = null
  private dir: Directory = emptyDirectory()
  private dirAt = -Infinity
  private chatsAt = -Infinity
  /** When `task-list --run` was last asked per Run (an answer is kept: a Run's tasks stay its own). */
  private runAsked = new Map<string, number>()
  private error: string | null = null
  reads = 0

  constructor(
    private readonly run: (request: CliRequest) => Promise<RunResult>,
    private readonly botKeys: () => Map<string, string>,
    private readonly parsePs: (json: unknown) => Map<string, PsRow>,
    private readonly clock: MailClock,
    private readonly onFresh: (mail: Mail) => void
  ) {}

  async ask(): Promise<Mail> {
    this.lastAsked = this.clock.now()
    if (this.clock.now() - this.lastRead < MAIL_POLL_MS) return this.reading ?? this.current()
    return this.read()
  }

  poke(): void {
    if (this.clock.now() - this.lastAsked > MAIL_TAB_ALIVE_MS) return
    if (this.debounce !== null) this.clock.clearTimeout(this.debounce)
    this.debounce = this.clock.setTimeout(() => {
      this.debounce = null
      if (this.clock.now() - this.lastRead < MAIL_POLL_MS) return
      void this.read().then((mail) => this.onFresh(mail))
    }, MAIL_DEBOUNCE_MS)
  }

  current(): Mail {
    const runs = learnRuns(
      this.order.map((id) => this.seen.get(id)!.row),
      this.dir.dispatches
    )
    const entries = this.order.slice(0, JOURNAL_MAX).map((id) => {
      const { row, at } = this.seen.get(id)!
      return { id, at, type: row.type, subject: row.subject, ...placeRow(row, this.dir, runs) }
    })
    return { entries, error: this.error, at: this.lastRead === -Infinity ? 0 : this.lastRead }
  }

  private read(): Promise<Mail> {
    this.reading ??= this.readNow().finally(() => {
      this.reading = null
    })
    return this.reading
  }

  private async readNow(): Promise<Mail> {
    this.lastRead = this.clock.now()
    this.reads += 1
    const inbox = await this.run({ kind: 'inbox' })
    if (!inbox.ok) {
      this.error = inbox.error
      return this.current()
    }
    this.error = null
    const rows = parseInbox(inbox.json)
    const now = this.clock.now()
    // Newest first from the CLI: walk oldest → newest so the order stays newest first.
    for (const row of [...rows].reverse()) {
      if (this.seen.has(row.id)) continue
      this.seen.set(row.id, { row, at: this.first ? null : now })
      this.order.unshift(row.id)
    }
    this.first = false
    for (const id of this.order.splice(JOURNAL_MAX * 2)) this.seen.delete(id)
    await this.refreshDirectory(rows)
    return this.current()
  }

  /**
   * Workspaces and dispatches: when stale, or when an address in the mail is unknown. Then, only
   * for what is still unknown: the bots' chat ids (a chat `worktree ps` does not list) and the
   * tasks of a Run nobody in the mail coordinates. Both are cached; neither is read per tick.
   */
  private async refreshDirectory(rows: readonly InboxRow[]): Promise<void> {
    this.dir.botKeys = this.botKeys()
    const unknown = () => {
      const runs = learnRuns(rows, this.dir.dispatches)
      const out = new Set<string>()
      for (const row of rows) {
        const { from, to } = placeRow(row, this.dir, runs)
        if (from.kind === 'outside') out.add(from.address)
        if (to.kind === 'outside') out.add(to.address)
      }
      return out
    }
    const now = this.clock.now()
    const age = now - this.dirAt
    if (age >= DIRECTORY_MAX_AGE_MS || (unknown().size > 0 && age >= MAIL_POLL_MS)) {
      this.dirAt = now
      const ps = await this.run({ kind: 'worktree-ps' })
      if (ps.ok) this.dir.ps = this.parsePs(ps.json)
      const workers = await this.run({ kind: 'worker-list' })
      if (workers.ok) this.dir.dispatches = parseWorkerList(workers.json)
    }
    const left = unknown()
    const chatsAge = now - this.chatsAt
    if (chatsAge >= CHATS_MAX_AGE_MS || ([...left].some((a) => a.startsWith(SESSION)) && chatsAge >= CHATS_RETRY_MS)) {
      this.chatsAt = now
      const chats = new Map<string, string>()
      for (const name of this.dir.botKeys.keys()) {
        const answer = await this.run({ kind: 'bot-chats', bot: name })
        if (answer.ok) for (const id of parseChatIds(answer.json)) chats.set(id, name)
      }
      this.dir.chats = chats
    }
    let asked = 0
    for (const address of unknown()) {
      const run = runOf(address)
      if (!run || asked >= RUNS_PER_READ) continue
      if (now - (this.runAsked.get(run) ?? -Infinity) < RUN_RETRY_MS) continue
      this.runAsked.set(run, now)
      asked += 1
      const answer = await this.run({ kind: 'run-tasks', run })
      if (answer.ok) this.dir.runTasks.set(run, parseTaskIds(answer.json))
    }
  }
}
