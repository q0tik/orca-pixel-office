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

export type DispatchRow = { dispatchId: string; terminal: string | null; workspace: string | null; state: string | null; outcome: string | null; liveness: string | null }

/** `orca orchestration worker-list`: only the fields the CTO allowed. */
export function parseWorkerList(json: unknown): Map<string, DispatchRow> {
  const out = new Map<string, DispatchRow>()
  const workers = isObj(json) && Array.isArray(json.workers) ? json.workers : []
  for (const w of workers) {
    if (!isObj(w) || !str(w.dispatchId)) continue
    out.set(w.dispatchId as string, {
      dispatchId: w.dispatchId as string,
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
  /** Not a bot of this office (another computer, Orca itself, an unknown dispatch): the entrance. */
  | { kind: 'outside'; address: string }

export type Directory = {
  /** Bot key by bot name as `worktree ps` spells it (`[CTO] Ада`). */
  botKeys: Map<string, string>
  ps: Map<string, PsRow>
  dispatches: Map<string, DispatchRow>
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

/** `dispatch:ctx_x` or `ctx_x` → its dispatch id. */
function dispatchOf(address: string): string | null {
  const m = /^(?:dispatch:)?(ctx_[A-Za-z0-9]+)$/.exec(address)
  return m ? m[1] : null
}

const runOf = (address: string) => /^run:(run_[A-Za-z0-9]+)$/.exec(address)?.[1] ?? null

/**
 * Who coordinates each Run, learned from the mail itself: a dispatch belongs to the Run that mails
 * it (`run:R → dispatch:D`) or that it reports to (`D → run:R`), and its coordinator is whoever
 * else mails that dispatch from a bot chat or a terminal.
 */
export function learnRuns(rows: readonly InboxRow[], dispatches: Map<string, DispatchRow>): Map<string, string> {
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
  const out = new Map<string, string>()
  for (const [dispatch, run] of runOfDispatch) {
    const coordinator = coordOfDispatch.get(dispatch)
    if (coordinator && !out.has(run)) out.set(run, coordinator)
  }
  return out
}

/** Places a mail address in the office: a bot's desk, one of its interns, or outside. */
export function resolve(address: string, dir: Directory, runs: Map<string, string>, depth = 0): Party {
  const byAddress = addressIndex(dir.ps)
  const direct = partyOfWorkspace(byAddress.get(address), dir)
  if (direct) return direct
  const dispatch = dispatchOf(address)
  if (dispatch) {
    const d = dir.dispatches.get(dispatch)
    const viaTerminal = d?.terminal ? partyOfWorkspace(byAddress.get(d.terminal), dir) : null
    if (viaTerminal) return viaTerminal
    const viaWorkspace = d?.workspace ? partyOfWorkspace(dir.ps.get(d.workspace), dir) : null
    if (viaWorkspace) return viaWorkspace
  }
  const run = runOf(address)
  if (run && depth === 0) {
    const coordinator = runs.get(run)
    if (coordinator) return resolve(coordinator, dir, runs, 1)
  }
  return { kind: 'outside', address }
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
  private dir: Directory = { botKeys: new Map(), ps: new Map(), dispatches: new Map() }
  private dirAt = -Infinity
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
      return { id, at, type: row.type, subject: row.subject, from: resolve(row.from, this.dir, runs), to: resolve(row.to, this.dir, runs) }
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

  /** Workspaces and dispatches: when stale, or when an address in the mail is unknown. */
  private async refreshDirectory(rows: readonly InboxRow[]): Promise<void> {
    this.dir.botKeys = this.botKeys()
    const runs = learnRuns(rows, this.dir.dispatches)
    const unknown = rows.some((row) => resolve(row.from, this.dir, runs).kind === 'outside' || resolve(row.to, this.dir, runs).kind === 'outside')
    const age = this.clock.now() - this.dirAt
    if (age < DIRECTORY_MAX_AGE_MS && !(unknown && age >= MAIL_POLL_MS)) return
    this.dirAt = this.clock.now()
    const ps = await this.run({ kind: 'worktree-ps' })
    if (ps.ok) this.dir.ps = this.parsePs(ps.json)
    const workers = await this.run({ kind: 'worker-list' })
    if (workers.ok) this.dir.dispatches = parseWorkerList(workers.json)
  }
}
