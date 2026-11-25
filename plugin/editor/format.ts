// Small text helpers for the tooltip and the HUD.

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds} сек`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `${hours} ч ${minutes % 60} мин` : `${hours} ч`
  return `${Math.floor(hours / 24)} д`
}

/** The Russian plural: 1 сотрудник, 2 сотрудника, 5 сотрудников. */
export function plural(n: number, one: string, few: string, many: string): string {
  const d = n % 10
  const h = n % 100
  if (d === 1 && h !== 11) return one
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few
  return many
}

/** «3 сотрудника» by a bot's desk: its live workers. */
export function employees(n: number): string {
  return `${n} ${plural(n, 'сотрудник', 'сотрудника', 'сотрудников')}`
}

/** «2 стажёра» by a worker's desk: its live subagents. */
export function trainees(n: number): string {
  return `${n} ${plural(n, 'стажёр', 'стажёра', 'стажёров')}`
}

/** «1 работает», «2 работают», «5 работают». */
export function working(n: number): string {
  const tail = n % 10 === 1 && n % 100 !== 11 ? 'работает' : 'работают'
  return `${n} ${tail}`
}
