// Test fixtures only (no runtime code imports this): the real office map and a tiny one.
import { readFileSync } from 'node:fs'
import { assert } from 'orca/testing'
import { parseMap, type World } from './world'

const here = (file: string) => new URL(file, import.meta.url).pathname

export function realMap(): World {
  const { world, errors } = parseMap(JSON.parse(readFileSync(here('../office/map.json'), 'utf8')))
  assert.deepEqual(errors, [])
  return world!
}

/** A small building: an owner office, a work room and a corridor, as the tests need. */
export function tinyMap(patch: (map: any) => void = () => {}): unknown {
  const map: any = {
    version: 1,
    name: 'tiny',
    stamps: {
      boss: { kind: 'owner', w: 5, h: 5, floor: 'carpet-red', furniture: [{ type: 'ceo-desk', x: 1, y: 1 }] },
      work: {
        kind: 'team',
        w: 7,
        h: 5,
        floor: 'wood',
        furniture: [
          { type: 'desk', id: 'a', x: 1, y: 1 },
          { type: 'desk', id: 'b', x: 4, y: 1 },
          { type: 'sofa', x: 1, y: 3, w: 2 }
        ],
        spots: [{ kind: 'kitchen', x: 5, y: 3 }]
      }
    },
    plan: {
      rooms: [
        { id: 'boss', stamp: 'boss', x: 0, y: 0 },
        { id: 'work', stamp: 'work', x: 0, y: 6 }
      ],
      corridors: [{ id: 'hall', x: 0, y: 4, w: 7, h: 3 }],
      doors: [
        { x: 2, y: 4, owner: true },
        { x: 3, y: 6 }
      ],
      spots: [{ kind: 'owner-wait', x: 1, y: 5, facing: 'up' }]
    }
  }
  patch(map)
  return map
}

