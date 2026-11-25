// The character gallery: every character skin from the packs in a few poses, drawn by the office's
// own art code. Built into the harness folder by tools/media/make.sh (or by hand with esbuild) and
// opened as gallery.html?mode=readme (all of them in a row, two poses) or ?mode=full (every coat,
// every pose) and ?theme=loft for the dark theme.
import { defaultAppearance } from '../../plugin/editor/appearance'
import { CHAR_H, CHAR_W, drawCharacter, drawIntern, drawPlacard, INTERN_H, lookOf, PLACARD_H, type CharPose, type Look } from '../../plugin/editor/art'
import type { CharacterSkin } from '../../plugin/editor/characters'
import { P } from '../../plugin/editor/palette'
import { loadPacks } from '../../plugin/editor/skins'
import { applyPalette } from '../../plugin/editor/theme'

const params = new URLSearchParams(location.search)
const mode = params.get('mode') ?? 'readme'
const SCALE = Number(params.get('scale') ?? (mode === 'readme' ? 4 : 3))

async function main(): Promise<void> {
  const { packs, errors } = await loadPacks(async (file) => (await fetch(`office/skins/${file}`)).json())
  if (errors.length) throw new Error(errors.join('\n'))
  const theme = packs.find((p) => p.theme?.id === (params.get('theme') ?? 'day'))?.theme
  if (theme) applyPalette(theme, {})
  const characters = packs.flatMap((p) => p.characters)
  const all = new Map(characters.map((c) => [c.id, c]))
  const look = (c: CharacterSkin | null, coat: string, key: string): Look =>
    lookOf({ ...defaultAppearance(key), outfit: 0, character: c?.id ?? '', coat }, key, all)
  const canvas = document.querySelector('canvas')!
  const ctx = canvas.getContext('2d')!
  const paintAt = (ox: number, oy: number) => (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color
    ctx.fillRect((ox + x) * SCALE, (oy + y) * SCALE, w * SCALE, h * SCALE)
  }
  const label = (text: string, x: number, y: number, size: number, color: string) => {
    ctx.font = `${size}px ui-monospace, Menlo, monospace`
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.fillText(text, x, y)
  }
  if (mode === 'readme') {
    // One column per character: facing us and walking, with its trainee; its name under it.
    const people: [CharacterSkin | null, string][] = [[null, 'Человек'], ...characters.map((c) => [c, c.name] as [CharacterSkin, string])]
    const colW = 22
    const rowH = CHAR_H + 3
    const perRow = Math.ceil(people.length / 2)
    canvas.width = (perRow * colW + 4) * SCALE
    canvas.height = (2 * (2 * rowH + INTERN_H + 14) + 4) * SCALE
    ctx.fillStyle = P.void
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    people.forEach(([c, name], i) => {
      const col = i % perRow
      const band = Math.floor(i / perRow)
      const ox = 2 + col * colW + (colW - CHAR_W) / 2
      const oy = 2 + band * (2 * rowH + INTERN_H + 14)
      const key = `gallery-${i}`
      ctx.fillStyle = P.wood
      ctx.fillRect((ox - 3) * SCALE, (oy - 1) * SCALE, (CHAR_W + 6) * SCALE, (2 * rowH + INTERN_H + 2) * SCALE)
      drawCharacter(paintAt(ox, oy), look(c, '', key), 'walk', 'down', 0)
      drawCharacter(paintAt(ox, oy + rowH), look(c, '', key), 'walk', 'right', 1)
      drawIntern(paintAt(ox + 3, oy + 2 * rowH), look(c, '', key), P.working)
      // A long name goes on two lines.
      ctx.font = `${3.2 * SCALE}px ui-monospace, Menlo, monospace`
      const words = name.split(' ')
      const lines = ctx.measureText(name).width > (colW - 1) * SCALE && words.length > 1 ? [words[0], words.slice(1).join(' ')] : [name]
      lines.forEach((line, k) => label(line, (ox + CHAR_W / 2) * SCALE, (oy + 2 * rowH + INTERN_H + 7 + k * 4) * SCALE, (k ? 2.8 : 3.2) * SCALE, P.tagText))
    })
    return
  }
  // Full: one row per character and coat, every pose.
  const poses: [CharPose, 'down' | 'up' | 'left' | 'right', number, string][] = [
    ['walk', 'down', 0, 'идёт'],
    ['walk', 'right', 1, 'сбоку'],
    ['walk', 'up', 2, 'спиной'],
    ['wait', 'down', 0, 'ждёт'],
    ['type', 'down', 1, 'печатает'],
    ['type', 'up', 0, 'спиной'],
    ['read', 'down', 1, 'читает'],
    ['sofa', 'down', 0, 'диван'],
    ['phone', 'down', 1, 'телефон'],
    ['rock', 'down', 1, 'стул'],
    ['feet', 'down', 0, 'ноги'],
    ['water', 'right', 1, 'цветок'],
    ['window', 'up', 0, 'окно'],
    ['ball', 'down', 1, 'мяч']
  ]
  const rows: [CharacterSkin | null, string][] = [[null, ''], ...characters.flatMap((c) => c.coats.map((coat) => [c, coat.id] as [CharacterSkin, string]))]
  const cellW = 20
  const cellH = CHAR_H + PLACARD_H + 2
  canvas.width = (70 + (poses.length + 1) * cellW) * SCALE
  canvas.height = (rows.length * cellH + 12) * SCALE
  ctx.fillStyle = P.void
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  poses.forEach(([, , , name], j) => label(name, (70 + j * cellW + cellW / 2) * SCALE, 8 * SCALE, 3 * SCALE, P.tagText))
  rows.forEach(([c, coat], i) => {
    const oy = 12 + i * cellH
    const name = c ? `${c.name} · ${c.coats.find((x) => x.id === coat)?.name}` : 'Человек'
    ctx.textAlign = 'left'
    ctx.font = `${3 * SCALE}px ui-monospace, Menlo, monospace`
    ctx.fillStyle = P.tagText
    ctx.fillText(name, 2 * SCALE, (oy + PLACARD_H + 14) * SCALE)
    ctx.fillStyle = P.wood
    ctx.fillRect(68 * SCALE, oy * SCALE, (poses.length + 1) * cellW * SCALE, (cellH - 1) * SCALE)
    const l = look(c, coat, `full-${i}`)
    poses.forEach(([pose, facing, frame], j) => {
      const ox = 70 + j * cellW + 2
      if (pose === 'wait') drawPlacard(paintAt(ox + 2, oy), '!', P.waiting)
      drawCharacter(paintAt(ox, oy + PLACARD_H), l, pose, facing, frame)
    })
    drawIntern(paintAt(70 + poses.length * cellW + 4, oy + PLACARD_H + CHAR_H - INTERN_H), l, P.working)
  })
}

main().then(
  () => (document.title = 'done'),
  (error) => (document.title = 'ERR ' + (error as Error).message)
)
