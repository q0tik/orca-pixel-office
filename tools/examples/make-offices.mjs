// Writes the example offices (examples/offices/<name>/map.json and demo.json). The maps use the same
// format as plugin/office/map.json; demo.json is made-up data for the harness only (bots, workers,
// mail, looks, theme, animals). Nothing here is real: names, chats and states are invented.
//   node tools/examples/make-offices.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const f = (type, x, y, more = {}) => ({ type, x, y, ...more })
const desk = (id, x, y, more = {}) => ({ type: 'desk', id, x, y, facing: 'up', ...more })
const wait = (xs, y) => xs.map((x) => ({ kind: 'owner-wait', x, y, facing: 'up' }))
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

// ── 1. Гараж: a startup in a garage, three bots, a cat ─────────────────────────────────────
const garage = {
  map: {
    version: 1,
    name: 'Гараж «Стартап на коленке»',
    stamps: {
      boss: { kind: 'owner', label: 'CEO', w: 9, h: 7, floor: 'carpet-red', wall: 'stripes', furniture: [
        f('window', 2, 0, { w: 2, view: 'outside' }), f('clock', 5, 0), f('wall-lamp', 6, 0),
        f('bookshelf', 1, 1), f('plant', 7, 1), f('ceo-desk', 3, 2), f('chair', 4, 4, { facing: 'up' }), f('floor-lamp', 7, 4)
      ] },
      shop: { kind: 'clevel', label: 'Верстак', w: 16, h: 7, floor: 'concrete', wall: 'bare', furniture: [
        f('window', 2, 0, { w: 3, view: 'outside' }), f('sign', 7, 0), f('whiteboard', 10, 0), f('wall-lamp', 13, 0, { variant: 'bulb' }),
        f('server-rack', 1, 1), f('server-rack', 1, 2), f('paint', 12, 1), f('ladder', 13, 1), f('boxes', 14, 1), f('boxes', 14, 2),
        desk('d1', 3, 3, { variant: 'multi' }), f('desk-lamp', 4, 3), desk('d2', 7, 3), desk('d3', 11, 3, { variant: 'boxed' }),
        f('plant', 6, 1, { variant: 'cactus' }), f('printer', 14, 5)
      ] },
      den: { kind: 'lounge', label: 'Диван и кухня', w: 24, h: 7, floor: 'parquet', furniture: [
        f('tv', 9, 0), f('garland', 16, 0, { w: 4 }), f('neon-sign', 20, 0),
        f('counter', 16, 1, { w: 2 }), f('sink', 18, 1), f('microwave', 19, 1), f('fridge', 21, 1), f('coffee-machine', 22, 1),
        f('rug', 6, 2, { w: 9, h: 4, variant: 'blue' }), f('floor-lamp', 6, 2), f('sofa', 8, 2), f('armchair', 13, 3),
        f('coffee-table', 8, 4, { w: 3 }), f('candles', 9, 4, { variant: 'jar' }),
        f('pet-bed', 2, 4), f('pet-bowl', 3, 5), f('night-light', 1, 5), f('plant', 1, 1), f('big-plant', 22, 5)
      ] }
    },
    plan: {
      rooms: [{ id: 'boss', stamp: 'boss', x: 0, y: 0 }, { id: 'shop', stamp: 'shop', x: 8, y: 0 }, { id: 'den', stamp: 'den', x: 0, y: 6 }],
      corridors: [],
      doors: [{ x: 4, y: 6, owner: true }, { x: 15, y: 6 }],
      spots: [...wait([3, 5, 2, 6], 7), { kind: 'kitchen', x: 18, y: 8, facing: 'up' }, { kind: 'entrance', x: 21, y: 10, facing: 'left' }]
    }
  },
  demo: {
    theme: 'loft',
    animals: { cat: { coat: 'calico' }, dog: { off: true }, parrot: { off: true } },
    bots: [
      { key: 'toster', name: 'Тостер', role: 'CTO', state: 'working', character: 'retro-robot', coat: 'red', items: { in_progress: 2, done: 4 } },
      { key: 'bob', name: 'Енот Боб', role: 'COO', state: 'waiting', character: 'raccoon', coat: 'classic', needsYou: 1 },
      { key: 'mila', name: 'Мила', role: 'CMO', state: 'idle', character: '' }
    ],
    mail: [['handoff', 'toster', 'mila'], ['question', 'bob', 'toster'], ['status', 'owner', 'bob']]
  }
}

// ── 2. Орбитальная станция: the CEO's bridge in the middle, labs on both sides, a hydroponic kitchen ──
const lab = (label, floor, wall, extra) => ({ kind: 'clevel', label, w: 11, h: 10, floor, wall, furniture: [
  f('window', 4, 0, { w: 3, view: 'outside' }), f('wall-lamp', 2, 0, { variant: 'bulb' }), f('wall-lamp', 8, 0, { variant: 'bulb' }),
  desk('d1', 2, 3, { variant: 'multi' }), desk('d2', 6, 3, { variant: 'multi' }), desk('d3', 2, 6), desk('d4', 6, 6), ...extra
] })
const station = {
  map: {
    version: 1,
    name: 'Орбитальная станция «Кефир-7»',
    stamps: {
      'lab-a': lab('Лаборатория А', 'raised', 'navy', [f('server-rack', 1, 1), f('server-rack', 9, 3), f('server-rack', 9, 4), f('server-rack', 9, 5), f('plant', 1, 8, { variant: 'cactus' }), f('printer', 9, 8)]),
      'lab-b': lab('Лаборатория Б', 'tile', 'sage', [f('bookshelf', 8, 1), f('aquarium', 7, 8), f('trophy', 9, 5), f('plant', 1, 8), f('desk-lamp', 3, 6)]),
      bridge: { kind: 'owner', label: 'Мостик', w: 22, h: 10, floor: 'carpet-blue', wall: 'navy', furniture: [
        f('window', 3, 0, { w: 6, view: 'outside' }), f('clock', 10, 0), f('window', 12, 0, { w: 6, view: 'outside' }),
        f('server-rack', 1, 1), f('server-rack', 1, 2), f('server-rack', 20, 1), f('server-rack', 20, 2),
        f('ceo-desk', 9, 3), f('chair', 10, 5, { facing: 'up' }), f('trophy', 16, 3), f('floor-lamp', 3, 4), f('floor-lamp', 18, 4),
        f('rug', 5, 6, { w: 12, h: 2, variant: 'blue' }), f('big-plant', 1, 8), f('big-plant', 20, 8)
      ] },
      hydro: { kind: 'lounge', label: 'Гидропоника и камбуз', w: 15, h: 14, floor: 'tile', wall: 'sage', furniture: [
        f('garland', 2, 0, { w: 4 }), f('neon-sign', 8, 0),
        f('counter', 1, 1, { w: 3 }), f('sink', 4, 1), f('stove', 5, 1), f('fridge', 6, 1), f('coffee-machine', 7, 1), f('microwave', 8, 1),
        f('kitchen-table', 2, 4, { w: 3, h: 2 }), f('chair', 3, 3, { facing: 'down' }), f('chair', 3, 6, { facing: 'up' }),
        ...range(9, 13).map((x, i) => f('plant', x, 3, i % 2 ? {} : { variant: 'cactus' })), ...range(9, 13).map((x) => f('big-plant', x, 6)),
        f('sofa', 2, 9), f('coffee-table', 2, 11, { w: 3 }), f('sofa', 8, 9), f('coffee-table', 8, 11, { w: 3 }), f('candles', 9, 11),
        f('floor-lamp', 6, 9), f('pet-bed', 12, 11), f('pet-bowl', 13, 11), f('night-light', 13, 12)
      ] },
      airlock: { kind: 'reception', label: 'Шлюз', w: 8, h: 14, floor: 'marble', furniture: [
        f('clock', 2, 0), f('wall-lamp', 5, 0, { variant: 'globe' }), f('loveseat', 1, 2), f('coffee-table', 1, 3, { w: 2 }), f('water-cooler', 6, 1),
        f('bird-cage', 6, 4), f('aquarium', 1, 8), f('big-plant', 1, 11), f('plant', 6, 11)
      ] },
      control: { kind: 'team', label: 'Центр управления', w: 21, h: 14, floor: 'raised', wall: 'navy', furniture: [
        f('whiteboard', 3, 0), f('chart', 8, 0), f('tv', 13, 0), f('clock', 17, 0),
        f('printer', 1, 1), f('server-rack', 19, 1), f('server-rack', 19, 2),
        ...[2, 6, 11, 15].flatMap((x, i) => [desk(`c${i + 1}`, x, 4, { variant: 'multi' }), desk(`c${i + 5}`, x, 9)]),
        f('plant', 1, 12), f('big-plant', 19, 12)
      ] }
    },
    plan: {
      rooms: [
        { id: 'lab-a', stamp: 'lab-a', x: 0, y: 0 }, { id: 'bridge', stamp: 'bridge', x: 10, y: 0 }, { id: 'lab-b', stamp: 'lab-b', x: 31, y: 0 },
        { id: 'hydro', stamp: 'hydro', x: 0, y: 13 }, { id: 'airlock', stamp: 'airlock', x: 14, y: 13 }, { id: 'control', stamp: 'control', x: 21, y: 13 }
      ],
      corridors: [{ id: 'ring', x: 0, y: 9, w: 42, h: 5, floor: 'concrete', furniture: [
        f('wall-lamp', 8, 0), f('wall-lamp', 33, 0), f('plant', 1, 3), f('water-cooler', 28, 1), f('plant', 40, 3)
      ] }],
      doors: [{ x: 20, y: 9, owner: true }, { x: 5, y: 9 }, { x: 36, y: 9 }, { x: 10, y: 13 }, { x: 17, y: 13 }, { x: 31, y: 13 }, { x: 14, y: 20 }, { x: 21, y: 18 }],
      spots: [...wait([19, 21, 18, 22], 10), { kind: 'kitchen', x: 5, y: 15, facing: 'up' }, { kind: 'kitchen', x: 7, y: 15, facing: 'up' }, { kind: 'entrance', x: 18, y: 25, facing: 'up' }]
    }
  },
  demo: {
    theme: 'day',
    animals: { parrot: { coat: 'blue' }, cat: { coat: 'black' }, dog: { off: true } },
    bots: [
      { key: 'zond', name: 'Зонд-3', role: 'CTO', state: 'working', character: 'android', coat: 'chrome', items: { in_progress: 3 },
        workers: [{ name: 'telemetry', state: 'working', subagents: 2, character: 'retro-robot', coat: 'teal' }, { name: 'docking', state: 'working', subagents: 1 }] },
      { key: 'gagarina', name: 'Гагарина', role: 'COO', state: 'waiting', character: 'astronaut', coat: 'orange', needsYou: 2 },
      { key: 'blip', name: 'Блип', role: 'CSO', state: 'working', character: 'alien', coat: 'green',
        workers: [{ name: 'xeno-scan', state: 'working', subagents: 1, character: 'alien', coat: 'purple' }] },
      { key: 'gayka', name: 'Гайка', role: 'CFO', state: 'done', character: 'retro-robot', coat: 'tin' },
      { key: 'lunokhod', name: 'Луноход', role: 'CIO', state: 'idle', character: 'retro-robot', coat: 'teal' },
      { key: 'orbita', name: 'Орбита', role: 'CMO', state: 'waiting', character: 'astronaut', coat: 'white',
        workers: [{ name: 'press-kit', state: 'blocked', subagents: 0 }] },
      { key: 'kvazar', name: 'Квазар', role: 'CDO', state: 'working', character: 'android', coat: 'black',
        workers: [{ name: 'star-map', state: 'working', subagents: 2, character: 'android', coat: 'white' }, { name: 'nav-ui', state: 'waiting', subagents: 0 }] },
      { key: 'pulsar', name: 'Пульсар', role: 'CHRO', state: 'idle', character: 'alien', coat: 'grey' }
    ],
    mail: [['handoff', 'zond', 'kvazar'], ['question', 'orbita', 'gagarina'], ['status', 'owner', 'blip'], ['status', 'outside', 'zond'], ['handoff', 'kvazar', 'pulsar']]
  }
}

// ── 3. Корпорация: 12 executives, two open spaces of 24 desks, a meeting zone, a huge kitchen ──
const EXEC_LOOKS = [
  { floor: 'parquet', wall: 'rose', extra: [f('flowers', 5, 1)] },
  { floor: 'carpet-blue', wall: 'stripes', extra: [f('trophy', 5, 1)] },
  { floor: 'wood', wall: 'plain', extra: [f('plant', 5, 1, { variant: 'cactus' })] },
  { floor: 'raised', wall: 'navy', extra: [f('server-rack', 5, 1), f('server-rack', 5, 2)] },
  { floor: 'marble', wall: 'sage', extra: [f('big-plant', 5, 1)] },
  { floor: 'carpet-green', wall: 'plain', extra: [f('printer', 5, 1)] }
]
const exec = (i) => {
  const look = EXEC_LOOKS[i % EXEC_LOOKS.length]
  return { kind: 'clevel', label: `Кабинет ${i + 1}`, w: 7, h: 9, floor: look.floor, wall: look.wall, furniture: [
    f('window', 2, 0, { w: 3, view: 'outside' }), f('wall-lamp', 1, 0), f('bookshelf', 1, 1),
    desk('desk', 2, 4, { variant: i % 2 ? 'tidy' : 'multi' }), f('desk-lamp', 3, 4), f('rug', 1, 6, { w: 5, h: 1, variant: i % 2 ? 'cream' : 'blue' }),
    f('floor-lamp', 5, 7), ...look.extra
  ] }
}
const openspace = (wall) => ({ kind: 'team', label: 'Опенспейс', w: 34, h: 21, floor: 'carpet-green', wall, furniture: [
  f('whiteboard', 3, 0), f('picture', 7, 0), f('wall-lamp', 11, 0), f('whiteboard', 15, 0), f('clock', 20, 0), f('wall-lamp', 26, 0), f('whiteboard', 28, 0),
  f('plant', 1, 1), f('bookshelf', 19, 1), f('printer', 30, 1), f('plant', 32, 1),
  ...[4, 9, 14].flatMap((y, row) => [2, 4, 6, 13, 15, 17, 27, 29].map((x, col) => desk(`t${row * 8 + col + 1}`, x, y, { facing: 'down' }))),
  f('plant', 1, 19), f('big-plant', 32, 19)
] })
const chairsRow = (xs, y, facing) => xs.map((x) => f('chair', x, y, { facing }))
const corp = {
  map: {
    version: 1,
    name: 'Корпорация «Мегасинергия»',
    stamps: {
      ceo: { kind: 'owner', label: 'CEO', w: 14, h: 9, floor: 'carpet-red', furniture: [
        f('window', 2, 0, { w: 3, view: 'outside' }), f('clock', 6, 0), f('window', 9, 0, { w: 3, view: 'outside' }), f('wall-lamp', 5, 0), f('wall-lamp', 7, 0),
        f('bookshelf', 1, 1), f('big-plant', 12, 1), f('rug', 3, 2, { w: 8, h: 5, variant: 'cream' }), f('ceo-desk', 5, 2),
        f('chair', 5, 5, { facing: 'up' }), f('chair', 7, 5, { facing: 'up' }), f('plant', 1, 7), f('plant', 12, 7), f('floor-lamp', 12, 4), f('aquarium', 1, 4)
      ] },
      ...Object.fromEntries(range(0, 11).map((i) => [`exec-${i + 1}`, exec(i)])),
      'open-a': openspace('plain'),
      'open-b': openspace('stripes'),
      meeting: { kind: 'other', label: 'Переговорные', w: 20, h: 21, floor: 'wood', wall: 'sage', furniture: [
        f('whiteboard', 3, 0), f('tv', 11, 0), f('chart', 14, 0), f('big-plant', 1, 1), f('water-cooler', 17, 1),
        f('kitchen-table', 4, 3, { w: 6, h: 3 }), ...chairsRow(range(4, 9), 2, 'down'), ...chairsRow(range(4, 9), 6, 'up'),
        f('kitchen-table', 4, 11, { w: 6, h: 3 }), ...chairsRow(range(4, 9), 10, 'down'), ...chairsRow(range(4, 9), 14, 'up'),
        f('sofa', 13, 4, { w: 4 }), f('coffee-table', 13, 6, { w: 4 }), f('armchair', 13, 11), f('armchair', 16, 11), f('coffee-table', 14, 12, { w: 2 }),
        f('plant', 1, 19), f('big-plant', 18, 19), f('floor-lamp', 18, 8)
      ] },
      reception: { kind: 'reception', label: 'Ресепшен', w: 22, h: 16, floor: 'marble', wall: 'sage', furniture: [
        f('clock', 3, 0), f('wall-lamp', 5, 0, { variant: 'globe' }), f('wall-lamp', 7, 0, { variant: 'globe' }), f('picture', 14, 0), f('picture', 18, 0),
        f('plant', 1, 1), f('aquarium', 13, 1), f('water-cooler', 20, 1), f('loveseat', 1, 3), f('coffee-table', 1, 4, { w: 2 }), f('floor-lamp', 3, 4),
        f('bird-cage', 17, 4), f('big-plant', 20, 4), f('counter', 8, 6, { w: 5 }), f('loveseat', 1, 9), f('coffee-table', 1, 10, { w: 2 }),
        f('big-plant', 1, 14), f('plant', 20, 14)
      ] },
      kitchen: { kind: 'lounge', label: 'Большая кухня', w: 44, h: 16, floor: 'tile', furniture: [
        f('neon-sign', 17, 0), f('garland', 22, 0, { w: 8 }), f('clock', 32, 0), f('picture', 36, 0),
        f('counter', 1, 1, { w: 4 }), f('sink', 5, 1), f('stove', 6, 1), f('stove', 7, 1), f('microwave', 8, 1), f('counter', 9, 1, { w: 3 }),
        f('coffee-machine', 12, 1), f('coffee-machine', 13, 1), f('fridge', 14, 1), f('fridge', 15, 1), f('water-cooler', 16, 1), f('big-plant', 42, 1),
        f('kitchen-table', 3, 5, { w: 6, h: 2 }), ...chairsRow(range(3, 8), 4, 'down'), ...chairsRow(range(3, 8), 7, 'up'),
        f('kitchen-table', 12, 5, { w: 6, h: 2 }), ...chairsRow(range(12, 17), 4, 'down'), ...chairsRow(range(12, 17), 7, 'up'),
        f('candles', 5, 5), f('candles', 14, 5, { variant: 'jar' }),
        f('rug', 22, 3, { w: 19, h: 10, variant: 'blue' }),
        f('sofa', 24, 4, { w: 4 }), f('sofa', 30, 4, { w: 4 }), f('sofa', 36, 4), f('coffee-table', 24, 6, { w: 4 }), f('coffee-table', 30, 6, { w: 4 }), f('coffee-table', 36, 6, { w: 3 }),
        f('sofa', 24, 9, { w: 4 }), f('sofa', 30, 9, { w: 4 }), f('coffee-table', 24, 11, { w: 4 }), f('coffee-table', 30, 11, { w: 4 }),
        f('candles', 25, 6), f('candles', 31, 6, { variant: 'jar' }), f('candles', 37, 6), f('armchair', 38, 10), f('armchair', 39, 10),
        f('floor-lamp', 22, 4), f('floor-lamp', 41, 4), f('pet-bed', 40, 13), f('pet-bed', 3, 13), f('pet-bowl', 4, 13), f('night-light', 41, 13),
        f('plant', 1, 14), f('plant', 42, 14)
      ] },
      servers: { kind: 'other', label: 'Серверная', w: 22, h: 16, floor: 'raised', wall: 'navy', furniture: [
        f('whiteboard', 3, 0), f('wall-lamp', 10, 0, { variant: 'bulb' }), f('wall-lamp', 16, 0, { variant: 'bulb' }),
        ...[3, 6, 9, 12, 15, 18].flatMap((x) => [2, 3, 4, 5, 8, 9, 10, 11].map((y) => f('server-rack', x, y))),
        f('printer', 1, 1), f('plant', 1, 14, { variant: 'cactus' }), f('plant', 20, 14, { variant: 'cactus' })
      ] }
    },
    plan: {
      rooms: [
        { id: 'ceo', stamp: 'ceo', x: 0, y: 0 },
        ...range(0, 11).map((i) => ({ id: `exec-${i + 1}`, stamp: `exec-${i + 1}`, x: 13 + 6 * i, y: 0 })),
        { id: 'open-a', stamp: 'open-a', x: 0, y: 12 }, { id: 'meeting', stamp: 'meeting', x: 33, y: 12 }, { id: 'open-b', stamp: 'open-b', x: 52, y: 12 },
        { id: 'reception', stamp: 'reception', x: 0, y: 36 }, { id: 'kitchen', stamp: 'kitchen', x: 21, y: 36 }, { id: 'servers', stamp: 'servers', x: 64, y: 36 }
      ],
      corridors: [
        { id: 'hall', x: 0, y: 8, w: 86, h: 5, floor: 'concrete', furniture: [
          f('wall-lamp', 11, 0), f('wall-lamp', 37, 0), f('wall-lamp', 61, 0), f('wall-lamp', 79, 0),
          f('plant', 1, 3), f('water-cooler', 31, 1), f('plant', 44, 3), f('water-cooler', 67, 1), f('plant', 84, 3)
        ] },
        { id: 'hall-2', x: 0, y: 32, w: 86, h: 5, floor: 'concrete', furniture: [
          f('wall-lamp', 8, 0), f('wall-lamp', 30, 0), f('wall-lamp', 56, 0), f('wall-lamp', 78, 0),
          f('plant', 1, 3), f('water-cooler', 45, 1), f('plant', 84, 3)
        ] }
      ],
      doors: [
        { x: 6, y: 8, owner: true }, ...range(0, 11).map((i) => ({ x: 16 + 6 * i, y: 8 })),
        { x: 10, y: 12 }, { x: 24, y: 12 }, { x: 42, y: 12 }, { x: 62, y: 12 }, { x: 76, y: 12 }, { x: 33, y: 20 }, { x: 52, y: 20 },
        { x: 16, y: 32 }, { x: 42, y: 32 }, { x: 68, y: 32 },
        { x: 11, y: 36 }, { x: 41, y: 36 }, { x: 56, y: 36 }, { x: 75, y: 36 }, { x: 21, y: 44 }
      ],
      spots: [
        ...wait([5, 7, 4, 8, 3, 9], 9),
        ...[26, 27, 28, 33, 34].map((x) => ({ kind: 'kitchen', x, y: 38, facing: 'up' })),
        { kind: 'entrance', x: 11, y: 50, facing: 'up' }
      ]
    }
  }
}
// The corporation's people: 12 executives, three workers each (36 employees), interns here and there.
const CORP = [
  ['vlast', 'Властелина', 'CEO-офис', 'waiting', 'fox', 'silver'], ['grom', 'Громов', 'CTO', 'working', 'android', 'chrome'],
  ['sova', 'Совушкина', 'CFO', 'working', '', ''], ['brut', 'Брутус', 'CSO', 'waiting', 'knight', 'steel'],
  ['kexa', 'Кекса', 'CMO', 'done', 'cat', 'ginger'], ['tor', 'Торопыга', 'COO', 'working', 'rabbit', 'white'],
  ['misha', 'Михалыч', 'CIO', 'idle', 'bear', 'brown'], ['bambuk', 'Бамбук', 'CDO', 'working', 'panda', 'classic'],
  ['tenx', 'Тень', 'CISO', 'working', 'ninja', 'black'], ['yorsh', 'Ёрш', 'CPO', 'idle', 'pirate', 'red'],
  ['volk', 'Серый', 'CHRO', 'waiting', 'wolf', 'grey'], ['zhuk', 'Жук', 'CAO', 'working', 'retro-robot', 'tin']
]
const WORKER_NAMES = ['api', 'ui', 'billing', 'search', 'mobile', 'infra', 'docs', 'qa', 'data', 'ads', 'crm', 'auth', 'chat', 'maps', 'promo', 'audit', 'cache', 'cdn']
const WORKER_LOOKS = [['', ''], ['', ''], ['fox', 'red'], ['deer', 'brown'], ['', ''], ['raccoon', 'rusty'], ['hooded', 'grey'], ['', ''], ['android', 'white'], ['skeleton', 'bone'], ['', ''], ['rabbit', 'grey']]
const WORKER_STATES = ['working', 'working', 'working', 'waiting', 'working', 'blocked', 'working', 'done']
let w = 0
corp.demo = {
  theme: 'day',
  animals: { dog: { coat: 'golden' }, cat: { coat: 'grey' }, parrot: { coat: 'red' } },
  bots: CORP.map(([key, name, role, state, character, coat], i) => ({
    key, name, role, state, character, coat,
    needsYou: state === 'waiting' ? 1 : 0,
    items: { in_progress: 1 + (i % 3), done: i },
    workers: range(0, 2).map((j) => {
      const n = w++
      const [wc, wcoat] = WORKER_LOOKS[n % WORKER_LOOKS.length]
      return { name: `${WORKER_NAMES[n % WORKER_NAMES.length]}-${Math.floor(n / WORKER_NAMES.length) + 1}`, state: WORKER_STATES[n % WORKER_STATES.length], subagents: [1, 0, 2, 1, 0, 1, 3, 0][n % 8], character: wc, coat: wcoat }
    })
  })),
  mail: [
    ['handoff', 'grom', 'tenx'], ['question', 'sova', 'vlast'], ['status', 'owner', 'grom'], ['handoff', 'bambuk', 'kexa'], ['question', 'tor', 'misha'],
    ['status', 'outside', 'zhuk'], ['handoff', 'yorsh', 'volk'], ['question', 'brut', 'sova'], ['status', 'owner', 'bambuk'], ['handoff', 'kexa', 'tor']
  ]
}

// ── 4. Замок: a throne room for the CEO, a library, a feast hall and barracks for the workers ──
const castle = {
  map: {
    version: 1,
    name: 'Замок «Багрово-Багов»',
    stamps: {
      throne: { kind: 'owner', label: 'Тронный зал', w: 14, h: 9, floor: 'carpet-red', wall: 'rose', furniture: [
        f('window', 2, 0, { w: 2, view: 'outside' }), f('garland', 5, 0, { w: 4 }), f('window', 10, 0, { w: 2, view: 'outside' }),
        f('candles', 2, 2), f('candles', 11, 2), f('ceo-desk', 5, 2), f('candles', 2, 6, { variant: 'jar' }), f('candles', 11, 6, { variant: 'jar' }),
        f('rug', 4, 5, { w: 6, h: 3, variant: 'cream' }), f('big-plant', 1, 7), f('big-plant', 12, 7), f('bookshelf', 1, 1), f('floor-lamp', 12, 1)
      ] },
      library: { kind: 'clevel', label: 'Библиотека', w: 12, h: 9, floor: 'wood', wall: 'stripes', furniture: [
        f('bookshelf', 1, 1), f('bookshelf', 3, 1), f('bookshelf', 5, 1), f('bookshelf', 7, 1), f('bookshelf', 9, 1), f('wall-lamp', 5, 0, { variant: 'globe' }),
        desk('d1', 2, 4, { variant: 'tidy' }), desk('d2', 5, 4), desk('d3', 8, 4, { variant: 'tidy' }),
        f('candles', 3, 4), f('candles', 6, 4, { variant: 'jar' }), f('candles', 9, 4), f('plant', 10, 7)
      ] },
      barracks: { kind: 'team', label: 'Казарма', w: 10, h: 21, floor: 'concrete', wall: 'bare', furniture: [
        f('sign', 3, 0), f('wall-lamp', 6, 0, { variant: 'bulb' }),
        ...[4, 9, 14].flatMap((y, row) => [desk(`k${row * 2 + 1}`, 2, y), desk(`k${row * 2 + 2}`, 5, y)]),
        f('boxes', 8, 1), f('boxes', 8, 2), f('ladder', 8, 18), f('paint', 1, 19)
      ] },
      feast: { kind: 'lounge', label: 'Пиршественный зал', w: 25, h: 10, floor: 'parquet', wall: 'bare', furniture: [
        f('garland', 8, 0, { w: 6 }), f('counter', 1, 1, { w: 2 }), f('stove', 3, 1), f('kitchen-table', 7, 3, { w: 6, h: 2 }),
        ...chairsRow(range(7, 12), 2, 'down'), ...chairsRow(range(7, 12), 5, 'up'), f('candles', 7, 3), f('candles', 10, 3, { variant: 'jar' }), f('candles', 12, 4),
        f('sofa', 17, 6, { w: 4 }), f('coffee-table', 17, 8, { w: 4 }), f('floor-lamp', 15, 6), f('pet-bed', 22, 8), f('pet-bowl', 21, 8), f('night-light', 1, 8)
      ] }
    },
    plan: {
      rooms: [
        { id: 'throne', stamp: 'throne', x: 0, y: 0 }, { id: 'library', stamp: 'library', x: 13, y: 0 },
        { id: 'barracks', stamp: 'barracks', x: 24, y: 0 }, { id: 'feast', stamp: 'feast', x: 0, y: 11 }
      ],
      corridors: [{ id: 'gallery', x: 0, y: 8, w: 25, h: 4, floor: 'concrete', furniture: [f('plant', 1, 2), f('plant', 22, 2)] }],
      doors: [{ x: 7, y: 8, owner: true }, { x: 19, y: 8 }, { x: 24, y: 9 }, { x: 5, y: 11 }, { x: 20, y: 11 }, { x: 24, y: 16 }],
      spots: [...wait([6, 8, 5, 9], 9), { kind: 'entrance', x: 23, y: 10, facing: 'left' }]
    }
  },
  demo: {
    theme: 'loft',
    animals: { dog: { coat: 'spotty' }, parrot: { coat: 'green' }, cat: { off: true } },
    bots: [
      { key: 'lancelot', name: 'Сэр Ланцелот', role: 'CTO', state: 'working', character: 'knight', coat: 'gold',
        workers: [{ name: 'moat', state: 'working', subagents: 2, character: 'knight', coat: 'steel' }, { name: 'drawbridge', state: 'working', subagents: 1, character: 'knight', coat: 'black' }] },
      { key: 'kostey', name: 'Кощей', role: 'CFO', state: 'waiting', character: 'skeleton', coat: 'old', needsYou: 1,
        workers: [{ name: 'treasury', state: 'blocked', subagents: 0, character: 'skeleton', coat: 'bone' }] },
      { key: 'merlin', name: 'Мерлин', role: 'CIO', state: 'working', character: 'hooded', coat: 'crimson',
        workers: [{ name: 'spellbook', state: 'working', subagents: 3, character: 'hooded', coat: 'green' }, { name: 'potions', state: 'waiting', subagents: 0, character: 'ninja', coat: 'navy' }] },
      { key: 'shut', name: 'Шут', role: 'CMO', state: 'idle', character: 'pirate', coat: 'blue' }
    ],
    mail: [['question', 'kostey', 'lancelot'], ['status', 'owner', 'merlin'], ['handoff', 'merlin', 'shut']]
  }
}

// JSON with every flat object (a piece of furniture, a door, a spot) on one line, like plugin/office/map.json.
function pretty(value, indent = '') {
  const flat = (v) => v === null || typeof v !== 'object' || (!Array.isArray(v) && Object.values(v).every((x) => x === null || typeof x !== 'object'))
  if (flat(value)) return JSON.stringify(value).replace(/^\{(.+)\}$/, '{ $1 }').replace(/":/g, '": ').replace(/,"/g, ', "')
  const inner = indent + '  '
  if (Array.isArray(value)) return value.length ? `[\n${value.map((v) => inner + pretty(v, inner)).join(',\n')}\n${indent}]` : '[]'
  return `{\n${Object.entries(value).map(([k, v]) => `${inner}${JSON.stringify(k)}: ${pretty(v, inner)}`).join(',\n')}\n${indent}}`
}

const OFFICES = { garage, station, corp, castle }
for (const [name, office] of Object.entries(OFFICES)) {
  const dir = join(ROOT, 'examples', 'offices', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'map.json'), pretty(office.map) + '\n')
  writeFileSync(join(dir, 'demo.json'), pretty(office.demo) + '\n')
  const people = office.demo.bots.reduce((s, b) => s + (b.workers?.length ?? 0), 0)
  const interns = office.demo.bots.reduce((s, b) => s + (b.workers ?? []).reduce((t, x) => t + x.subagents, 0), 0)
  console.log(`${name}: ${office.demo.bots.length} bots, ${people} workers, ${interns} interns`)
}
