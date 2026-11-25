// The editor <-> worker contract, declared once: editor/main.ts and src/worker.ts both read it.
import type { Desk } from './bots'
import type { ChatAnswer, Extras } from './extras'
import type { Mail } from './mail'

export type Office = {
  desks: Desk[]
  /** When the worker built this answer (ms since epoch). */
  at: number
}

/** Hidden debug view only: what the worker matched, never shown by default. */
export type OfficeDebug = {
  bots: { id: string; name: string; path: string; hostId: string | null; agents: number }[]
  skipped: number
  events: number
  lastEvent: { workspaceId: string | null; state: string; at: number } | null
}

declare module 'orca' {
  interface PluginRequests {
    /** Re-reads the bots and answers every desk. */
    'office.desks': { output: Office }
    'office.debug': { output: OfficeDebug }
    /** Same as the «Open Pixel Office» command: creates the office file if needed and opens it. */
    'office.open': { output: string }
    /** Workers, items and bot ids from Orca's CLI; read at most every 30 s while a tab asks. */
    'office.extras': { output: Extras }
    /** The bot's current chat (title, last answer clipped) for its open panel; never stored. */
    'office.chat': { input: { key: string }; output: ChatAnswer }
    /** Shows the bot's home in Orca (`workspace.open`): the API cannot open one chat by id. */
    'office.openBot': { input: { key: string }; output: { opened: boolean; reason?: string } }
    /** Shows a worker's workspace in Orca (`workspace.open`), by its `worktree ps` id. */
    'office.openWorker': { input: { id: string }; output: { opened: boolean; reason?: string } }
    /** Mail between bots (metadata only), read at most every 15 s while a tab asks. */
    'office.mail': { output: Mail }
  }
  interface PluginPanelEvents {
    /** Posted whenever a desk changes: an agent event, a bot added or removed. */
    'office.desks': Office
    /** Posted after an event-driven re-read of the extras. */
    'office.extras': Extras
    /** Posted after an event-driven re-read of the mail. */
    'office.mail': Mail
  }
}
