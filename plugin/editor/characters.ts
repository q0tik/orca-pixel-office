// Character skins: data, not code. A skin pack may carry `characters` — a robot, a fox, a knight —
// that the owner puts on any bot or employee (and so on the employee's trainees) in «Внешность».
// A character does not redraw the poses: the office still draws walking, typing, waiting, reading
// and every rest pose itself, and the character gives the parts that make it someone else —
// a head seen from the front, the back and the side, a small head for trainees, optionally a
// tail and a chest — plus the colours of the body (hands, clothes, shoes). So every character
// has every pose and every frame, and the status signs above the head stay where they were.
// See docs/characters.md.
import { BASE_PALETTE, P, type PaletteKey } from './palette'

/** Where the parts sit in the 16 × 26 figure (the feet on the bottom row) and how big they are. */
export const HEAD = { x: 2, y: 0, w: 12, h: 12 } as const
export const MINI = { x: 0, y: 0, w: 10, h: 7 } as const
export const FIGURE = { w: 16, h: 26 } as const
export const HEAD_VIEWS = ['front', 'back', 'side'] as const
export const TAIL_VIEWS = ['front', 'back', 'side'] as const
export type HeadView = (typeof HEAD_VIEWS)[number] | 'sleep'
export type TailView = (typeof TAIL_VIEWS)[number]

/** Body parts a character may paint, and the owner's colours a legend may borrow («%skin»…). */
export const BODY_PARTS = ['hands', 'shirt', 'shade', 'pants', 'shoes'] as const
export type BodyPart = (typeof BODY_PARTS)[number]
export const LOOK_COLORS = ['skin', 'hair', 'shirt', 'shade', 'pants'] as const
export type LookColor = (typeof LOOK_COLORS)[number]

/** Rows of characters; the legend says which colour each character is («.» and space are clear). */
export type Part = { x: number; y: number; w: number; h: number; rows: string[] }

export type Coat = { id: string; name: string; colors: Record<string, string> }

export type CharacterSkin = {
  /** `<pack>:<id>`. */
  id: string
  name: string
  group: string
  pack: string
  coats: Coat[]
  legend: Record<string, string>
  body: Partial<Record<BodyPart, string>>
  head: Record<(typeof HEAD_VIEWS)[number], Part> & { sleep?: Part }
  mini: Part
  tail: Partial<Record<TailView, Part>>
  chest?: Part
}

/** What a figure is drawn with: the character, its coat and the owner's colours for «%…». */
export type Dressed = { skin: CharacterSkin; coat: Coat }

const COLOR = /^#[0-9a-f]{6}$/i
const ID = /^[a-z0-9][a-z0-9-]*$/
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A legend value: "#rrggbb", "@palette", "$coat colour" or "%owner colour". */
function legendError(value: unknown, coatNames: ReadonlySet<string>): string | null {
  if (typeof value !== 'string') return 'ожидается строка'
  if (COLOR.test(value)) return null
  if (value.startsWith('@')) return value.slice(1) in BASE_PALETTE && value !== '@books' ? null : `${value}: нет такого цвета в палитре`
  if (value.startsWith('$')) return coatNames.has(value.slice(1)) ? null : `${value}: этого цвета нет в окрасах (coats[].colors)`
  if (value.startsWith('%')) return (LOOK_COLORS as readonly string[]).includes(value.slice(1)) ? null : `${value}: есть только ${LOOK_COLORS.map((c) => '%' + c).join(', ')}`
  return `${JSON.stringify(value)} — ожидается "#rrggbb", "@цветПалитры", "$цветОкраса" или "%цветВнешности"`
}

function parsePart(raw: unknown, fixed: { x: number; y: number; w: number; h: number } | null, legend: Record<string, string>, at: (f: string, m: string) => void, field: string): Part | undefined {
  // A fixed part (a head) is just its rows; a free one (a tail, a chest) says where it sits.
  const rows = fixed ? raw : isObj(raw) ? raw.rows : undefined
  if (!fixed && !isObj(raw)) {
    at(field, 'ожидается объект { "x", "y", "rows" }')
    return undefined
  }
  if (!Array.isArray(rows) || rows.length === 0 || rows.some((r) => typeof r !== 'string')) {
    at(field, fixed ? `ожидается ${fixed.h} строк по ${fixed.w} символов` : 'rows: ожидается массив строк')
    return undefined
  }
  const w = [...(rows[0] as string)].length
  const h = rows.length
  const x = fixed ? fixed.x : (raw as Obj).x
  const y = fixed ? fixed.y : (raw as Obj).y
  if (fixed && (w !== fixed.w || h !== fixed.h)) {
    at(field, `ожидается ${fixed.h} строк по ${fixed.w} символов, а не ${h} × ${w}`)
    return undefined
  }
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x + w > FIGURE.w || y + h > FIGURE.h) {
    at(field, `x, y — целые; часть должна помещаться в фигуру ${FIGURE.w} × ${FIGURE.h}`)
    return undefined
  }
  let ok = true
  ;(rows as string[]).forEach((row, i) => {
    if (!ok) return
    if ([...row].length !== w) {
      at(`${field}[${i}]`, `все строки одной длины (${w})`)
      ok = false
      return
    }
    for (const ch of row) {
      if (ch !== '.' && ch !== ' ' && !(ch in legend)) {
        at(`${field}[${i}]`, `символ «${ch}» не описан в legend`)
        ok = false
        return
      }
    }
  })
  return ok ? { x, y, w, h, rows: rows as string[] } : undefined
}

/** The `characters` of one pack; every mistake is a line naming the file and the field. */
export function parseCharacters(raw: unknown, pack: string, file: string): { characters: CharacterSkin[]; errors: string[] } {
  const errors: string[] = []
  const characters: CharacterSkin[] = []
  if (raw === undefined) return { characters, errors }
  if (!Array.isArray(raw)) return { characters, errors: [`${file}: characters: ожидается массив`] }
  const seen = new Set<string>()
  raw.forEach((entry, i) => {
    const field = `characters[${i}]`
    const before = errors.length
    const at = (f: string, m: string) => errors.push(`${file}: ${field}${f ? '.' + f : ''}: ${m}`)
    if (!isObj(entry)) return at('', 'ожидается объект')
    const id = typeof entry.id === 'string' && ID.test(entry.id) ? entry.id : (at('id', 'латиница в нижнем регистре, цифры и «-»'), '')
    if (id && seen.has(id)) at('id', `«${id}» уже есть в этом пакете`)
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : (at('name', 'нужно название'), '')
    const group = typeof entry.group === 'string' && entry.group.trim() ? entry.group.trim() : 'Персонажи'
    // Coats: one or more, each giving every «$name» colour.
    const coats: Coat[] = []
    if (!Array.isArray(entry.coats) || entry.coats.length < 1 || entry.coats.length > 6) at('coats', 'от 1 до 6 окрасов')
    else {
      const ids = new Set<string>()
      entry.coats.forEach((c, j) => {
        if (!isObj(c) || typeof c.id !== 'string' || !ID.test(c.id) || ids.has(c.id) || typeof c.name !== 'string' || !c.name.trim() || !isObj(c.colors)) {
          return at(`coats[${j}]`, 'ожидается { "id", "name", "colors": { "<имя>": "#rrggbb" } } с разными id')
        }
        const colors: Record<string, string> = {}
        for (const [k, v] of Object.entries(c.colors)) {
          if (typeof v === 'string' && COLOR.test(v)) colors[k] = v
          else at(`coats[${j}].colors.${k}`, `${JSON.stringify(v)} — ожидается "#rrggbb"`)
        }
        ids.add(c.id)
        coats.push({ id: c.id, name: c.name.trim(), colors })
      })
      const names = new Set(Object.keys(coats[0]?.colors ?? {}))
      for (const c of coats) {
        const own = Object.keys(c.colors)
        if (own.length !== names.size || own.some((k) => !names.has(k))) at(`coats.${c.id}`, 'у всех окрасов одни и те же цвета')
      }
    }
    const coatNames = new Set(Object.keys(coats[0]?.colors ?? {}))
    const legend: Record<string, string> = {}
    if (!isObj(entry.legend)) at('legend', 'ожидается объект { "a": "#rrggbb" | "@палитра" | "$окрас" | "%внешность" }')
    else {
      for (const [ch, value] of Object.entries(entry.legend)) {
        const problem = [...ch].length !== 1 || ch === '.' || ch === ' ' ? 'ключ — один символ, кроме «.» и пробела' : legendError(value, coatNames)
        if (problem) at(`legend.${ch}`, problem)
        else legend[ch] = value as string
      }
    }
    const body: Partial<Record<BodyPart, string>> = {}
    if (entry.body !== undefined) {
      if (!isObj(entry.body)) at('body', `ожидается объект { ${BODY_PARTS.join(', ')} }`)
      else {
        for (const [k, v] of Object.entries(entry.body)) {
          const problem = (BODY_PARTS as readonly string[]).includes(k) ? legendError(v, coatNames) : `нет такой части; есть ${BODY_PARTS.join(', ')}`
          if (problem) at(`body.${k}`, problem)
          else body[k as BodyPart] = v as string
        }
      }
    }
    if (errors.length > before) return
    const head: Partial<CharacterSkin['head']> = {}
    if (!isObj(entry.head)) at('head', 'ожидается { "front", "back", "side" } (и по желанию "sleep")')
    else {
      for (const view of [...HEAD_VIEWS, 'sleep'] as const) {
        if (entry.head[view] === undefined) {
          if (view !== 'sleep') at(`head.${view}`, `нужна голова «${view}»: ${HEAD.h} строк по ${HEAD.w} символов`)
          continue
        }
        const part = parsePart(entry.head[view], HEAD, legend, at, `head.${view}`)
        if (part) head[view] = part
      }
    }
    const mini = entry.mini === undefined ? (at('mini', `нужна голова стажёра: ${MINI.h} строк по ${MINI.w} символов`), undefined) : parsePart(entry.mini, MINI, legend, at, 'mini')
    const tail: CharacterSkin['tail'] = {}
    if (entry.tail !== undefined) {
      if (!isObj(entry.tail)) at('tail', 'ожидается { "front", "back", "side" } — любые из них')
      else {
        for (const [view, v] of Object.entries(entry.tail)) {
          if (!(TAIL_VIEWS as readonly string[]).includes(view)) at(`tail.${view}`, `есть только ${TAIL_VIEWS.join(', ')}`)
          else {
            const part = parsePart(v, null, legend, at, `tail.${view}`)
            if (part) tail[view as TailView] = part
          }
        }
      }
    }
    const chest = entry.chest === undefined ? undefined : parsePart(entry.chest, null, legend, at, 'chest')
    if (errors.length > before || !mini) return
    seen.add(id)
    characters.push({ id: `${pack}:${id}`, name, group, pack, coats, legend, body, head: head as CharacterSkin['head'], mini, tail, ...(chest ? { chest } : {}) })
  })
  return { characters, errors }
}

/** The owner's colours a character's parts may use. */
export type OwnerColors = Record<LookColor, string>

/** The colour of a legend value now: the coat, the owner's look, the palette (theme and hour). */
export function colorOf(value: string, dressed: Dressed, owner: OwnerColors): string | null {
  if (value.startsWith('$')) return dressed.coat.colors[value.slice(1)] ?? null
  if (value.startsWith('%')) return owner[value.slice(1) as LookColor] ?? null
  if (value.startsWith('@')) return (P[value.slice(1) as PaletteKey] as string | undefined) ?? null
  return value
}

/** Paints a part at its place, moved by (dx, dy); mirrored parts are handled by the caller's paint. */
export function paintPart(p: (x: number, y: number, w: number, h: number, c: string) => void, part: Part, dressed: Dressed, owner: OwnerColors, dx = 0, dy = 0): void {
  part.rows.forEach((row, ry) => {
    let rx = 0
    for (const ch of row) {
      const value = dressed.skin.legend[ch]
      const color = value ? colorOf(value, dressed, owner) : null
      if (color) p(part.x + rx + dx, part.y + ry + dy, 1, 1, color)
      rx += 1
    }
  })
}

/** Which of the owner's colours a character still shows (so the editor offers only those). */
export function ownerColorsUsed(skin: CharacterSkin): Set<LookColor> {
  const used = new Set<LookColor>()
  for (const v of [...Object.values(skin.legend), ...Object.values(skin.body)]) if (v.startsWith('%')) used.add(v.slice(1) as LookColor)
  // A body part left out keeps the owner's colour.
  if (!skin.body.hands) used.add('skin')
  if (!skin.body.shirt) used.add('shirt')
  if (!skin.body.pants) used.add('pants')
  return used
}

/** A coat by id, or the character's first one. */
export function coatOf(skin: CharacterSkin, id: string): Coat {
  return skin.coats.find((c) => c.id === id) ?? skin.coats[0]
}
