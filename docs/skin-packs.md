# How to make your own skin pack

A skin pack changes how the office looks without touching code. It is one JSON file. It can:

- be a **theme**: palette colours, which floor to draw for which, rug and plant variants (selectable with «Тема: …»);
- add **looks** («variants») the owner can pick in «Оформление» for a room's **floor** or **walls**, or for any kind of
  **furniture** (desk, chair, sofa, rug, server rack, aquarium, plant…).
- add **characters** for people — a robot, a fox, a knight — that the owner puts on a bot or an employee in
  «Внешность» (`characters`, see [characters.md](characters.md)).

A look is either a **recolour** of a built-in picture (your colours for some palette entries) or a **sprite** (your own
pixels, written as rows of characters).

The loader is `plugin/editor/skins.ts`; the shipped packs are in `plugin/office/skins/`. A complete, working example
that the tests load: [`docs/examples/neon.json`](examples/neon.json). A bigger one: `plugin/office/skins/office-plus.json`.

## Install a pack

1. Put the file in `plugin/office/skins/`, e.g. `plugin/office/skins/neon.json` (lower-case letters, digits and `-`).
2. Add its name to `plugin/office/skins/index.json`: `["day.json", "loft.json", "office-plus.json", "neon.json"]`.
3. Reopen the office tab (or `orca plugin dev reload plugin`). Mistakes show up in the HUD («пакеты скинов: N ошибк.») and in
   detail with **Shift+D**: one line per mistake, naming the file and the field. A bad look is skipped, the rest of the
   pack still loads; a file that is not a pack at all is skipped whole. The office never breaks on a pack.

## The manifest

```json
{
  "format": 1,
  "id": "neon",
  "name": "Неон",
  "author": "you",
  "license": "MIT",
  "description": "Optional, one line.",
  "theme": { "palette": {}, "floors": {}, "furniture": {} },
  "variants": []
}
```

| Field | Required | Meaning |
|---|---|---|
| `format` | yes | Always `1`. |
| `id` | yes | `a-z`, `0-9`, `-`; unique among packs; not `builtin`. Looks are stored as `<id>:<variant id>`. |
| `name` | yes | Shown in the theme button and under each look. |
| `author`, `license`, `description` | no | Shown nowhere yet, but please fill them in: the shipped packs are `MIT`. |
| `theme` | no | Makes the pack a theme. |
| `variants` | no | Looks for «Оформление». |

### `theme`

```json
"theme": {
  "palette": { "wood": "#5a4030", "wallFace": "#7a4a3a" },
  "floors": { "carpet-green": "concrete" },
  "furniture": { "rug": "cream", "plant": "cactus" }
}
```

- `palette`: any palette entries (list below) as `"#rrggbb"`; `books` takes a non-empty array of colours.
- `floors`: draw one built-in floor as another (`wood`, `parquet`, `carpet-red`, `carpet-blue`, `carpet-green`, `tile`,
  `concrete`, `marble`, `raised`). A floor the owner picked in «Оформление» is not remapped.
- `furniture.rug`: `red` | `blue` | `cream`; `furniture.plant`: `leafy` | `cactus`.

The sky in the windows, the evening and night dark and the lamps (see [Lights](#lights)) follow the clock in every theme; you do not set them.

### `variants`

```json
{ "id": "neon-sofa", "name": "Неоновый диван", "target": "sofa", "palette": { "sofa": "#ff4fd8", "sofaHi": "#ff8be6" } }
```

| Field | Meaning |
|---|---|
| `id` | `a-z`, `0-9`, `-`; unique in the pack. |
| `name` | Shown under the preview. |
| `target` | `"floor"`, `"wall"` or a furniture type (list below). |
| `base` | Optional: the built-in picture to start from. Floors: a floor kind. Walls: `plain`, `navy`, `stripes`, `rose`, `sage`, `bare`. Furniture: its built-in variant (desk: `""`, `multi`, `phone`, `tidy`, `boxed`; rug: `red`, `blue`, `cream`; plant: `""`, `cactus`; whiteboard: `""`, `arch`; floor-lamp: `""`, `arc`, `paper`; wall-lamp: `""`, `globe`, `bulb`; desk-lamp: `""`, `arm`; candles: `""`, `jar`; garland: `""`, `rainbow`; neon-sign: `""`, `heart`, `247`; night-light: `""`, `star`). **Required** for a floor or a wall without a sprite. |
| `palette` | Optional: palette entries swapped **only while this thing is drawn**. |
| `sprite` | Optional: your own pixels (below). Not for walls or things on walls. |
| `light` | Optional, lights only: `{ "color": "#rrggbb", "radius": 8–96 }`, the colour and reach (art pixels) of its light at night. See [Lights](#lights). |

At least one of `base`, `palette`, `sprite`, `light` is needed. With a sprite, `base` and `palette` are ignored.

Which palette entries a built-in picture uses is easiest to see in `plugin/editor/art.ts` (each function reads `P.<name>`).
The common ones: desks `deskTop deskTopHi deskFront deskDark deskLeg`; desk chairs and chairs `chair chairHi chairLo`;
sofas `sofa sofaHi sofaLo cushion`; armchairs, loveseats, the CEO chair `leather leatherHi leatherLo`; rugs `rugRed
rugBlue rugCream`; server racks `rack rackLo rackHi ledGreen ledAmber ledBlue`; the aquarium `aquaWater aquaWaterLo sand
fishOrange fishYellow leaf leafLo`; plants `leaf leafHi leafLo pot potLo`; walls `wallFace wallFaceShade wallFaceDark`
(and `wallNavy…`, `wallStripe…` and so on for the other styles); floors `wood… parquet… carpetRed… tile… concrete…
marble… raised…`.

Desk chairs are their own `chair` target: recolouring a desk does not change its chair.

## Sprites

```json
"sprite": {
  "w": 16,
  "h": 15,
  "legend": { "a": "@ink", "b": "#ff4fd8", "e": "@metalLo" },
  "rows": [
    "......aa........",
    ".....abba.......",
    "..."
  ]
}
```

- `rows`: exactly `h` strings of exactly `w` characters each. `.` and space are transparent.
- `legend`: one character → a colour: `"#rrggbb"` (fixed) or `"@<palette entry>"` (follows the theme). Every character
  used in `rows` must be in the legend.
- **Sizes.** Floors: exactly the tile, `16×16`, drawn on every floor tile of the room. Desk chairs and `chair`: up to
  `16×16`. Other furniture: up to its footprint × 16 wide, and its footprint × 16 **+ 20** tall (tall things may reach
  20 pixels up the wall). The sprite is drawn centred horizontally and standing on the bottom of the footprint.
- One character is one art pixel; the office scales whole pixels only, so sprites stay crisp. Keep to a small palette
  and, ideally, to `@` colours, so the look fits both themes.
- **Day and night**: in the evening and at night the office darkens and the lights cut pools out of the dark
  (see [Lights](#lights)); sprites are darkened like everything else. Pixels in a shining palette colour (`@lampLit`,
  `@lampBulb`, `@flameTip`, `@flameCore`, `@neonA`, `@neonB`, `@garlandWarm`, `@moon`, `@microwaveLit`, `@fridgeLit`,
  `@screenLine`, `@ledGreen`, `@ledAmber`, `@ledBlue`) are drawn again over the dark, so they glow. `@` colours also
  follow the theme; fixed `#` colours stay as they are.
- Animated things (server racks' LEDs, fish, coffee steam) animate only in their built-in pictures; a sprite is still.

## Furniture types

`desk`, `ceo-desk`, `chair`, `armchair`, `sofa`, `loveseat`, `coffee-table`, `kitchen-table`, `counter`, `sink`, `stove`,
`coffee-machine`, `fridge`, `water-cooler`, `printer`, `plant`, `big-plant`, `bookshelf`, `rug`, `server-rack`, `trophy`,
`flowers`, `boxes`, `ladder`, `paint`, `aquarium`, `pet-bed`, `pet-bowl`, `bird-cage`, and the lights: `floor-lamp`,
`wall-lamp`, `desk-lamp`, `candles`, `garland`, `neon-sign`, `night-light`, `microwave`. Footprints are in
`plugin/engine/catalog.ts`.

## Palette entries

`void`, `ink`, `wallCap`, `wallCapEdge`, `wallFace`, `wallFaceShade`, `wallFaceDark`, `wallBase`, `wallBaseDark`,
`doorFrame`, `doorFrameHi`, `ownerDoor`, `gold`, `goldDark`, `wood`, `woodAlt`, `woodSeam`, `woodHi`, `parquet`,
`parquetAlt`, `parquetSeam`, `carpetRed`, `carpetRedAlt`, `carpetRedHi`, `carpetBlue`, `carpetBlueAlt`, `carpetBlueHi`,
`carpetGreen`, `carpetGreenAlt`, `carpetGreenHi`, `tile`, `tileAlt`, `tileSeam`, `concrete`, `concreteAlt`,
`concreteSeam`, `concreteDot`, `marble`, `marbleAlt`, `marbleSeam`, `marbleVein`, `raised`, `raisedAlt`, `raisedSeam`,
`raisedHole`, `wallNavy`, `wallNavyShade`, `wallNavyDark`, `wallRose`, `wallRoseShade`, `wallRoseDark`, `wallSage`,
`wallSageShade`, `wallSageDark`, `wallStripe`, `wallStripeAlt`, `wallStripeDark`, `wallBare`, `wallBarePatch`,
`wallBareDark`, `tape`, `deskTop`, `deskTopHi`, `deskFront`, `deskDark`, `deskLeg`, `darkWood`, `darkWoodHi`,
`darkWoodLo`, `metal`, `metalHi`, `metalLo`, `plastic`, `plasticLo`, `screenOff`, `screenOn`, `screenLine`,
`screenLineDim`, `screenWait`, `screenBlock`, `keyboard`, `keyboardLo`, `chair`, `chairHi`, `chairLo`, `leather`,
`leatherHi`, `leatherLo`, `sofa`, `sofaHi`, `sofaLo`, `cushion`, `leaf`, `leafHi`, `leafLo`, `pot`, `potLo`, `white`,
`paper`, `paperLine`, `steel`, `steelLo`, `burner`, `flame`, `water`, `waterHi`, `coffee`, `glass`, `glassHi`, `sky`,
`frame`, `frameLo`, `board`, `markerRed`, `markerBlue`, `markerGreen`, `rugRed`, `rugCream`, `rugBlue`, `rack`, `rackLo`,
`rackHi`, `ledGreen`, `ledAmber`, `ledBlue`, `cardboard`, `cardboardLo`, `cardboardTape`, `aquaWater`, `aquaWaterLo`,
`sand`, `fishOrange`, `fishYellow`, `steam`, `cork`, `corkLo`, `noteYellow`, `noteGreen`, `mirrorGlass`, `flowerPink`,
`flowerRed`, `catFur`, `catFurLo`, `catNose`, `petBed`, `petBedHi`, `shoe`, `eye`, `mouth`, `bubble`, `working`,
`waiting`, `blocked`, `done`, `idle`, `needsYou`, `needsYouLo`, `mailHandoff`, `mailQuestion`, `mailStatus`, `mailDone`,
`mailEscalation`, `mailOther`, `envelope`, the night light `lampShade`, `lampLit`, `lampBulb`, `lampPole`, `lampBrass`,
`bankerGreen`, `candle`, `candleLo`, `flameTip`, `flameCore`, `wick`, `neonA`, `neonB`, `neonOff`, `garlandWire`,
`garlandWarm`, `garlandOff`, `codeA`, `codeB`, `codeC`, `logBg`, `logOk`, `logWarn`, `logErr`, `chartBg`, `chartBar`,
`chartLine`, `chatBg`, `chatMe`, `chatThem`, `saverBg`, `saverStar`, `microwave`, `microwaveLo`, `microwaveGlass`,
`microwaveLit`, `microwavePlate`, `fridgeLit`, `fridgeShelf`, `moon`, `moonLo`, then `tag`, `tagText`, `labelText`,
`labelBack`, and `books` (an array).

Status colours (`working`, `waiting`, `blocked`, …) mean something; a theme may tune them but should keep them telling
apart at a glance.

## Lights

From the evening on the office darkens and every light cuts a soft pool, in pixel rings, out of the dark: on the floor
and the walls of its own room, never through a wall. Lamps, candles, garlands, neon signs and the night light shine
all night; the aquarium and the server racks glow; a screen glows while its bot works there (code, logs, charts or a
chat, by the bot's role or its office) and shows a screensaver while the bot is away; the microwave, the coffee machine
and the fridge light up only while a bot uses them. By day the lamps are off.

A light is a piece of furniture like any other: put one on the map (`office/map.json`), and the owner can change its
look in «Оформление» or switch it off there (the switch stays off after a restart). A new look of a light is a pack
variant with a `light` field. Example, `office/skins/lights.json`:

```json
{ "id": "mint-lamp", "name": "Мятный торшер", "target": "floor-lamp", "base": "", "palette": { "lampShade": "#cdeedd", "lampLit": "#c8ffe4" }, "light": { "color": "#b8ffd8" } }
```

`palette` recolours the lamp (`lampShade` by day, `lampLit` at night); `light.color` tints its pool; `light.radius` sets
how far it reaches. The light map is computed once per change (the hour's phase, the theme, a lamp switched, a screen
on or off, an appliance taken), not every frame; flames, garlands, signs and screens move on the office's one animation
timer.

## Where the owner's choices live

In the plugin's storage (`orca.storage`, key `decor`):
`{ "v": 1, "rooms": { "<room id>": { "floor": "<pack>:<variant>", "wall": "…" } }, "items": { "<room>:<type>:<x>,<y>": "…" }, "off": ["<room>:<type>:<x>,<y>", …] }`;
`off` lists the lights switched off.
Built-in looks are `builtin:<target>:<base>`. If a pack is removed, the choices that used it are dropped and those things
look as the map says again.

## Checklist before you share a pack

- Your own art only, or art whose licence allows it; say the licence in `license`.
- No text that pretends to be data: the office shows only what Orca reports; a sprite must not look like a status.
- Run the plugin tests: `cd plugin && orca plugin test .` — and open the office: no lines in the HUD.
