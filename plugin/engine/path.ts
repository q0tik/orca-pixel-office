// Breadth-first search over the tile grid: the shortest walk in steps of one tile, four ways.
import { STEPS, walkable, type World } from './world'

export type Point = { x: number; y: number }

/**
 * The tiles from `from` (excluded) to `to` (included), or null when there is no way. The goal may
 * be a seat (a sofa); the start may be anything, so a bot standing on a sofa can get up.
 */
export function findPath(world: World, from: Point, to: Point): Point[] | null {
  if (from.x === to.x && from.y === to.y) return []
  if (!walkable(world, to.x, to.y, true)) return null
  const width = world.width
  const goal = to.y * width + to.x
  const start = from.y * width + from.x
  const prev = new Int32Array(width * world.height).fill(-1)
  prev[start] = start
  const queue = new Int32Array(width * world.height)
  let head = 0
  let tail = 0
  queue[tail++] = start
  while (head < tail) {
    const current = queue[head++]
    if (current === goal) break
    const cx = current % width
    const cy = (current - cx) / width
    for (const [dx, dy] of STEPS) {
      const nx = cx + dx
      const ny = cy + dy
      const next = ny * width + nx
      if (nx < 0 || ny < 0 || nx >= width || ny >= world.height || prev[next] !== -1) continue
      if (!walkable(world, nx, ny, next === goal)) continue
      prev[next] = current
      queue[tail++] = next
    }
  }
  if (prev[goal] === -1) return null
  const path: Point[] = []
  for (let at = goal; at !== start; at = prev[at]) path.push({ x: at % width, y: Math.floor(at / width) })
  return path.reverse()
}

/** The walkable tile nearest to `near` that `taken` does not hold, for crowds bigger than the spots. */
export function nearestFree(world: World, near: Point, taken: ReadonlySet<string>): Point | null {
  const width = world.width
  const seen = new Uint8Array(width * world.height)
  const queue: Point[] = [near]
  seen[near.y * width + near.x] = 1
  while (queue.length) {
    const point = queue.shift()!
    if (walkable(world, point.x, point.y) && !taken.has(`${point.x},${point.y}`)) return point
    for (const [dx, dy] of STEPS) {
      const nx = point.x + dx
      const ny = point.y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= world.height || seen[ny * width + nx]) continue
      seen[ny * width + nx] = 1
      if (walkable(world, nx, ny)) queue.push({ x: nx, y: ny })
    }
  }
  return null
}
