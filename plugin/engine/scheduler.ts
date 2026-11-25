// When to draw. The view is drawn only after something changed (a dirty flag, one frame for any
// number of changes), and the only clock is one ~12 Hz animation timer that runs while something
// actually moves (a bot walking, a bot working at its keyboard, a waiting bot's bubble) and stops
// by itself when nothing does. There is no requestAnimationFrame loop.

export const TICK_MS = 83 // ≈ 12 Hz

export type Clock = {
  requestFrame(callback: () => void): unknown
  setInterval(callback: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

export class Scheduler {
  private framePending = false
  private timer: unknown = null
  /** How many frames were drawn (tests, debug). */
  renders = 0
  /** How many timer ticks ran (tests, debug). */
  ticks = 0

  constructor(
    private readonly clock: Clock,
    private readonly draw: () => void,
    /** Advances animations by one tick; returns whether the picture changed. */
    private readonly step: () => boolean,
    /** Whether anything still animates. */
    private readonly animating: () => boolean
  ) {}

  /** Something changed: draw once, on the next frame. */
  invalidate(): void {
    if (this.framePending) return
    this.framePending = true
    this.clock.requestFrame(() => {
      this.framePending = false
      this.renders += 1
      this.draw()
    })
  }

  /** Starts the animation timer if anything animates (and it is not running yet). */
  wake(): void {
    if (this.timer !== null || !this.animating()) return
    this.timer = this.clock.setInterval(() => this.tick(), TICK_MS)
  }

  get running(): boolean {
    return this.timer !== null
  }

  private tick(): void {
    this.ticks += 1
    if (this.step()) this.invalidate()
    if (!this.animating()) this.stop()
  }

  stop(): void {
    if (this.timer === null) return
    this.clock.clearInterval(this.timer)
    this.timer = null
  }
}

/** Static layers are cached in square chunks of this many tiles; only visible chunks are drawn. */
export const CHUNK_TILES = 16

export type ChunkKey = `${number},${number}`

/** The chunks a world rectangle (art pixels) touches, clipped to the building. */
export function visibleChunks(
  rect: { x: number; y: number; w: number; h: number },
  world: { width: number; height: number },
  tile: number
): { cx: number; cy: number }[] {
  const size = CHUNK_TILES * tile
  const maxX = Math.ceil(world.width / CHUNK_TILES) - 1
  const maxY = Math.ceil(world.height / CHUNK_TILES) - 1
  const x0 = Math.max(0, Math.floor(rect.x / size))
  const y0 = Math.max(0, Math.floor(rect.y / size))
  const x1 = Math.min(maxX, Math.floor((rect.x + rect.w - 1e-6) / size))
  const y1 = Math.min(maxY, Math.floor((rect.y + rect.h - 1e-6) / size))
  const out: { cx: number; cy: number }[] = []
  for (let cy = y0; cy <= y1; cy += 1) for (let cx = x0; cx <= x1; cx += 1) out.push({ cx, cy })
  return out
}

/** Whether a sprite's box (art pixels) can be seen: everything else is skipped while drawing. */
export function intersects(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}
