// The camera: where the view looks (a point of the world in art pixels) and how big one art pixel
// is on screen (a whole number of device pixels, so pixels stay square and sharp). Pure math; the
// editor feeds it wheel, drag, pinch and button input.

export type Camera = {
  /** World point (art pixels) at the centre of the view. */
  x: number
  y: number
  /** Device pixels per art pixel: a whole number. */
  zoom: number
}

export type Viewport = { width: number; height: number }
export type WorldSize = { width: number; height: number }

export const MIN_ZOOM = 1
export const MAX_ZOOM = 12
/** Art pixels of floor the camera may show past the building's edge. */
export const MARGIN = 24

export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(zoom)))
}

/** Keeps the building on screen: centred on an axis it fits, otherwise no further than the margin. */
export function clampCamera(camera: Camera, view: Viewport, world: WorldSize): Camera {
  const zoom = clampZoom(camera.zoom)
  const axis = (center: number, viewSize: number, worldSize: number) => {
    const half = viewSize / zoom / 2
    const span = worldSize + MARGIN * 2
    if (half * 2 >= span) return worldSize / 2
    return Math.max(half - MARGIN, Math.min(worldSize + MARGIN - half, center))
  }
  return { zoom, x: axis(camera.x, view.width, world.width), y: axis(camera.y, view.height, world.height) }
}

/** The biggest whole zoom that shows the whole building (and its margin), centred. */
export function fitCamera(view: Viewport, world: WorldSize): Camera {
  const zoom = clampZoom(
    Math.floor(Math.min(view.width / (world.width + MARGIN * 2), view.height / (world.height + MARGIN * 2)))
  )
  return clampCamera({ x: world.width / 2, y: world.height / 2, zoom }, view, world)
}

/** Moves the view by a screen distance in device pixels (drag right → the world moves right). */
export function panBy(camera: Camera, dx: number, dy: number, view: Viewport, world: WorldSize): Camera {
  return clampCamera({ ...camera, x: camera.x - dx / camera.zoom, y: camera.y - dy / camera.zoom }, view, world)
}

/** Screen origin of the world: where art pixel (0,0) lands, rounded to a device pixel. */
export function origin(camera: Camera, view: Viewport): { x: number; y: number } {
  return {
    x: Math.round(view.width / 2 - camera.x * camera.zoom),
    y: Math.round(view.height / 2 - camera.y * camera.zoom)
  }
}

export function screenToWorld(camera: Camera, view: Viewport, sx: number, sy: number): { x: number; y: number } {
  const o = origin(camera, view)
  return { x: (sx - o.x) / camera.zoom, y: (sy - o.y) / camera.zoom }
}

/**
 * Changes the zoom keeping the world point under the screen point `(sx, sy)` where it is. A series
 * of zoom steps passes the `anchor` it started from: near the edges the bounds move the camera, and
 * re-reading the point after each step would drift away from what the person pointed at.
 */
export function zoomAt(
  camera: Camera,
  zoom: number,
  sx: number,
  sy: number,
  view: Viewport,
  world: WorldSize,
  anchor?: { x: number; y: number }
): Camera {
  const next = clampZoom(zoom)
  if (next === camera.zoom) return clampCamera(camera, view, world)
  const point = anchor ?? screenToWorld(camera, view, sx, sy)
  return clampCamera(
    { zoom: next, x: point.x - (sx - view.width / 2) / next, y: point.y - (sy - view.height / 2) / next },
    view,
    world
  )
}

/** The world rectangle (art pixels) the view shows. */
export function visibleRect(camera: Camera, view: Viewport): { x: number; y: number; w: number; h: number } {
  const o = origin(camera, view)
  return { x: -o.x / camera.zoom, y: -o.y / camera.zoom, w: view.width / camera.zoom, h: view.height / camera.zoom }
}

/**
 * Turns a stream of small wheel/pinch deltas into whole zoom steps: a trackpad pinch sends many
 * tiny events, a mouse wheel few big ones; both should feel like one step per notch.
 */
export class ZoomAccumulator {
  private sum = 0
  constructor(private readonly threshold = 60) {}
  /** Returns -1, 0 or +1 zoom steps for this delta (negative delta = zoom in, as browsers send). */
  push(deltaY: number): number {
    this.sum += deltaY
    if (this.sum <= -this.threshold) {
      this.sum = 0
      return 1
    }
    if (this.sum >= this.threshold) {
      this.sum = 0
      return -1
    }
    return 0
  }
  reset(): void {
    this.sum = 0
  }
}
