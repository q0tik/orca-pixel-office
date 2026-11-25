// How mail reads on screen: Russian names of Orca message types, where each end of a letter is
// drawn, what an unknown address is, and what the pointer is over (an envelope, a line), for the
// tooltip and the legend.
import type { Party } from '../src/mail'

export const TYPE_RU: Record<string, string> = {
  handoff: 'передача',
  question: 'вопрос',
  status: 'статус',
  worker_done: 'готово',
  escalation: 'эскалация',
  decision: 'решение'
}

export function typeName(type: string): string {
  return TYPE_RU[type] ?? type
}

/**
 * Where an end of a letter is drawn: a bot or one of its workers, the CEO's office for the owner,
 * the entrance for an outside or unknown address. Null for Orca's own notices that are not the
 * owner's doing: they are a journal line only, with no envelope and no line on the map.
 */
export function endRef(party: Party): string | null {
  if (party.kind === 'bot') return `bot:${party.key}`
  if (party.kind === 'intern') return `intern:${party.key}:${party.workerId}`
  if (party.kind === 'owner') return 'owner'
  if (party.kind === 'system') return null
  return 'outside'
}

/** What kind of address the office could not place (for «адрес не опознан: …»). */
export function addressKind(address: string): string {
  if (address.startsWith('run:')) return 'Run, чьи задачи не взял ни один бот этого офиса'
  if (/^(dispatch:)?ctx_/.test(address)) return 'сотрудник не из этого офиса'
  if (address.startsWith('orca:')) return 'сама Orca'
  if (/^(term|structworker)_/.test(address)) return 'терминал не из этого офиса'
  if (address.startsWith('orca_session_id:')) return 'чат не из этого офиса'
  if (/^(ssh|runtime):/.test(address)) return 'другой компьютер'
  return 'внешний адрес'
}

type Pt = { x: number; y: number }

export function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** The nearest item within `tolerance` (art pixels) of the point, or -1. */
export function hitSegment(segments: readonly { a: Pt; b: Pt }[], p: Pt, tolerance: number): number {
  let best = -1
  let bestD = tolerance
  segments.forEach((s, i) => {
    const d = distanceToSegment(p, s.a, s.b)
    if (d <= bestD) {
      best = i
      bestD = d
    }
  })
  return best
}

export function hitPoint(points: readonly Pt[], p: Pt, tolerance: number): number {
  let best = -1
  let bestD = tolerance
  points.forEach((q, i) => {
    const d = Math.hypot(q.x - p.x, q.y - p.y)
    if (d <= bestD) {
      best = i
      bestD = d
    }
  })
  return best
}

/** «Ада → Грейс · вопрос · тема…», and why an end went to the entrance. */
export function mailTooltip(m: { from: string; to: string; type: string; subject: string; unknown: string[] }): string[] {
  const lines = [`${m.from} → ${m.to} · ${typeName(m.type)}`]
  if (m.subject) lines.push(m.subject)
  for (const address of m.unknown) lines.push(`адрес не опознан: ${addressKind(address)}`)
  return lines
}

export const LEGEND_TYPES = ['handoff', 'question', 'status', 'worker_done', 'escalation'] as const
