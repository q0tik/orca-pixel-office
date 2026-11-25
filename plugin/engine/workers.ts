// Workers (a bot's dispatched worktrees, its «сотрудники») live in «Команды и отделы»: each takes a
// desk of its own there, the same one after a reload (the mapping is kept in the plugin storage).
// A working worker sits at its desk; a finished one turns pale and leaves after WORKER_LINGER_MS,
// freeing the desk; a released or removed one leaves at once. All from real CLI data.
import type { InternState } from '../src/extras'
import type { Bubble, Target } from './locations'
import type { DeskSeat } from './world'

export const WORKER_LINGER_MS = 10 * 60_000
export const WORKER_DESKS_KEY = 'workerDesks'
/** The room workers sit in on the shipped map; any room of kind `team` takes workers (isWorkerDesk). */
export const WORKER_ROOM = 'teams'
/** A desk for workers: one in a room of kind `team` («Команды и отделы», or several such rooms). */
export const isWorkerDesk = (desk: { roomKind: string }): boolean => desk.roomKind === 'team'

export type WorkerInfo = {
  id: string
  name: string
  /** The bot that dispatched it. */
  parentKey: string
  agent: string | null
  state: InternState
  live: boolean
  /** When it entered its state (ms), or null when Orca did not say. */
  since: number | null
  /** Its subagents running now («стажёры»), from `worktree ps`. */
  subagents?: { id: string; type: string | null; state: string }[]
}

/**
 * Which workers are in the office now: live ones, and finished ones for WORKER_LINGER_MS after
 * they finished (from `since`, else from when the office first saw them finished).
 */
export function presentWorkers(workers: readonly WorkerInfo[], now: number, firstSeenDone: Map<string, number>): WorkerInfo[] {
  const out: WorkerInfo[] = []
  const current = new Set(workers.map((w) => w.id))
  for (const id of [...firstSeenDone.keys()]) if (!current.has(id)) firstSeenDone.delete(id)
  for (const w of workers) {
    if (w.live) {
      firstSeenDone.delete(w.id)
      out.push(w)
      continue
    }
    if (!firstSeenDone.has(w.id)) firstSeenDone.set(w.id, now)
    const doneAt = w.since ?? firstSeenDone.get(w.id)!
    if (now - doneAt < WORKER_LINGER_MS) out.push(w)
  }
  return out
}

/** Keeps a stored mapping only if it is a plain { workerId: deskId } object. */
export function parseWorkerDesks(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === 'string') out[k] = v
  return out
}

/**
 * A desk per worker among `desks` (the free desks of the workers' room). The owner's pins come
 * first; then a worker keeps its stored desk while that desk is free; new ones take the first free
 * desk in map order. Those left without a desk are the overflow («+N»). The returned mapping is
 * what to store (current only); pins stay in their own key.
 */
export function assignWorkerDesks(
  workers: readonly { id: string }[],
  desks: readonly DeskSeat[],
  stored: Record<string, string>,
  pinned: Readonly<Record<string, string>> = {}
): { seats: Map<string, DeskSeat>; overflow: string[]; stored: Record<string, string> } {
  const byId = new Map(desks.map((d) => [d.id, d]))
  const taken = new Set<string>()
  const seats = new Map<string, DeskSeat>()
  for (const w of workers) {
    const desk = byId.get(pinned[w.id] ?? '')
    if (desk && !taken.has(desk.id)) {
      seats.set(w.id, desk)
      taken.add(desk.id)
    }
  }
  for (const w of workers) {
    if (seats.has(w.id)) continue
    const desk = byId.get(stored[w.id] ?? '')
    if (desk && !taken.has(desk.id)) {
      seats.set(w.id, desk)
      taken.add(desk.id)
    }
  }
  const overflow: string[] = []
  for (const w of workers) {
    if (seats.has(w.id)) continue
    const desk = desks.find((d) => !taken.has(d.id))
    if (!desk) {
      overflow.push(w.id)
      continue
    }
    seats.set(w.id, desk)
    taken.add(desk.id)
  }
  const next: Record<string, string> = {}
  for (const [id, desk] of seats) next[id] = desk.id
  return { seats, overflow, stored: next }
}

export const workerKey = (id: string) => `w:${id}`

/** At its desk: typing while live, still (and pale) once finished; «!» while blocked or waiting. */
export function workerTarget(worker: WorkerInfo, desk: DeskSeat): Target {
  const bubble: Bubble = worker.state === 'blocked' ? 'blocked' : worker.state === 'waiting' ? 'waiting' : null
  return { place: 'desk', x: desk.seat.x, y: desk.seat.y, facing: desk.facing, pose: 'type', bubble, slot: `desk:${desk.id}`, still: !worker.live }
}

/**
 * Desk labels that stay different: the prefix shared by the workers' names (cut at a «-», «_» or
 * «/») is dropped, and what is still too long is cut from the start, «…office-poc», never the end.
 */
export function workerLabels(names: readonly string[], max = 10): Map<string, string> {
  const out = new Map<string, string>()
  const unique = [...new Set(names)]
  let prefix = ''
  if (unique.length > 1) {
    let common = unique[0]
    for (const n of unique) while (!n.startsWith(common)) common = common.slice(0, -1)
    const cut = Math.max(common.lastIndexOf('-'), common.lastIndexOf('_'), common.lastIndexOf('/'))
    prefix = cut >= 0 ? common.slice(0, cut + 1) : ''
  }
  for (const name of unique) {
    let label = prefix && name.length > prefix.length ? name.slice(prefix.length) : name
    if ([...label].length > max) label = `…${[...label].slice(-(max - 1)).join('')}`
    out.set(name, label)
  }
  return out
}
