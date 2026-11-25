// Every kind of furniture and floor the map may name: its size in tiles, whether it stands on the
// floor or hangs on a wall, and whether people can walk through it. The pictures live in
// editor/art.ts; this file is only what the map validator and the pathfinder need.

export const TILE = 16

export const FLOORS = ['wood', 'parquet', 'carpet-red', 'carpet-blue', 'carpet-green', 'tile', 'concrete', 'marble', 'raised'] as const
export type FloorKind = (typeof FLOORS)[number]

/** How a room paints the face of its top wall: plain plaster, a colour, wallpaper or bare plaster. */
export const WALLS = ['plain', 'navy', 'stripes', 'rose', 'sage', 'bare'] as const
export type WallStyle = (typeof WALLS)[number]
/**
 * `block`: nobody walks through it. `seat`: a bot may end its walk on it (sofa) but not pass it.
 * `none`: decoration people walk over (a rug, a picture on a wall).
 */
export type Blocking = 'block' | 'seat' | 'none'

export type FurnitureSpec = {
  w: number
  h: number
  /** `floor` items stand inside the room; `wall` items hang on its top wall row. */
  mount: 'floor' | 'wall'
  blocking: Blocking
  /** The map may give `w`/`h` itself (a rug, a sofa), within these limits. */
  sizable?: { minW: number; maxW: number; minH: number; maxH: number }
  /** Needs an `id` (a desk a bot can sit at). */
  needsId?: boolean
  /** Which ways it may face; the first is the default. */
  facings?: readonly ('up' | 'down')[]
  /** Stands on another piece of furniture (candles on a table, a lamp on a desk): drawn over it. */
  onTop?: boolean
}

export const FURNITURE = {
  /**
   * A workstation: desk with a monitor, its chair below (`up`: the bot sits with its back to us) or
   * above (`down`). Variants: `multi` (three monitors), `phone`, `tidy` (planner and pen), `boxed`.
   */
  desk: { w: 2, h: 1, mount: 'floor', blocking: 'block', needsId: true, facings: ['up', 'down'] },
  /** The owner's desk with the big empty armchair behind it. */
  'ceo-desk': { w: 3, h: 2, mount: 'floor', blocking: 'block' },
  chair: { w: 1, h: 1, mount: 'floor', blocking: 'block', facings: ['up', 'down'] },
  armchair: { w: 1, h: 1, mount: 'floor', blocking: 'block' },
  /** Bots that finished sit on it, one per tile. */
  sofa: { w: 3, h: 1, mount: 'floor', blocking: 'seat', sizable: { minW: 2, maxW: 5, minH: 1, maxH: 1 } },
  'coffee-table': { w: 2, h: 1, mount: 'floor', blocking: 'block', sizable: { minW: 1, maxW: 5, minH: 1, maxH: 2 } },
  counter: { w: 1, h: 1, mount: 'floor', blocking: 'block', sizable: { minW: 1, maxW: 10, minH: 1, maxH: 1 } },
  sink: { w: 1, h: 1, mount: 'floor', blocking: 'block' },
  stove: { w: 1, h: 1, mount: 'floor', blocking: 'block' },
  'coffee-machine': { w: 1, h: 1, mount: 'floor', blocking: 'block' },
  fridge: { w: 1, h: 1, mount: 'floor', blocking: 'block' },
  'kitchen-table': { w: 2, h: 2, mount: 'floor', blocking: 'block', sizable: { minW: 1, maxW: 6, minH: 1, maxH: 3 } },
  plant: { w: 1, h: 1, mount: 'floor', blocking: 'block' },
  'big-plant': { w: 1, h: 1, mount: 'floor', blocking: 'block' },
  bookshelf: { w: 2, h: 1, mount: 'floor', blocking: 'block' },
  'water-cooler': { w: 1, h: 1, mount: 'floor', blocking: 'block' },
  printer: { w: 1, h: 1, mount: 'floor', blocking: 'block' },
  rug: { w: 2, h: 2, mount: 'floor', blocking: 'none', sizable: { minW: 1, maxW: 30, minH: 1, maxH: 30 } },
  /** Offices and the reception: a two-seat couch for visitors (decoration, no bot sits on it). */
  loveseat: { w: 2, h: 1, mount: 'floor', blocking: 'block' },
  /** LEDs blink while the tab shows it. */
  'server-rack': { w: 1, h: 1, mount: 'floor', blocking: 'block' },
  trophy: { w: 1, h: 1, mount: 'floor', blocking: 'block' },
  flowers: { w: 1, h: 1, mount: 'floor', blocking: 'block' },
  boxes: { w: 1, h: 1, mount: 'floor', blocking: 'block' },
  ladder: { w: 1, h: 1, mount: 'floor', blocking: 'block' },
  paint: { w: 1, h: 1, mount: 'floor', blocking: 'block' },
  /** Fish swim while the tab shows it. */
  aquarium: { w: 2, h: 1, mount: 'floor', blocking: 'block' },
  /** A pet bed: cats and dogs sleep here (office/animals). */
  'pet-bed': { w: 1, h: 1, mount: 'floor', blocking: 'none' },
  /** The dog's bowl (animals go to it; people step over it). */
  'pet-bowl': { w: 1, h: 1, mount: 'floor', blocking: 'none' },
  /** The parrot's cage on a stand. */
  'bird-cage': { w: 1, h: 1, mount: 'floor', blocking: 'block' },
  window: { w: 2, h: 1, mount: 'wall', blocking: 'none', sizable: { minW: 1, maxW: 6, minH: 1, maxH: 1 } },
  whiteboard: { w: 2, h: 1, mount: 'wall', blocking: 'none' },
  tv: { w: 2, h: 1, mount: 'wall', blocking: 'none' },
  clock: { w: 1, h: 1, mount: 'wall', blocking: 'none' },
  picture: { w: 1, h: 1, mount: 'wall', blocking: 'none' },
  mirror: { w: 1, h: 1, mount: 'wall', blocking: 'none' },
  /** A sales chart poster (decoration: it shows no data). */
  chart: { w: 2, h: 1, mount: 'wall', blocking: 'none' },
  /** «СДАЁТСЯ». */
  sign: { w: 2, h: 1, mount: 'wall', blocking: 'none' },
  /** Real numbers from Orca: bots waiting for the owner and bots at work. */
  'notice-board': { w: 2, h: 1, mount: 'wall', blocking: 'none' },
  // Night light (engine/lights.ts says how each one shines; they are lit from the evening on).
  /** A floor lamp: by the sofas, in the aisles, in a corner. */
  'floor-lamp': { w: 1, h: 1, mount: 'floor', blocking: 'block' },
  /** A wall lamp (бра). */
  'wall-lamp': { w: 1, h: 1, mount: 'wall', blocking: 'none' },
  /** A lamp standing on a desk. */
  'desk-lamp': { w: 1, h: 1, mount: 'floor', blocking: 'none', onTop: true },
  /** Candles on a table; their flames flicker at night. */
  candles: { w: 1, h: 1, mount: 'floor', blocking: 'none', onTop: true },
  /** A string of little lights along a wall. */
  garland: { w: 4, h: 1, mount: 'wall', blocking: 'none', sizable: { minW: 1, maxW: 12, minH: 1, maxH: 1 } },
  /** A neon sign on a wall. */
  'neon-sign': { w: 2, h: 1, mount: 'wall', blocking: 'none' },
  /** A little night light on the floor (by the cat's bed). */
  'night-light': { w: 1, h: 1, mount: 'floor', blocking: 'none' },
  /** On a counter; it lights up and hums while a bot warms its lunch. */
  microwave: { w: 1, h: 1, mount: 'floor', blocking: 'block' }
} as const satisfies Record<string, FurnitureSpec>

export type FurnitureType = keyof typeof FURNITURE

export function isFurnitureType(value: unknown): value is FurnitureType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FURNITURE, value)
}

/** What a room is for: seating and the status → place table read it. */
/** `clevel`: a bot's own office (one desk each); `reception`: the anteroom in front of the owner's office. */
export const ROOM_KINDS = ['owner', 'reception', 'clevel', 'team', 'lounge', 'corridor', 'other'] as const
export type RoomKind = (typeof ROOM_KINDS)[number]

/** Named places a bot can stand or sit that are not desks. Sofa spots come from sofas themselves. */
/** `entrance`: where mail from and to outside the office (another computer, Orca itself) arrives. */
export const SPOT_KINDS = ['owner-wait', 'kitchen', 'standby', 'sofa', 'entrance'] as const
export type SpotKind = (typeof SPOT_KINDS)[number]
