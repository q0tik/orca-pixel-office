// How mail reads on screen: Russian names of Orca message types, what an unknown address is, and
// what the pointer is over (an envelope, a line), for the tooltip and the legend.

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

/** What kind of address the office could not place (for «адрес не опознан: …»). */
export function addressKind(address: string): string {
  if (address.startsWith('run:')) return 'Run без координатора в последних письмах'
  if (/^(dispatch:)?ctx_/.test(address)) return 'сотрудник не из этого офиса'
  if (address.startsWith('orca:')) return 'сама Orca'
  if (address.startsWith('term_')) return 'терминал не из этого офиса'
  if (address.startsWith('orca_session_id:')) return 'чат не из этого офиса'
  return 'другое'
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
