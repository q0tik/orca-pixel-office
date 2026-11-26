// The trusted worker: the only place that can see every bot. It lists the bots' folder
// workspaces (`workspace.list`), reads each one's agents (`agents.list({ workspaceId })`), keeps
// their states current from `agent.status.changed`, and posts the desks to open office tabs.
// No timers: everything is driven by events, editor requests and the open command.
import { mkdir, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import { nodeExec, OrcaCli } from './cli'
import { ExtrasSource, FinishTracker, parseCurrentChat, parseWorktreePs, readExtras, type ChatAnswer } from './extras'
import { MailSource } from './mail'
import {
  botKey,
  countNeedsYou,
  countWorking,
  isAgentState,
  isBotWorkspace,
  makeDesk,
  sortDesks,
  type AgentEntry,
  type AgentState,
  type Desk,
  type WorkspaceRow
} from './bots'
import type { Office, OfficeDebug } from './protocol'

export const STATUS_ITEM = 'working'
export const OFFICE_DIR = '.pixel-office'
export const OFFICE_FILE = 'office.pixel'
const OFFICE_TEXT =
  'Pixel Office: this file opens the bots\' office in Orca (plugin pixel-office). Its text is not used.\n'

type StatusEvent = {
  workspaceId: string | null
  workspaceListId?: string
  paneKey: string
  terminalId?: string
  sessionId?: string
  state: AgentState
  receivedAt: number
  mainAgent?: { state: AgentState; stateStartedAt: number; outcome?: string }
}

type ListedAgent = { state: string; stateStartedAt: number; sessionId?: string | null; terminalId?: string | null; agent?: string | null }

declare const process: { env: Record<string, string | undefined> }

export function createOffice(orca: OrcaWorkerApi, cli: OrcaCli = new OrcaCli(nodeExec, process.env, (line) => orca.log(line))) {
  /** Bot workspaces by `workspace.list` id. */
  let bots = new Map<string, WorkspaceRow>()
  /** Every other workspace id seen, so an event from one does not trigger a re-scan. */
  let others = new Set<string>()
  /** Every workspace row of the last scan (workers' workspaces included), for `office.openWorker`. */
  let allRows: WorkspaceRow[] = []
  /** Per bot: agent sessions by session id (or pane key when an event has no session id). */
  const agents = new Map<string, Map<string, AgentEntry>>()
  let events = 0
  let lastEvent: OfficeDebug['lastEvent'] = null
  let scanning: Promise<void> | null = null
  let scanned = false

  function desks(): Desk[] {
    return sortDesks(
      [...bots.values()].map((row) => makeDesk(row, [...(agents.get(row.id)?.values() ?? [])]))
    )
  }

  function office(): Office {
    return { desks: desks(), at: Date.now() }
  }

  /**
   * A bot's chats as Orca lists them now, by session id (else terminal id). This snapshot is the truth:
   * a chat it does not list is gone, whatever an earlier event said. Null when the read failed.
   */
  async function readAgentsOrNull(row: WorkspaceRow): Promise<Map<string, AgentEntry> | null> {
    const entries = new Map<string, AgentEntry>()
    try {
      const answer = (await orca.host.call('agents.list', { workspaceId: row.id })) as {
        agents: ListedAgent[]
      }
      answer.agents.forEach((agent, index) => {
        if (!isAgentState(agent.state)) return
        entries.set(agent.sessionId ?? (agent.terminalId ? `t:${agent.terminalId}` : `#${index}`), {
          state: agent.state,
          since: agent.stateStartedAt,
          agent: agent.agent ?? null
        })
      })
      return entries
    } catch (error) {
      orca.log(`agents.list ${row.id} failed: ${(error as Error).message}`)
      return null
    }
  }

  async function readAgents(row: WorkspaceRow): Promise<Map<string, AgentEntry>> {
    return (await readAgentsOrNull(row)) ?? new Map()
  }

  /** A fresh snapshot replaces what events built up; a turn that failed stays marked. */
  function replaceAgents(id: string, fresh: Map<string, AgentEntry>): void {
    const before = agents.get(id)
    for (const [key, entry] of fresh) {
      const old = before?.get(key)
      if (old?.failed && old.state === entry.state) entry.failed = true
    }
    agents.set(id, fresh)
  }

  /**
   * Every bot's chats read again (while an office tab is open, with its workers and items, every 30 s),
   * so a stale «working» from an event whose «done» never came cannot stay. Posts only on a change.
   */
  async function refreshAgents(): Promise<void> {
    if (!scanned) return
    const before = JSON.stringify(desks().map((d) => [d.key, d.state, d.sessions]))
    const rows = [...bots.values()]
    const lists = await Promise.all(rows.map((row) => readAgentsOrNull(row)))
    rows.forEach((row, i) => {
      const fresh = lists[i]
      if (fresh) replaceAgents(row.id, fresh)
    })
    if (JSON.stringify(desks().map((d) => [d.key, d.state, d.sessions])) !== before) await publish()
  }

  async function scanNow(): Promise<void> {
    const answer = (await orca.host.call('workspace.list')) as { workspaces: WorkspaceRow[] }
    const nextBots = new Map<string, WorkspaceRow>()
    const nextOthers = new Set<string>()
    for (const row of answer.workspaces) {
      if (isBotWorkspace(row)) nextBots.set(row.id, row)
      else nextOthers.add(row.id)
    }
    const lists = await Promise.all([...nextBots.values()].map((row) => readAgents(row)))
    bots = nextBots
    others = nextOthers
    allRows = answer.workspaces
    scanned = true
    agents.clear()
    ;[...nextBots.keys()].forEach((id, index) => agents.set(id, lists[index]))
  }

  /** One scan at a time; callers during a scan share it. */
  function scan(): Promise<void> {
    scanning ??= scanNow().finally(() => {
      scanning = null
    })
    return scanning
  }

  /** The first scan only: after it, events keep the desks current. */
  function ready(): Promise<void> {
    return scanned ? Promise.resolve() : scan()
  }

  /** When workers stopped, as this process saw it (survives the office tab being opened again). */
  const finished = new FinishTracker()

  const extras = new ExtrasSource(
    async () => {
      await ready()
      const refs = [...bots.values()].map((row) => ({ key: botKey(row), name: row.name, workspaceId: row.id }))
      const fresh = await readExtras((request) => cli.run(request), refs, await cli.source())
      // Workers that stopped since the last read get the moment they stopped (they stay pale 10 min).
      for (const bot of Object.values(fresh.bots)) if (bot.interns) bot.interns = finished.stamp(bot.interns, Date.now())
      return fresh
    },
    { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
    (fresh) => orca.panels.post('office.extras', fresh)
  )

  const mail = new MailSource(
    (request) => cli.run(request),
    () => new Map([...bots.values()].map((row) => [row.name, botKey(row)])),
    parseWorktreePs,
    { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
    (fresh) => orca.panels.post('office.mail', fresh)
  )

  function botByKey(key: string): WorkspaceRow | undefined {
    return [...bots.values()].find((row) => botKey(row) === key)
  }

  /** Only for the bot whose panel is open; the answer goes to that tab and nowhere else. */
  async function chat(key: string): Promise<ChatAnswer> {
    const row = botByKey(key)
    if (!row) return { ok: false, reason: 'бот не найден' }
    const result = await cli.run({ kind: 'bot-chats', bot: row.name })
    return result.ok ? parseCurrentChat(result.json) : { ok: false, reason: result.error === 'timeout' ? 'CLI не ответил' : 'нет данных' }
  }

  /** A worker's workspace by its `worktree ps` id (`<repo>::<path>`): matched to `workspace.list` by path. */
  async function openWorker(id: string): Promise<{ opened: boolean; reason?: string }> {
    await ready()
    const path = id.includes('::') ? id.slice(id.indexOf('::') + 2) : null
    const row = allRows.find((r) => r.id === id || (path !== null && r.path === path))
    if (!row) return { opened: false, reason: 'воркспейс не найден' }
    try {
      await orca.host.call('workspace.open', { workspaceId: row.id })
      return { opened: true }
    } catch (error) {
      return { opened: false, reason: (error as { code?: string }).code ?? 'action_failed' }
    }
  }

  async function openBot(key: string): Promise<{ opened: boolean; reason?: string }> {
    const row = botByKey(key)
    if (!row) return { opened: false, reason: 'бот не найден' }
    try {
      await orca.host.call('workspace.open', { workspaceId: row.id })
      return { opened: true }
    } catch (error) {
      return { opened: false, reason: (error as { code?: string }).code ?? 'action_failed' }
    }
  }

  async function publish(): Promise<void> {
    const current = office()
    orca.panels.post('office.desks', current)
    await updateStatusBar(current.desks)
  }

  async function updateStatusBar(list: readonly Desk[]): Promise<void> {
    const working = countWorking(list)
    const needsYou = countNeedsYou(list)
    const text = needsYou > 0 ? `🟢 ${working} · 🟡 ${needsYou} ждут` : `🟢 ${working} ${working === 1 ? 'работает' : 'работают'}`
    const tooltip =
      list.length === 0
        ? 'Pixel Office: ботов не видно'
        : `Pixel Office: ${list.map((desk) => `${desk.name} — ${desk.state}`).join(', ')}`
    try {
      await orca.host.call('statusBar.update', {
        id: STATUS_ITEM,
        text,
        tone: needsYou > 0 ? 'warning' : working > 0 ? 'success' : 'neutral',
        tooltip
      })
    } catch (error) {
      orca.log(`statusBar.update failed: ${(error as Error).message}`)
    }
  }

  async function onStatus(payload: StatusEvent): Promise<void> {
    events += 1
    // Any agent change (a bot's chat or one of its workers) may change workers and items.
    extras.poke()
    mail.poke()
    const id = payload.workspaceListId ?? payload.workspaceId
    lastEvent = { workspaceId: id, state: payload.state, at: payload.receivedAt }
    if (!id || others.has(id)) return
    if (!bots.has(id)) {
      // An id we have never seen: maybe a bot made after the last scan.
      await scan()
      if (!bots.has(id)) return
    }
    // The bot's chats as Orca lists them now: chats that are gone or done drop out of «working».
    const fresh = await readAgentsOrNull(bots.get(id)!)
    if (fresh) replaceAgents(id, fresh)
    const sessions = agents.get(id) ?? new Map<string, AgentEntry>()
    agents.set(id, sessions)
    // The event's own chat: by session id, else terminal id, else the only chat the bot has.
    let key: string | null = payload.sessionId && sessions.has(payload.sessionId) ? payload.sessionId : null
    if (!key && payload.terminalId && sessions.has(`t:${payload.terminalId}`)) key = `t:${payload.terminalId}`
    if (!key && sessions.size === 1) key = [...sessions.keys()][0]
    // A chat the snapshot does not know yet (just started): shown now; the next snapshot keeps or drops it.
    if (!key) key = payload.sessionId ?? payload.paneKey
    const before = sessions.get(key)
    const since =
      before && before.state === payload.state
        ? before.since
        : payload.mainAgent && payload.mainAgent.state === payload.state
          ? payload.mainAgent.stateStartedAt
          : payload.receivedAt
    sessions.set(key, { state: payload.state, since, agent: before?.agent ?? null, failed: payload.mainAgent?.outcome === 'failure' })
    await publish()
  }

  async function rescanAndPublish(): Promise<void> {
    await scan()
    await publish()
  }

  /** Where the office file lives: a git-ignored folder in a local workspace. */
  async function officeTarget(): Promise<{ workspaceId: string; path: string } | null> {
    const context = (await orca.host.call('workspace.readContext')) as {
      workspaceId?: string
    } | null
    const answer = (await orca.host.call('workspace.list')) as { workspaces: WorkspaceRow[] }
    // The focused workspace (a bot's home included); the office file is local, so only local ones.
    const local = answer.workspaces.filter((row) => row.hostId === 'local' || row.hostId === null)
    const focusedId = context?.workspaceId
    const focusedPath = focusedId?.includes('::') ? focusedId.slice(focusedId.indexOf('::') + 2) : null
    const row =
      local.find((candidate) => candidate.id === focusedId) ??
      local.find((candidate) => focusedPath !== null && candidate.path === focusedPath) ??
      local.find((candidate) => candidate.kind === 'worktree') ??
      local[0]
    if (!row) return null
    return { workspaceId: row.id, path: row.path }
  }

  async function open(): Promise<string> {
    const target = await officeTarget()
    if (!target) return 'Pixel Office: нет локального воркспейса, куда положить office.pixel'
    const dir = join(target.path, OFFICE_DIR)
    const file = join(dir, OFFICE_FILE)
    await mkdir(dir, { recursive: true })
    // The folder ignores itself, so the office file never shows up in git status.
    await writeFile(join(dir, '.gitignore'), '*\n')
    try {
      await access(file)
    } catch {
      await writeFile(file, OFFICE_TEXT)
    }
    await orca.host.call('editor.open', {
      workspaceId: target.workspaceId,
      path: `${OFFICE_DIR}/${OFFICE_FILE}`
    })
    return 'Pixel Office открыт'
  }

  function debug(): OfficeDebug {
    return {
      bots: [...bots.values()].map((row) => ({
        id: row.id,
        name: row.name,
        path: row.path,
        hostId: row.hostId,
        agents: agents.get(row.id)?.size ?? 0
      })),
      skipped: others.size,
      events,
      lastEvent
    }
  }

  return {
    scan,
    ready,
    publish,
    office,
    onStatus,
    refreshAgents,
    rescanAndPublish,
    open,
    debug,
    extras,
    mail,
    chat,
    openBot,
    openWorker,
    known: (id: string) => bots.has(id) || others.has(id)
  }
}

export default function activate(orca: OrcaWorkerApi): void {
  const office = createOffice(orca)

  orca.panels.handle('office.desks', async () => {
    await office.ready()
    return office.office()
  })
  orca.panels.handle('office.debug', () => office.debug())
  // The palette command's code path, callable with `orca plugin dev request . office.open`.
  orca.panels.handle('office.open', () => office.open())
  // The tab asks for workers and items every 30 s: the bots' chats are read again then too.
  orca.panels.handle('office.extras', async () => {
    await office.refreshAgents()
    return office.extras.ask()
  })
  orca.panels.handle('office.mail', async () => {
    await office.ready()
    return office.mail.ask()
  })
  orca.panels.handle('office.chat', (input) => office.chat(String((input as { key?: unknown })?.key ?? '')))
  orca.panels.handle('office.openBot', (input) => office.openBot(String((input as { key?: unknown })?.key ?? '')))
  orca.panels.handle('office.openWorker', (input) => office.openWorker(String((input as { id?: unknown })?.id ?? '')))

  orca.commands.register('pixel-office.open', () => office.open())

  orca.events.on('agent.status.changed', (payload) => office.onStatus(payload as StatusEvent))
  orca.events.on('workspace.created', async () => {
    await office.rescanAndPublish()
    office.extras.poke()
    office.mail.poke()
  })
  orca.events.on('workspace.removed', async () => {
    await office.rescanAndPublish()
    office.extras.poke()
    office.mail.poke()
  })
  orca.events.on('workspace.changed', async (payload) => {
    // Focus moves fire this often; only an unknown workspace can mean a new bot.
    const id = payload.context?.workspaceId
    if (id && !office.known(id) && !id.includes('::')) await office.rescanAndPublish()
  })

  // The worker runs while the plugin is enabled (it owns a status bar item): fill it once.
  void office.rescanAndPublish().catch((error: Error) => orca.log(`first scan failed: ${error.message}`))
}
