// Records frames of the made-up demo office (tools/harness, DEMO=1) for docs/media, the same every time:
// a fake clock (Playwright), a seeded Math.random and scripted events (a status change, a letter).
//   node tools/media/record.mjs <scene> <harness-url> <demo-dir> <out-dir>
// <scene> is one of the SCENES below. Frames are PNG screenshots of the office canvas only (no HUD, no buttons).
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'

// Crops are in tiles of the building [x, y, width, height]; times in seconds after the warm-up.
const STORY = [
  { t: 4, state: ['alan', 'waiting'] }, // Alan gets up from the sofa and goes to wait at the CEO's door
  { t: 10, mail: ['question', 'ada', 'alan'] }, // Ada writes to him: the envelope catches him in the corridor
  { t: 16.5, state: ['grace', 'working'] } // Grace stops waiting and goes to her office
]
const SCENES = {
  // demo.gif: the lounge (a chat, a cat on its bed, Alan leaves), then the reception (the letter, the CEO's door).
  demo: { seed: 11, warm: 259, zoom: 2, fps: 12.5, until: 21, events: STORY, segments: [
    { from: 0, to: 6.5, crop: [21.5, 20.5, 35, 17] },
    { from: 9, to: 21, crop: [-0.5, -0.75, 35, 17] }
  ] },
  // social-preview.png (its first frame) and social-preview.gif: the reception, closer.
  preview: { seed: 11, warm: 259, zoom: 3, fps: 10, until: 22.4, events: STORY, segments: [
    { from: 16.4, to: 22.4, crop: [-0.4, 3.9, 80 / 3, 9] }
  ] }
}

const [name, url, demoDir, out] = process.argv.slice(2)
const scene = SCENES[name]
if (!scene || !url || !demoDir || !out) throw new Error('usage: record.mjs <' + Object.keys(SCENES).join('|') + '> <harness-url> <demo-dir> <out-dir>')
mkdirSync(out, { recursive: true })
const T = 16 * scene.zoom
// The demo data is dated by demo.js; the clock starts 20 s after it.
const start = JSON.parse(readFileSync(demoDir + '/desks.json', 'utf8')).at + 20_000
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined })
const page = await browser.newPage({ viewport: { width: 56 * T + 112, height: 38 * T + 76 } })
page.on('pageerror', (e) => console.error('pageerror', e.message))
await page.addInitScript((seed) => {
  let a = seed
  Math.random = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}, scene.seed)
await page.clock.install({ time: start })
await page.clock.pauseAt(start)
await page.goto(`${url}?hour=13&fresh&cam=448,304,${scene.zoom}`)
for (let i = 0; i < 30; i++) {
  await page.clock.runFor(100)
  await page.waitForTimeout(15)
}
// Only the canvas in the frames: the HUD, buttons and hints are hidden for the screenshots.
await page.evaluate(() => {
  const c = document.querySelector('canvas')
  for (const el of document.querySelectorAll('body *')) if (el !== c && !el.contains(c)) el.style.visibility = 'hidden'
})
await page.clock.runFor(scene.warm * 1000)
// Where tile (0, 0) is on screen, from the harness state hook.
const { ox, oy } = await page.evaluate((T) => {
  const a = window.__pixelOfficeState().animals[0]
  return { ox: a.sx - (a.x + 0.5) * T, oy: a.sy - (a.y + 0.5) * T }
}, T)
const act = (e) => page.evaluate((e) => {
  if (e.state) window.__setState(e.state[0], e.state[1])
  if (e.mail) {
    const [type, from, to] = e.mail
    mail = { ...mail, entries: [{ id: 'media-' + Date.now(), at: Date.now(), type, subject: '(demo)', from: { kind: 'bot', key: from }, to: { kind: 'bot', key: to } }, ...mail.entries] }
    for (const cb of handlers['office.mail'] ?? []) cb(mail)
  }
}, e)
const events = [...scene.events].sort((a, b) => a.t - b.t)
let next = 0
let n = 0
for (let f = 0; f / scene.fps < scene.until; f++) {
  const t = f / scene.fps
  while (next < events.length && events[next].t <= t + 1e-9) await act(events[next++])
  const seg = scene.segments.find((s) => t >= s.from - 1e-9 && t < s.to - 1e-9)
  if (seg) {
    const [x, y, w, h] = seg.crop
    await page.screenshot({ path: `${out}/f${String(n++).padStart(4, '0')}.png`, clip: { x: Math.round(ox + x * T), y: Math.round(oy + y * T), width: Math.round(w * T), height: Math.round(h * T) } })
  }
  await page.clock.runFor(1000 / scene.fps)
}
const errors = await page.evaluate(() => window.__errors)
await browser.close()
if (errors.length) throw new Error('page errors: ' + errors.join(' | '))
console.log(`${name}: ${n} frames in ${out}`)
