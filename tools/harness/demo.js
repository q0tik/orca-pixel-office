// Made-up office for screenshots and for trying the plugin without Orca: six fictional bots,
// two workers and a little mail. No real names, chats or paths. Writes desks.json, extras.json
// and mail.json into the folder given:   node tools/harness/demo.js <out-dir>
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
const out = process.argv[2]
if (!out) throw new Error('usage: node demo.js <out-dir>')
const now = Date.now()
const min = 60_000
const bot = (key, name, role, state, ago, extra = {}) => ({ id: `folder:demo-${key}`, key, hostId: null, agents: ['claude'], name, role, state, since: now - ago * min, sessions: 1, failed: false, ...extra })
const desks = [
  bot('ada', 'Ada', 'CTO', 'working', 26),
  bot('linus', 'Linus', 'CSO', 'done', 12),
  bot('grace', 'Grace', 'assistant', 'waiting', 3),
  bot('alan', 'Alan', 'CFO', 'idle', 40, { sessions: 0 }),
  bot('margaret', 'Margaret', 'COO', 'done', 8),
  bot('barbara', 'Barbara', 'CMO', 'idle', 55, { sessions: 0 })
]
const worker = (name, state, ago, subagents = []) => ({ id: `demo::/workspaces/${name}`, name, agent: 'claude', state, live: state !== 'done', since: now - ago * min, subagents })
// «Стажёры»: subagents a worker runs right now (as `orca worktree ps` reports them).
const sub = (id, ago) => ({ id: `demo-sub-${id}`, type: 'general-purpose', state: 'working', startedAt: now - ago * 1000 })
const items = (counts, needsYou = 0) => ({ counts, needsYou, needsYouTitles: needsYou ? ['(demo item)'] : [] })
const extras = {
  at: now,
  source: 'demo',
  error: null,
  bots: {
    ada: { name: '[CTO] Ada', botId: 'demo-ada', agent: 'claude', interns: [worker('demo-api', 'working', 9, [sub('a', 40), sub('b', 12)]), worker('demo-ui', 'working', 4, [sub('c', 5)])], items: items({ in_progress: 2, done: 5 }) },
    linus: { name: '[CSO] Linus', botId: 'demo-linus', agent: 'claude', interns: [], items: items({ done: 3 }) },
    grace: { name: '[assistant] Grace', botId: 'demo-grace', agent: 'claude', interns: [], items: items({ planned: 1 }) },
    alan: { name: '[CFO] Alan', botId: 'demo-alan', agent: 'claude', interns: [], items: items({}) },
    barbara: { name: '[CMO] Barbara', botId: 'demo-barbara', agent: 'claude', interns: [], items: items({}) },
    margaret: { name: '[COO] Margaret', botId: 'demo-margaret', agent: 'claude', interns: [], items: items({ needs_you: 1, done: 2 }, 1) }
  }
}
const mail = {
  at: now,
  error: null,
  entries: [
    { id: 'demo-1', at: now - 30_000, type: 'handoff', subject: '(demo)', from: { kind: 'bot', key: 'ada' }, to: { kind: 'bot', key: 'linus' } },
    { id: 'demo-2', at: now - 90_000, type: 'question', subject: '(demo)', from: { kind: 'bot', key: 'grace' }, to: { kind: 'bot', key: 'ada' } },
    // The owner changed an item: drawn from the CEO's desk.
    { id: 'demo-3', at: now - 60_000, type: 'status', subject: 'Your owner updated (item 3 "(demo)")', from: { kind: 'owner', address: 'orca:items' }, to: { kind: 'bot', key: 'linus' } },
    // A bot's other chat touched an item: a journal line only.
    { id: 'demo-4', at: now - 120_000, type: 'status', subject: 'Your other chat commented (item 2 "(demo)")', from: { kind: 'system', address: 'orca:items' }, to: { kind: 'bot', key: 'grace' } },
    // Really outside: another computer. The entrance, with a «?».
    { id: 'demo-5', at: now - 150_000, type: 'status', subject: '(demo)', from: { kind: 'outside', address: 'ssh:remote/term_demo' }, to: { kind: 'bot', key: 'margaret' } }
  ]
}
writeFileSync(join(out, 'desks.json'), JSON.stringify({ desks, at: now }))
writeFileSync(join(out, 'extras.json'), JSON.stringify(extras))
writeFileSync(join(out, 'mail.json'), JSON.stringify(mail))
