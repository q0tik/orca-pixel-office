// Day and night from the owner's real clock: the sky in the windows, a tone over the office in the
// evening and at night, and from the evening on the lamps, candles and lit screens (engine/lights.ts). Checked at most once a minute by the
// tab's data timer; nothing else changes with the time.
import type { PaletteKey } from './palette'

export type Phase = 'morning' | 'day' | 'evening' | 'night'

/** 06:00–09:59 morning, 10:00–16:59 day, 17:00–21:59 evening, 22:00–05:59 night. */
export function phaseAt(hour: number): Phase {
  const h = ((Math.floor(hour) % 24) + 24) % 24
  if (h >= 6 && h < 10) return 'morning'
  if (h >= 10 && h < 17) return 'day'
  if (h >= 17 && h < 22) return 'evening'
  return 'night'
}

export type PhaseLook = {
  label: string
  /** Window colours for this phase. */
  sky: Partial<Record<PaletteKey, string>>
  /** A tone laid over the whole office, or null. */
  tint: { color: string; alpha: number } | null
  /** Lamps, candles, signs and lit screens shine (engine/lights.ts). */
  lamps: boolean
  /** With the lamps on: the dark the light map cuts its pools out of (instead of `tint`). */
  dark?: { color: string; alpha: number }
}

export const PHASES: Record<Phase, PhaseLook> = {
  morning: { label: 'утро', sky: { sky: '#f4c8a8', glass: '#d9b8c6', glassHi: '#fff1e2' }, tint: { color: '#ffb36b', alpha: 0.06 }, lamps: false },
  day: { label: 'день', sky: {}, tint: null, lamps: false },
  evening: { label: 'вечер', sky: { sky: '#e0855a', glass: '#7a5a8a', glassHi: '#ffd2a0' }, tint: { color: '#3a2050', alpha: 0.18 }, lamps: true, dark: { color: '#2a1a48', alpha: 0.3 } },
  night: { label: 'ночь', sky: { sky: '#141a3a', glass: '#1c2450', glassHi: '#f4f0c8' }, tint: { color: '#0a1030', alpha: 0.38 }, lamps: true, dark: { color: '#060a26', alpha: 0.6 } }
}

/** The phase now, at most once a minute: the same phase object until the minute passes. */
export class Daylight {
  private checkedAt = -Infinity
  phase: Phase

  constructor(private readonly hourNow: () => number, private readonly now: () => number) {
    this.phase = phaseAt(hourNow())
    this.checkedAt = now()
  }

  /** Returns true when the phase changed (the picture must be redrawn). */
  check(): boolean {
    if (this.now() - this.checkedAt < 60_000) return false
    this.checkedAt = this.now()
    const next = phaseAt(this.hourNow())
    if (next === this.phase) return false
    this.phase = next
    return true
  }

  get look(): PhaseLook {
    return PHASES[this.phase]
  }
}
