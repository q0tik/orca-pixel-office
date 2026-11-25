// «Следить»: the camera glides to where the latest real event happened. Off by default; any input
// of the owner (wheel, drag, zoom, keys, buttons) turns it off at once.
import { clampCamera, type Camera, type Viewport, type WorldSize } from './camera'

/** Share of the remaining way the camera covers per animation tick. */
export const FOLLOW_EASE = 0.2

export class Follow {
  on = false
  target: { x: number; y: number } | null = null

  toggle(): boolean {
    this.on = !this.on
    if (!this.on) this.target = null
    return this.on
  }

  /** The owner moved the camera themself: following stops. */
  interrupt(): boolean {
    const was = this.on
    this.on = false
    this.target = null
    return was
  }

  /** A real event at this world point (art pixels). Ignored while off. */
  event(point: { x: number; y: number }): void {
    if (this.on) this.target = point
  }

  /** Whether the camera is still on its way. */
  moving(): boolean {
    return this.on && this.target !== null
  }

  /** One tick: the camera a step closer, or null when there is nothing to do (and it arrived). */
  step(camera: Camera, view: Viewport, world: WorldSize): Camera | null {
    if (!this.on || !this.target) return null
    const goal = clampCamera({ ...camera, x: this.target.x, y: this.target.y }, view, world)
    const dx = goal.x - camera.x
    const dy = goal.y - camera.y
    if (Math.abs(dx) * camera.zoom < 1 && Math.abs(dy) * camera.zoom < 1) {
      this.target = null
      return goal.x === camera.x && goal.y === camera.y ? null : goal
    }
    return { ...camera, x: camera.x + dx * FOLLOW_EASE, y: camera.y + dy * FOLLOW_EASE }
  }
}
