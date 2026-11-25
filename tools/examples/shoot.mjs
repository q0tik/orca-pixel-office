// Screenshots and GIF frames of the example offices served by tools/examples/build.sh, the same
// every time: a fake clock, a seeded Math.random, scripted events (a letter, a status change).
//   node tools/examples/shoot.mjs <base-url> <out-dir> [office or office:take ...]
// Then the GIFs: ffmpeg over <out-dir>/<office>-<take>/f%04d.png (see examples/offices/README.md).
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

// cam: the centre of the view in art pixels and the zoom; at: seconds after the warm-up.
const TAKES = {
  garage: [
    { name: 'day', hour: 13, cam: [192, 104, 4], view: [1600, 880], events: [{ at: 0, mail: ['handoff', 'toster', 'mila'] }], shots: [{ at: 1.2, file: 'garage-day.png' }] },
    { name: 'night', hour: 23, cam: [192, 104, 4], view: [1600, 880], shots: [{ at: 0, file: 'garage-night.png' }] },
    { name: 'gif', hour: 19, cam: [192, 112, 3], view: [1200, 660], fps: 10, gif: [0, 9], events: [
      { at: 1, mail: ['question', 'bob', 'toster'] }, { at: 3, state: ['mila', 'working'] }, { at: 5.5, mail: ['status', 'owner', 'mila'] }
    ] }
  ],
  station: [
    { name: 'day', hour: 13, cam: [336, 216, 2], view: [1400, 900], events: [{ at: 0, mail: ['handoff', 'zond', 'kvazar'] }, { at: 0.4, mail: ['question', 'blip', 'gagarina'] }], shots: [{ at: 1.3, file: 'station-day.png' }] },
    { name: 'night', hour: 22, cam: [336, 216, 2], view: [1400, 900], shots: [{ at: 0, file: 'station-night.png' }] },
    { name: 'close', hour: 13, cam: [330, 150, 4], view: [1400, 900], shots: [{ at: 0, file: 'station-bridge.png' }] },
    { name: 'gif', hour: 13, cam: [336, 216, 2], view: [1360, 880], fps: 10, gif: [0, 8], events: [
      { at: 0.5, mail: ['handoff', 'kvazar', 'zond'] }, { at: 2, state: ['lunokhod', 'waiting'] }, { at: 3, mail: ['status', 'outside', 'blip'] }, { at: 5, mail: ['question', 'gayka', 'orbita'] }
    ] }
  ],
  corp: [
    { name: 'day', hour: 12, cam: [688, 416, 1], view: [1400, 850], events: CORP_MAIL(0), shots: [{ at: 1.4, file: 'corp-day.png' }] },
    { name: 'night', hour: 23, cam: [688, 416, 1], view: [1400, 850], shots: [{ at: 0, file: 'corp-night.png' }] },
    { name: 'ceo', hour: 12, cam: [262, 160, 3], view: [1600, 900], events: CORP_MAIL(0), shots: [{ at: 1.2, file: 'corp-ceo-door.png' }] },
    { name: 'kitchen', hour: 21, cam: [690, 700, 3], view: [1600, 900], shots: [{ at: 0, file: 'corp-kitchen-night.png' }] },
    { name: 'gif', hour: 12, cam: [688, 300, 2], view: [1400, 640], fps: 10, gif: [0, 8], events: [...CORP_MAIL(0.3), ...CORP_MAIL(4)] }
  ],
  castle: [
    { name: 'night', hour: 23, cam: [272, 168, 3], view: [1660, 1030], events: [{ at: 0, mail: ['question', 'kostey', 'lancelot'] }], shots: [{ at: 1.2, file: 'castle-night.png' }] },
    { name: 'day', hour: 11, cam: [272, 168, 3], view: [1660, 1030], shots: [{ at: 0, file: 'castle-day.png' }] }
  ]
}
function CORP_MAIL(t0) {
  const pairs = [['grom', 'tenx'], ['sova', 'vlast'], ['bambuk', 'kexa'], ['tor', 'misha'], ['yorsh', 'volk'], ['brut', 'sova'], ['kexa', 'tor'], ['zhuk', 'grom'], ['volk', 'bambuk'], ['tenx', 'yorsh']]
  return pairs.map(([a, b], i) => ({ at: t0 + i * 0.12, mail: [['handoff', 'question', 'status'][i % 3], a, b] }))
}

const [base, out, ...only] = process.argv.slice(2)
if (!base || !out) throw new Error('usage: shoot.mjs <base-url> <out-dir> [office...]')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined })
for (const [office, takes] of Object.entries(TAKES)) {
  if (only.length && !only.some((o) => o.split(':')[0] === office)) continue
  for (const take of takes) {
    if (only.length && !only.includes(office) && !only.includes(office + ':' + take.name)) continue
    const page = await browser.newPage({ viewport: { width: take.view[0], height: take.view[1] } })
    page.on('pageerror', (e) => console.error(office, take.name, 'pageerror', e.message))
    await page.addInitScript(() => {
      let a = 7
      Math.random = () => {
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    })
    const start = Date.now()
    await page.clock.install({ time: start })
    await page.clock.pauseAt(start)
    await page.goto(`${base}/${office}/?hour=${take.hour}&fresh&cam=${take.cam.join(',')}`)
    for (let i = 0; i < 30; i++) {
      await page.clock.runFor(100)
      await page.waitForTimeout(20)
    }
    await page.evaluate(() => {
      const c = document.querySelector('canvas')
      for (const el of document.querySelectorAll('body *')) if (el !== c && !el.contains(c)) el.style.visibility = 'hidden'
    })
    // Long enough for everyone to sit down, the animals to wander and «Жизнь» to start a chat.
    await page.clock.runFor(120_000)
    const events = [...(take.events ?? [])].sort((a, b) => a.at - b.at)
    const act = (e) => page.evaluate((e) => {
      if (e.state) window.__setState(e.state[0], e.state[1])
      if (e.mail) {
        const [type, from, to] = e.mail
        const who = (k) => (k === 'owner' ? { kind: 'owner', address: 'orca:items' } : k === 'outside' ? { kind: 'outside', address: 'ssh:remote/term_demo' } : { kind: 'bot', key: k })
        mail = { ...mail, entries: [{ id: 'shot-' + Date.now() + Math.random(), at: Date.now(), type, subject: '(demo)', from: who(from), to: who(to) }, ...mail.entries] }
        for (const cb of handlers['office.mail'] ?? []) cb(mail)
      }
    }, e)
    const fps = take.fps ?? 10
    const end = Math.max(...(take.shots ?? []).map((s) => s.at), take.gif ? take.gif[1] : 0)
    const shots = [...(take.shots ?? [])]
    const dir = `${out}/${office}-${take.name}`
    if (take.gif) mkdirSync(dir, { recursive: true })
    let next = 0
    let n = 0
    for (let f = 0; f / fps <= end + 1e-9; f++) {
      const t = f / fps
      while (next < events.length && events[next].at <= t + 1e-9) await act(events[next++])
      for (const s of shots.filter((s) => Math.abs(s.at - t) < 0.5 / fps)) await page.screenshot({ path: `${out}/${s.file}` })
      if (take.gif && t >= take.gif[0] && t < take.gif[1]) await page.screenshot({ path: `${dir}/f${String(n++).padStart(4, '0')}.png` })
      await page.clock.runFor(1000 / fps)
    }
    const errors = await page.evaluate(() => window.__errors)
    if (errors.length) console.error(office, take.name, 'errors', errors)
    console.log(office, take.name, take.gif ? `${n} frames` : 'ok')
    await page.close()
  }
}
await browser.close()
