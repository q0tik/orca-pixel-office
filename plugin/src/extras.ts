// What the office shows beyond the bots' own chats, read from Orca's CLI (src/cli.ts): each bot's
// workers («сотрудники»; their subagents are «стажёры»), its items by status (Needs you first) and, only for an open panel, its
// current chat. Parsing is pure and works on whatever the CLI answered: a missing or odd field
// becomes «no data», never a guess.
import type { CliRequest, RunResult } from './cli'

export type InternState = 'working' | 'blocked' | 'waiting' | 'done' | 'idle' | 'unknown'

/** One workspace a bot dispatched (its worker). */
export type Intern = {
  id: string
  name: string
  /** Agent kind (`claude`, `codex`…) from `worktree ps`; null when it does not say. */
  agent: string | null
  state: InternState
  /** An agent there is busy or waiting right now. */
  live: boolean
  /** When its agent entered `state` (ms), from `worktree ps`; null when unknown. */
  since: number | null
  /** Its agents' subagents («стажёры»): running, or finished less than 10 minutes ago (pale). */
  subagents: Subagent[]
  /** Orca observes its agents' subagents (`subagentObservation: live`); else nothing is known of them. */
  subagentsObserved?: boolean
}

/**
 * A subagent an agent runs inside its session («стажёр»): only what `orca worktree ps` says of it, in
 * `agents[].children` — its kind, state, type and description; no transcripts, no hooks.
 */
export type Subagent = {
  id: string
  /** What it does: its description, else its type, else its name. */
  label: string
  type: string | null
  model: string | null
  /** The tool it is using now (`operation.toolName`), when Orca saw one. */
  tool: string | null
  state: InternState
  /** Working, blocked or waiting. */
  live: boolean
  startedAt: number | null
  /** When it finished (its last observation once done, or when the plugin saw it stop); null while it runs. */
  endedAt: number | null
}

/** How long a finished trainee stays (pale) by its desk. */
export const TRAINEE_LINGER_MS = 10 * 60_000

/**
 * An agent's subagents from `worktree ps` (`children`), only while Orca observes them live
 * (`subagentObservation: live`): anything else and there are none — nothing is made up. A child is a
 * trainee while it works, waits or is blocked; a done one is kept with the time it finished.
 */
export function parseChildren(agent: Record<string, unknown>): Subagent[] {
  if (agent.subagentObservation !== 'live' || !Array.isArray(agent.children)) return []
  return agent.children.filter(isObj).flatMap((c): Subagent[] => {
    const id = str(c.id)
    if (!id || (c.kind !== undefined && c.kind !== 'agent')) return []
    const state = AGENT_STATES[String(c.state)] ?? 'unknown'
    const live = isLive(state)
    if (!live && state !== 'done') return []
    const observedAt = typeof c.observedAt === 'number' ? c.observedAt : null
    return [
      {
        id,
        label: str(c.description) ?? str(c.agentType) ?? str(c.name) ?? 'субагент',
        type: str(c.agentType) ?? str(c.name),
        model: str(c.model),
        tool: isObj(c.operation) ? str(c.operation.toolName) : null,
        state,
        live,
        startedAt: typeof c.firstObservedAt === 'number' ? c.firstObservedAt : null,
        endedAt: live ? null : observedAt
      }
    ]
  })
}

/**
 * When trainees finished, as the plugin saw it: one seen working that is now done without a time, or
 * gone from the list, finished at that moment. A finished trainee stays (pale) TRAINEE_LINGER_MS from
 * when it finished, then leaves; one never seen working and with no time is not shown.
 */
export class SubagentTracker {
  private readonly seen = new Map<string, Subagent>()
  private readonly ended = new Map<string, Subagent & { endedAt: number }>()

  stamp(owner: string, list: readonly Subagent[], now: number): Subagent[] {
    const mine = (k: string) => k.startsWith(`${owner}#`)
    const out: Subagent[] = []
    const present = new Set<string>()
    for (const s of list) {
      const k = `${owner}#${s.id}`
      present.add(k)
      if (s.live) {
        this.seen.set(k, s)
        this.ended.delete(k)
        out.push(s)
        continue
      }
      const endedAt = s.endedAt ?? this.ended.get(k)?.endedAt ?? (this.seen.has(k) ? now : null)
      this.seen.delete(k)
      if (endedAt === null) continue
      this.ended.set(k, { ...s, endedAt })
      if (now - endedAt < TRAINEE_LINGER_MS) out.push({ ...s, endedAt })
    }
    for (const [k, s] of [...this.seen]) {
      if (!mine(k) || present.has(k)) continue
      this.seen.delete(k)
      this.ended.set(k, { ...s, state: 'done', live: false, tool: null, endedAt: now })
    }
    for (const [k, s] of [...this.ended]) {
      if (!mine(k) || present.has(k)) continue
      if (now - s.endedAt >= TRAINEE_LINGER_MS) this.ended.delete(k)
      else out.push(s)
    }
    return out
  }
}

export type Items = {
  /** By status as Orca names them: `needs_you`, `in_progress`, `planned`, `done`, `canceled`. */
  counts: Record<string, number>
  needsYou: number
  /** Titles of the items in Needs you (titles only, never comments), at most 5. */
  needsYouTitles: string[]
}

export type BotExtras = {
  /** The bot's name as the CLI knows it (`[CTO] Ада`). */
  name: string
  /** From `orca bot list`, when it lists the bot. */
  botId: string | null
  agent: string | null
  /** Null: the CLI did not answer (no data), [] — no workers. */
  interns: Intern[] | null
  items: Items | null
  /** The subagents of the bot's own chats (all of them), «стажёры бота»; null when unknown. */
  trainees?: Subagent[] | null
  /** Orca observes the subagents of at least one of the bot's chats. */
  traineesObserved?: boolean
}

export type Extras = {
  /** When these were read (ms since epoch); 0 when never. */
  at: number
  /** The CLI binary used, or null when there is none. */
  source: string | null
  /** Why some data is missing (timeout, CLI not found), null when everything answered. */
  error: string | null
  /** By bot key (`cto`, `seller`…). */
  bots: Record<string, BotExtras>
}

/** The bot's current chat for its panel: never stored or logged. */
export type ChatAnswer =
  | { ok: true; title: string; lastSaid: string; at: number | null; chats: number }
  | { ok: false; reason: string }

export const LAST_SAID_MAX = 280
export const TITLE_MAX = 120

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

/** `orca bot list`: name → id and agent. */
export function parseBotList(json: unknown): Map<string, { id: string | null; agent: string | null }> {
  const out = new Map<string, { id: string | null; agent: string | null }>()
  const bots = isObj(json) && Array.isArray(json.bots) ? json.bots : []
  for (const bot of bots) {
    if (!isObj(bot) || !str(bot.name)) continue
    out.set(bot.name as string, { id: str(bot.id), agent: str(bot.agent) })
  }
  return out
}

const AGENT_STATES: Record<string, InternState> = { working: 'working', blocked: 'blocked', waiting: 'waiting', done: 'done', idle: 'idle' }
const URGENT: InternState[] = ['blocked', 'waiting', 'working', 'done', 'idle', 'unknown']

export type PsRow = {
  id: string
  name: string
  bot: string | null
  parent: string | null
  agent: string | null
  state: InternState
  /** The bot's own home, not a worker. */
  home: boolean
  /** Mail addresses of its agents (`orca_session_id:…`, `term_…`). */
  addresses: string[]
  /** When the chosen agent entered its state (ms), or null. */
  since: number | null
  /** Subagents of its agents (`children`), only those Orca observes. */
  subagents: Subagent[]
  /** At least one of its agents has its subagents observed live. */
  subagentsObserved: boolean
}

/** `orca worktree ps`: per workspace, whose worker it is and its most urgent agent. */
export function parseWorktreePs(json: unknown): Map<string, PsRow> {
  const out = new Map<string, PsRow>()
  const rows = isObj(json) && Array.isArray(json.worktrees) ? json.worktrees : []
  for (const row of rows) {
    if (!isObj(row) || !str(row.worktreeId)) continue
    const agents = Array.isArray(row.agents) ? row.agents.filter(isObj) : []
    let state: InternState = agents.length ? 'unknown' : 'idle'
    let agent: string | null = null
    let since: number | null = null
    for (const a of agents) {
      const s = AGENT_STATES[String(a.state)] ?? 'unknown'
      if (URGENT.indexOf(s) < URGENT.indexOf(state) || (s === state && since === null)) {
        state = s
        since = typeof a.stateStartedAt === 'number' ? a.stateStartedAt : null
      }
      agent ??= str(a.agentType)
    }
    const parent = isObj(row.parent) ? str(row.parent.selector) : null
    const path = str(row.path) ?? ''
    out.set(row.worktreeId as string, {
      id: row.worktreeId as string,
      name: str(row.displayName) ?? path.split('/').filter(Boolean).pop() ?? (row.worktreeId as string),
      bot: str(row.bot),
      parent,
      agent,
      state,
      home: row.botHome === true,
      since,
      addresses: agents.map((a) => str(a.address)).filter((a): a is string => a !== null),
      subagents: agents.flatMap((a) => parseChildren(a)),
      subagentsObserved: agents.some((a) => a.subagentObservation === 'live')
    })
  }
  return out
}

/**
 * A bot's workers: the ones `orca bot work list` names, joined with `worktree ps` for the agent
 * and its state, plus any `worktree ps` row that names this bot (or its workspace as parent).
 */
export function parseInterns(work: unknown, ps: Map<string, PsRow> | null, botName: string, botWorkspaceId: string): Intern[] {
  const out = new Map<string, Intern>()
  const listed = isObj(work) && Array.isArray(work.workspaces) ? work.workspaces : []
  for (const w of listed) {
    if (!isObj(w) || !str(w.id)) continue
    const id = w.id as string
    const row = ps?.get(id)
    if (id === botWorkspaceId || row?.home) continue
    // `bot work list` says «agent working» / «agent idle»; `worktree ps` knows the agent itself.
    const fromWork = /\b(working|blocked|waiting|done|idle)\b/.exec(String(w.agent ?? ''))?.[1] as InternState | undefined
    const state: InternState = row?.state ?? fromWork ?? 'unknown'
    out.set(id, { id, name: str(w.name) ?? row?.name ?? id, agent: row?.agent ?? null, state, live: isLive(state), since: row?.since ?? null, subagents: row?.subagents ?? [], subagentsObserved: row?.subagentsObserved ?? false })
  }
  for (const row of ps?.values() ?? []) {
    if (out.has(row.id) || row.home || row.id === botWorkspaceId) continue
    if (row.bot !== botName && row.parent !== botWorkspaceId) continue
    out.set(row.id, { id: row.id, name: row.name, agent: row.agent, state: row.state, live: isLive(row.state), since: row.since, subagents: row.subagents, subagentsObserved: row.subagentsObserved })
  }
  return [...out.values()].sort((a, b) => Number(b.live) - Number(a.live) || a.name.localeCompare(b.name))
}

/** Workspaces whose every dispatch in `orchestration worker-list` was released. */
export function releasedWorkspaces(json: unknown): Set<string> {
  const byWorkspace = new Map<string, boolean>()
  const workers = isObj(json) && Array.isArray(json.workers) ? json.workers.filter(isObj) : []
  for (const w of workers) {
    const ws = str(w.workspace)
    if (!ws) continue
    const isReleased = w.terminalState === 'released'
    byWorkspace.set(ws, (byWorkspace.get(ws) ?? true) && isReleased)
  }
  return new Set([...byWorkspace].filter(([, all]) => all).map(([ws]) => ws))
}

/**
 * When workers finished, as the plugin saw it. Orca gives the time for a worker whose agent is done;
 * one whose agent has gone (a dispatch that succeeded) has none. The plugin's worker process remembers
 * the workers it saw working, and when one stops it stamps that moment as `since`: the tab keeps it pale
 * for ten minutes from then, however often the office is opened again. A worker never seen working gets
 * no time and stays out of the office.
 */
export class FinishTracker {
  private readonly liveSeen = new Set<string>()
  private readonly finishedAt = new Map<string, number>()

  stamp(interns: Intern[], now: number): Intern[] {
    return interns.map((i) => {
      if (i.live) {
        this.liveSeen.add(i.id)
        this.finishedAt.delete(i.id)
        return i
      }
      if (this.liveSeen.has(i.id) && !this.finishedAt.has(i.id)) this.finishedAt.set(i.id, now)
      const seen = this.finishedAt.get(i.id)
      return i.since === null && seen !== undefined ? { ...i, since: seen } : i
    })
  }
}

export function isLive(state: InternState): boolean {
  return state === 'working' || state === 'blocked' || state === 'waiting'
}

/** `orca bot item list`: counts by status and the titles in Needs you; comments are never read. */
export function parseItems(json: unknown): Items | null {
  if (!isObj(json)) return null
  const counts: Record<string, number> = {}
  if (isObj(json.counts)) {
    for (const [status, n] of Object.entries(json.counts)) if (typeof n === 'number' && n >= 0) counts[status] = n
  }
  const items = Array.isArray(json.items) ? json.items.filter(isObj) : []
  if (!isObj(json.counts) && !Array.isArray(json.items)) return null
  const needsYouTitles = items
    .filter((item) => item.status === 'needs_you')
    .map((item) => str(item.title))
    .filter((t): t is string => t !== null)
    .slice(0, 5)
    .map((t) => clip(t, TITLE_MAX))
  return { counts, needsYou: counts.needs_you ?? 0, needsYouTitles }
}

/** `orca bot chats`: the open chat with the latest activity, its title and last answer clipped. */
export function parseCurrentChat(json: unknown): ChatAnswer {
  const chats = isObj(json) && Array.isArray(json.chats) ? json.chats.filter(isObj) : null
  if (!chats) return { ok: false, reason: 'нет данных' }
  const open = chats.filter((chat) => chat.closed !== true)
  if (open.length === 0) return { ok: false, reason: 'нет открытых чатов' }
  const time = (chat: Obj) => (typeof chat.lastActivityAt === 'number' ? chat.lastActivityAt : 0)
  const current = open.reduce((best, chat) => (time(chat) > time(best) ? chat : best))
  return {
    ok: true,
    title: clip(str(current.title) ?? 'без названия', TITLE_MAX),
    lastSaid: str(current.lastSaid) ? clip(current.lastSaid as string, LAST_SAID_MAX) : '',
    at: typeof current.lastActivityAt === 'number' ? current.lastActivityAt : null,
    chats: open.length
  }
}

export type BotRef = { key: string; name: string; workspaceId: string }

/** Reads everything for the given bots; a failing call leaves that part null («нет данных»). */
export async function readExtras(run: (request: CliRequest) => Promise<RunResult>, bots: readonly BotRef[], source: string | null): Promise<Extras> {
  const errors = new Set<string>()
  const take = (result: RunResult) => {
    if (result.ok) return result.json
    errors.add(result.error)
    return null
  }
  const list = take(await run({ kind: 'bot-list' }))
  const psJson = take(await run({ kind: 'worktree-ps' }))
  const workerList = take(await run({ kind: 'worker-list' }))
  const released = workerList === null ? new Set<string>() : releasedWorkspaces(workerList)
  const ps = psJson === null ? null : parseWorktreePs(psJson)
  const known = list === null ? null : parseBotList(list)
  const out: Extras = { at: Date.now(), source, error: null, bots: {} }
  for (const bot of bots) {
    const work = take(await run({ kind: 'bot-work', bot: bot.name }))
    const items = take(await run({ kind: 'bot-items', bot: bot.name }))
    const listed = known?.get(bot.name)
    out.bots[bot.key] = {
      name: bot.name,
      botId: listed?.id ?? null,
      agent: listed?.agent ?? null,
      // A worker whose dispatches were all released (worker-release) and has no live agent is gone.
      interns: work === null ? null : parseInterns(work, ps, bot.name, bot.workspaceId).filter((i) => i.live || !released.has(i.id)),
      items: items === null ? null : parseItems(items),
      // The bot's own chats (its home: one row, an agent per chat): their subagents, summed.
      trainees: ps === null ? null : [...ps.values()].filter((r) => r.home && r.bot === bot.name).flatMap((r) => r.subagents),
      traineesObserved: ps !== null && [...ps.values()].some((r) => r.home && r.bot === bot.name && r.subagentsObserved)
    }
  }
  out.error = errors.size ? [...errors].join(', ') : null
  return out
}

export const POLL_MIN_MS = 30_000
export const EVENT_DEBOUNCE_MS = 3_000
export const EVENT_MIN_GAP_MS = 10_000
/** A tab that asked within this long counts as open. */
export const TAB_ALIVE_MS = 75_000

export type Clock = { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void }

/**
 * When to read: a tab asks at most every 30 s (it reads the cache otherwise); an agent event
 * re-reads after a 3 s debounce, at most every 10 s, and only while a tab is open. Reads never
 * overlap. Nothing runs while no tab is open.
 */
export class ExtrasSource {
  private cache: Extras = { at: 0, source: null, error: null, bots: {} }
  private reading: Promise<Extras> | null = null
  private lastAsked = -Infinity
  private debounce: unknown = null
  reads = 0

  constructor(
    private readonly read: () => Promise<Extras>,
    private readonly clock: Clock,
    private readonly onFresh: (extras: Extras) => void
  ) {}

  current(): Extras {
    return this.cache
  }

  /** A tab asks: the cache if it is fresh, else a new read. */
  async ask(): Promise<Extras> {
    this.lastAsked = this.clock.now()
    if (this.clock.now() - this.cache.at < POLL_MIN_MS) return this.reading ?? this.cache
    return this.refresh()
  }

  /** Something changed in Orca: re-read soon, if a tab is open. */
  poke(): void {
    if (this.clock.now() - this.lastAsked > TAB_ALIVE_MS) return
    if (this.debounce !== null) this.clock.clearTimeout(this.debounce)
    this.debounce = this.clock.setTimeout(() => {
      this.debounce = null
      if (this.clock.now() - this.cache.at < EVENT_MIN_GAP_MS) return
      void this.refresh().then((extras) => this.onFresh(extras))
    }, EVENT_DEBOUNCE_MS)
  }

  private refresh(): Promise<Extras> {
    this.reading ??= this.read()
      .then((extras) => {
        this.reads += 1
        this.cache = extras
        return extras
      })
      .catch(() => this.cache)
      .finally(() => {
        this.reading = null
      })
    return this.reading
  }
}
