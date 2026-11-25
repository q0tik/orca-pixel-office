// Pure office logic shared by the worker and the tests: which workspaces are Orca bots, and what
// state each bot's desk shows. No host calls here.

export type AgentState = 'working' | 'blocked' | 'waiting' | 'done'
export type DeskState = AgentState | 'idle'

/** One row of `workspace.list` (only the fields the office reads). */
export type WorkspaceRow = {
  id: string
  kind: 'worktree' | 'folder'
  name: string
  path: string
  hostId: string | null
  project?: string | null
}

/** One agent session of a bot, as the worker last heard it. */
export type AgentEntry = {
  state: AgentState
  since: number
  /** Agent kind (`claude`, `codex`…) when `agents.list` named it. */
  agent?: string | null
  /** Its last turn ended with `outcome: failure` (from `agent.status.changed`; `agents.list` does not say). */
  failed?: boolean
}

/** What the editor draws for one bot. */
export type Desk = {
  /** The bot's folder workspace id from `workspace.list` (`folder:…`). */
  id: string
  /**
   * Stable key for office/seating.json: the bot's home folder name (`~/.orca/bots/<slug>`), with
   * the host in front for a bot on another machine (`ssh:devbox/<slug>`).
   */
  key: string
  /** Where the bot runs: `local`, `ssh:…`, `runtime:…`, or null (this machine). */
  hostId: string | null
  /** Agent kinds of its chats (`claude`, `codex`, `gemini`…), as Orca names them. */
  agents: string[]
  /** Display name without the `[role]` prefix, e.g. «Грейс». */
  name: string
  /** The `[role]` prefix without brackets, e.g. «CTO»; empty when the name has none. */
  role: string
  state: DeskState
  /** When the desk entered `state` (ms since epoch); null when unknown (an idle bot). */
  since: number | null
  /** How many agent sessions the bot has right now. */
  sessions: number
  /** A chat's last turn failed (Orca's `mainAgent.outcome: failure`); cleared by its next turn. */
  failed: boolean
}

/**
 * Orca keeps every bot's home in `~/.orca/bots/<slug>` and opens it as a folder workspace (that is
 * what `orca bot list` and the `bot`/`botHome` fields of `orca worktree ps` point at). Worktrees a
 * bot dispatched, project folders and any other folder workspace are not bots.
 */
const BOT_HOME = /[\\/]\.orca[\\/]bots[\\/][^\\/]+[\\/]?$/

export function isBotWorkspace(row: Pick<WorkspaceRow, 'kind' | 'path'>): boolean {
  return row.kind === 'folder' && BOT_HOME.test(row.path)
}

/** The bot's home folder name: the last part of `~/.orca/bots/<slug>`. */
export function botSlug(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function botKey(row: Pick<WorkspaceRow, 'path' | 'hostId'>): string {
  const slug = botSlug(row.path)
  return row.hostId && row.hostId !== 'local' ? `${row.hostId}/${slug}` : slug
}

export function splitBotName(name: string): { name: string; role: string } {
  const match = /^\s*\[([^\]]*)\]\s*(.*)$/.exec(name)
  if (!match) return { name: name.trim(), role: '' }
  const rest = match[2].trim()
  return rest ? { name: rest, role: match[1].trim() } : { name: name.trim(), role: '' }
}

/** Needs-you first, then busy, then resting: the desk shows the most urgent session. */
const PRIORITY: Record<AgentState, number> = { blocked: 0, waiting: 1, working: 2, done: 3 }

export function deskState(agents: readonly AgentEntry[]): { state: DeskState; since: number | null } {
  if (agents.length === 0) return { state: 'idle', since: null }
  let best = agents[0]
  for (const agent of agents) {
    const rank = PRIORITY[agent.state] - PRIORITY[best.state]
    // Same state: the earliest start is how long the bot has been in it.
    if (rank < 0 || (rank === 0 && agent.since < best.since)) best = agent
  }
  return { state: best.state, since: best.since }
}

export function makeDesk(row: WorkspaceRow, agents: readonly AgentEntry[]): Desk {
  const { name, role } = splitBotName(row.name)
  const kinds = [...new Set(agents.map((agent) => agent.agent).filter((kind): kind is string => !!kind))].sort()
  return {
    id: row.id,
    key: botKey(row),
    hostId: row.hostId,
    agents: kinds,
    name,
    role,
    ...deskState(agents),
    sessions: agents.length,
    failed: agents.some((agent) => agent.failed === true)
  }
}

/** Desks in a stable order: by display name, so a bot keeps its seat when states change. */
export function sortDesks(desks: Desk[]): Desk[] {
  return desks.sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id))
}

export function countWorking(desks: readonly Desk[]): number {
  return desks.filter((desk) => desk.state === 'working').length
}

export function countNeedsYou(desks: readonly Desk[]): number {
  return desks.filter((desk) => desk.state === 'blocked' || desk.state === 'waiting').length
}

export function isAgentState(value: unknown): value is AgentState {
  return value === 'working' || value === 'blocked' || value === 'waiting' || value === 'done'
}
