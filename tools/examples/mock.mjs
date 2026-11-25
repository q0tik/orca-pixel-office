// Turns an example's demo.json (made-up bots, workers, mail, looks) into what the harness serves:
// desks.json, extras.json, mail.json and preset.json (the plugin storage to start with: theme,
// animals, looks).   node tools/examples/mock.mjs <examples/offices/name/demo.json> <out-dir>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [src, out] = process.argv.slice(2)
if (!src || !out) throw new Error('usage: node mock.mjs <demo.json> <out-dir>')
const demo = JSON.parse(readFileSync(src, 'utf8'))
const now = Date.now()
const min = 60_000
const desks = demo.bots.map((b, i) => ({
  id: `folder:demo-${b.key}`, key: b.key, hostId: null, agents: ['claude'], name: b.name, role: b.role, state: b.state,
  since: now - (5 + ((i * 7) % 50)) * min, sessions: b.state === 'idle' ? 0 : 1, failed: false
}))
const preset = { theme: demo.theme, animals: demo.animals ?? {}, life: true }
// A character is stored as <pack>:<id> (plugin/office/skins); demo.json names the id only.
const SKINS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugin', 'office', 'skins')
const packOf = new Map()
for (const file of readdirSync(SKINS).filter((f) => f.endsWith('.json') && f !== 'index.json')) {
  const pack = JSON.parse(readFileSync(join(SKINS, file), 'utf8'))
  for (const c of pack.characters ?? []) packOf.set(c.id, pack.id)
}
const look = (key, character, coat) => {
  if (character === undefined) return
  if (character && !packOf.has(character)) throw new Error(`no character «${character}» in plugin/office/skins`)
  preset[`appearance:${key}`] = { v: 1, character: character ? `${packOf.get(character)}:${character}` : '', coat: coat ?? '' }
}
const bots = {}
for (const [i, b] of demo.bots.entries()) {
  look(b.key, b.character, b.coat)
  const interns = (b.workers ?? []).map((w, j) => {
    const id = `demo::/workspaces/${w.name}`
    look(`w:${id}`, w.character, w.coat)
    const subagents = Array.from({ length: w.subagents ?? 0 }, (_, k) => ({ id: `demo-sub-${w.name}-${k}`, type: 'general-purpose', state: 'working', startedAt: now - (10 + k * 25) * 1000 }))
    return { id, name: w.name, agent: 'claude', state: w.state, live: w.state !== 'done', since: now - (3 + i + j) * min, subagents }
  })
  const needsYou = b.needsYou ?? 0
  bots[b.key] = { name: `[${b.role}] ${b.name}`, botId: `demo-${b.key}`, agent: 'claude', interns, items: { counts: { ...(b.items ?? {}), ...(needsYou ? { needs_you: needsYou } : {}) }, needsYou, needsYouTitles: Array(needsYou).fill('(demo item)') } }
}
const who = (k) => (k === 'owner' ? { kind: 'owner', address: 'orca:items' } : k === 'outside' ? { kind: 'outside', address: 'ssh:remote/term_demo' } : { kind: 'bot', key: k })
const mail = { at: now, error: null, entries: (demo.mail ?? []).map(([type, from, to], i) => ({ id: `demo-${i + 1}`, at: now - (i + 1) * 40_000, type, subject: '(demo)', from: who(from), to: who(to) })) }
writeFileSync(join(out, 'desks.json'), JSON.stringify({ desks, at: now }))
writeFileSync(join(out, 'extras.json'), JSON.stringify({ at: now, source: 'demo', error: null, bots }))
writeFileSync(join(out, 'mail.json'), JSON.stringify(mail))
writeFileSync(join(out, 'preset.json'), JSON.stringify(preset))
