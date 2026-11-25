// Dev harness only: a stand-in for Orca's frame API with a snapshot of the real worker's answer.
const handlers = {}
// Harness only: pin the hour with ?hour=13 (Orca never sets this) and keep storage in memory.
const pinnedHour = new URLSearchParams(location.search).get('hour')
if (pinnedHour !== null) window.__pixelOfficeHour = Number(pinnedHour)
// ?cam=x,y,zoom aims the camera (art pixels of the building).
const cam = new URLSearchParams(location.search).get('cam')
if (cam) {
  const [x, y, zoom] = cam.split(',').map(Number)
  window.__pixelOfficeCamera = { x, y, zoom }
}
// Harness only: storage lives in localStorage (prefix po:), so a reload keeps pins and places;
// ?fresh empties it first.
window.__pixelOfficeHarness = true
const memory = {
  has: (k) => localStorage.getItem('po:' + k) !== null,
  get: (k) => localStorage.getItem('po:' + k),
  set: (k, v) => localStorage.setItem('po:' + k, v),
  delete: (k) => localStorage.removeItem('po:' + k),
  keys: () => Object.keys(localStorage).filter((k) => k.startsWith('po:')).map((k) => k.slice(3))
}
if (new URLSearchParams(location.search).has('fresh')) for (const k of memory.keys()) memory.delete(k)
// harness-errors: surface page errors in the title for headless runs.
window.__errors = []
window.addEventListener('error', (e) => window.__errors.push(e.message))
window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason && e.reason.message || e.reason)))
let office = null
let extras = { at: 0, source: null, error: 'harness: no extras.json', bots: {} }
let mail = { entries: [], error: null, at: 0 }
const ready = Promise.all([
  fetch('desks.json').then((r) => r.json()).then((o) => (office = o)),
  fetch('extras.json').then((r) => (r.ok ? r.json() : null)).then((e) => e && (extras = { ...e, at: Date.now() - 20_000 })).catch(() => {}),
  fetch('mail.json').then((r) => (r.ok ? r.json() : null)).then((m) => m && (mail = m)).catch(() => {})
])
window.orca = {
  plugin: {
    on: (name, cb) => ((handlers[name] ??= []).push(cb)),
    request: async (name) => {
      await ready
      if (name === 'office.desks') return office
      if (name === 'office.debug') return { bots: [], skipped: 0, events: 0, lastEvent: null }
      if (name === 'office.extras') return extras
      if (name === 'office.mail') return mail
      // Made-up text only: the harness never sees a real chat.
      if (name === 'office.chat') return { ok: true, title: 'Выдуманный чат для харнесса', lastSaid: 'Здесь будет последний ответ бота (в харнессе — выдуманный текст).', at: Date.now() - 180_000, chats: 2 }
      if (name === 'office.openBot') return { opened: true }
      throw Object.assign(new Error('unknown'), { code: 'unknown_method' })
    }
  },
  document: { get: async () => ({ kind: 'text', text: '' }) },
  storage: {
    get: async (k) => (memory.has(k) ? JSON.parse(memory.get(k)) : null),
    set: async (k, v) => void memory.set(k, JSON.stringify(v)),
    delete: async (k) => void memory.delete(k),
    keys: async () => memory.keys(),
    onDidChange: () => ({ dispose() {} })
  }
}
window.__setState = (key, state) => {
  office = { ...office, at: Date.now(), desks: office.desks.map((d) => (d.key === key ? { ...d, state, since: Date.now() } : d)) }
  for (const cb of handlers['office.desks'] ?? []) cb(office)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function runActs() {
  const acts = JSON.parse(decodeURIComponent(location.hash.slice(6) || '[]'))
  await ready
  await sleep(300)
  const c = document.querySelector('canvas')
  for (const a of acts) {
    if (a.key) window.dispatchEvent(new KeyboardEvent('keydown', { key: a.key, shiftKey: !!a.shift }))
    if (a.wheel) c.dispatchEvent(new WheelEvent('wheel', { clientX: a.wheel[0], clientY: a.wheel[1], deltaX: a.wheel[2], deltaY: a.wheel[3], ctrlKey: !!a.wheel[4], bubbles: true, cancelable: true }))
    if (a.drag) {
      const [x1, y1, x2, y2] = a.drag
      c.dispatchEvent(new PointerEvent('pointerdown', { clientX: x1, clientY: y1, button: 0, pointerId: 7, bubbles: true }))
      for (let i = 1; i <= 5; i++) c.dispatchEvent(new PointerEvent('pointermove', { clientX: x1 + ((x2 - x1) * i) / 5, clientY: y1 + ((y2 - y1) * i) / 5, pointerId: 7, bubbles: true }))
      c.dispatchEvent(new PointerEvent('pointerup', { clientX: x2, clientY: y2, pointerId: 7, bubbles: true }))
    }
    if (a.click) {
      const [x, y] = a.click
      c.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, pointerId: 9, bubbles: true }))
      c.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, button: 0, pointerId: 9, bubbles: true }))
    }
    if (a.hover) c.dispatchEvent(new PointerEvent('pointermove', { clientX: a.hover[0], clientY: a.hover[1], pointerId: 1, bubbles: true }))
    if (a.state) window.__setState(a.state[0], a.state[1])
    // A new message arrives now (made-up subject): {"mail":["status",{"kind":"bot","key":"cto"},{"kind":"bot","key":"bot-2"}]}
    if (a.mail) {
      const [type, from, to] = a.mail
      mail = { ...mail, entries: [{ id: 'msg_h' + Date.now(), at: Date.now(), type, subject: '(тема скрыта)', from, to }, ...mail.entries] }
      for (const cb of handlers['office.mail'] ?? []) cb(mail)
    }
    // A worker starts for a bot: {"worker":["cto","harness-worker","working"]}
    if (a.worker) {
      const [key, name, state] = a.worker
      const bot = extras.bots[key]
      if (bot) {
        const id = 'repo::/harness/' + name
        const others = (bot.interns || []).filter((i) => i.id !== id)
        const live = state === 'working' || state === 'blocked' || state === 'waiting'
        extras = { ...extras, bots: { ...extras.bots, [key]: { ...bot, interns: state === 'gone' ? others : [{ id, name, agent: 'claude', state, live }, ...others] } } }
        for (const cb of handlers['office.extras'] ?? []) cb(extras)
      }
    }
    if (a.sel) document.querySelector(a.sel)?.click()
    if (a.type) {
      const input = document.querySelector(a.type[0])
      if (input) {
        input.value = a.type[1]
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }
    if (a.press) [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(a.press))?.click()
    if (a.journal) document.querySelector('button[title^="Журнал офиса"]')?.click()
    if (a.follow) document.querySelector('button[title^="Камера едет"]')?.click()
    if (a.wait) await sleep(a.wait)
    await sleep(30)
  }
  document.title = window.__errors.length ? 'ERR ' + window.__errors.join(' | ') : 'done'
}
if (location.hash.startsWith('#acts=')) runActs()
