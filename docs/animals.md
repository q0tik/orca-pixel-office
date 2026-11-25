# How to add an animal

Office animals are data, like [skin packs](skin-packs.md): one JSON file per species gives its pixel sprites, its
coats, how fast it moves, the rooms it may go to and its routines (where it goes, how it sits there, for how long).
The engine (`plugin/engine/animals.ts`) only reads the file and moves the animals. A new species is one file plus
its name in `plugin/office/animals/index.json`; no code. Animals are decoration: they never use Orca data or tokens,
never block anyone (bots walk through them) and are drawn under every sign, label and envelope.

Shipped: `cat.json` (two cats), `dog.json` (a dog), `parrot.json` (a parrot). A small, complete example that the tests
load: [`docs/examples/turtle.json`](examples/turtle.json). The shipped sprites are drawn by `tools/make_animals.py`, but
you can write rows by hand.

## Install

1. Put `plugin/office/animals/<name>.json` next to the others (lower-case letters, digits and `-`).
2. Add `"<name>.json"` to `plugin/office/animals/index.json`.
3. Reopen the office tab. Mistakes show up in the HUD («животные: N ошибк.») and line by line with **Shift+D**; a
   broken species file loads nothing, the others still do.

In «Оформление» the owner can switch each animal on or off and pick its coat; that choice is kept in the plugin storage
(`animals`: `{ "<species>-<animal>": { "off": true, "coat": "<coat id>" } }`).

## The file

```json
{
  "format": 1,
  "id": "turtle",
  "name": "Черепаха",
  "author": "you",
  "license": "MIT",
  "moves": "walk",
  "speed": 0.4,
  "size": [12, 8],
  "rooms": ["lounge", "reception"],
  "coats": [
    { "id": "green", "name": "Зелёная", "colors": { "shell": "#5f8a3a", "shellDark": "#3f5f26", "skin": "#9bbf6a" } }
  ],
  "instances": [{ "id": "tortila", "name": "Тортила", "coat": "green" }],
  "sprites": {
    "legend": { "s": "$shell", "d": "$shellDark", "k": "$skin", "e": "@eye" },
    "walk": [["…8 rows of 12 characters…"], ["…"]],
    "sit": [["…"]],
    "sleep": [["…"]]
  },
  "routines": [
    { "id": "nap", "at": "anywhere", "pose": "sleep", "stay": [60, 180], "weight": 2 },
    { "id": "fish", "at": "aquarium", "pose": "sit", "stay": [30, 90], "weight": 1 }
  ]
}
```

| Field | Meaning |
|---|---|
| `format` | Always `1`. |
| `id`, `name` | The species: `a-z`, `0-9`, `-`; a name for the panel. |
| `moves` | `"walk"` (BFS over the floor, around furniture) or `"fly"` (straight lines, in an arc). |
| `speed` | Tiles a second, up to 10. A bot walks about 6. |
| `size` | `[width, height]` of every frame, 4 to 24 pixels. |
| `rooms` | Room kinds it may go to: `owner`, `reception`, `clevel`, `team`, `lounge`, `corridor`, `other`. It may pass through others on the way. |
| `coats` | At least one: an `id`, a `name` and a colour for every `$name` in the legend. |
| `instances` | 1 to 6 animals of this species: `id`, `name`, starting `coat`. Their full id is `<species>-<id>`. |
| `sprites` | The legend and the frames (below). |
| `routines` | What it does (below). |
| `author`, `license` | Please fill them in; the shipped ones are MIT. |

## Sprites

- Every frame is `size[1]` strings of `size[0]` characters; `.` and space are transparent.
- `legend` maps a character to `"#rrggbb"` (fixed), `"@<palette entry>"` (follows the theme, see
  [skin-packs.md](skin-packs.md#palette-entries)) or `"$<coat colour>"` (from the chosen coat).
- Frames face **right**; the office mirrors them to face left.
- Frame lists: `walk` (walkers, any number of frames, played as it moves) or `fly` (fliers), `sit` (required), and
  `sleep`, `lie`, `perch` if a routine uses that pose. Still poses cycle their frames slowly (breathing, blinking, a
  wagging tail).
- The sprite stands on the bottom of its tile, centred; perches lift it (a desk top, a sill, a shelf, a shoulder).

## Routines

```json
{ "id": "rub", "at": "bot", "pose": "sit", "stay": [8, 20], "weight": 2, "follow": false }
```

- `at` — where to go:

| `at` | Where | Notes |
|---|---|---|
| `anywhere` | a free floor tile in its rooms | a stroll |
| `sofa` | a sofa seat in the lounge | sits on the cushion |
| `desk` | on top of a desk | walks to it, hops up |
| `window` | a window sill | walks under it, hops up |
| `aquarium` | in front of an aquarium | |
| `bowl` | next to a `pet-bowl` | |
| `bed` | on a `pet-bed` | |
| `owner-door` | by the owner's (CEO) door | |
| `bot` | next to a bot that stands or sits | with `"follow": true` it keeps to that bot while it stays |
| `shoulder` | on a bot's shoulder | fliers only; rides along, leaves when the bot walks |
| `shelf` | on top of a bookshelf | fliers only |
| `cage` | in a `bird-cage` | fliers only |

- `pose` — `sit`, `sleep`, `lie` or `perch` (the frames must exist).
- `stay` — `[min, max]` seconds there, up to 600; the actual time is random in between.
- `weight` — how often it picks this routine compared with the others (default 1).

When a place is taken by another animal or does not exist in its rooms, it picks another routine a few seconds later.

## Checklist

- Your own art, a licence in `license`.
- Nothing that looks like a status sign or a number: animals are decoration.
- `cd plugin && orca plugin test .` — the shipped species and the docs example are parsed by the tests.
