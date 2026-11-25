// The side panel a click on a bot opens inside the tab. `buildPanel` turns what the worker knows
// into what the panel says (pure, tested); `renderPanel` writes it as HTML. Anything the data does
// not have reads «нет данных»: nothing is filled in.
import type { Desk } from '../src/bots'
import type { ChatAnswer, Extras, InternState } from '../src/extras'
import { ruleFor } from '../engine/locations'
import { formatDuration } from './format'
import { ACCESSORIES, ACCESSORY_LABELS, HAIR_STYLES, PLATE_MAX, type Appearance } from './appearance'
import { ownerColorsUsed, type CharacterSkin } from './characters'
import { HAIRS, P, SHIRTS, SKINS } from './palette'
import { STATE_COLOR } from './render'

export const NO_DATA = 'нет данных'

export type ChatView = { kind: 'loading' } | { kind: 'ok'; title: string; lastSaid: string; ago: string | null; chats: number } | { kind: 'none'; text: string }

export type PanelModel = {
  key: string
  name: string
  role: string
  agent: string
  status: { label: string; color: string; since: string | null }
  chats: number
  chat: ChatView
  interns: { kind: 'none'; text: string } | { kind: 'list'; list: { name: string; agent: string; state: string; color: string; live: boolean }[] }
  items: { kind: 'none'; text: string } | { kind: 'ok'; rows: { label: string; count: number; highlight: boolean }[]; needsYouTitles: string[] }
  /** When the workers/items were read, «N мин назад»; null when never. */
  readAgo: string | null
  /** Why workers/items may be missing (CLI not found, timeout). */
  readError: string | null
}

const ITEM_LABELS: Record<string, string> = {
  needs_you: 'Needs you',
  in_progress: 'В работе',
  planned: 'Запланировано',
  done: 'Готово',
  canceled: 'Отменено'
}
const ITEM_ORDER = ['needs_you', 'in_progress', 'planned', 'done', 'canceled']

const INTERN_LABELS: Record<InternState, string> = {
  working: 'работает',
  blocked: 'ждёт разрешения',
  waiting: 'ждёт ответа',
  done: 'закончил',
  idle: 'простаивает',
  unknown: NO_DATA
}

export function internColor(state: InternState): string {
  return state === 'unknown' ? P.idle : STATE_COLOR[state]
}

export function buildPanel(
  desk: Desk,
  extras: Extras | null,
  chat: ChatAnswer | 'loading' | null,
  now: number,
  seatingRole?: string
): PanelModel {
  const bot = extras?.bots[desk.key]
  const agent = desk.agents.length ? desk.agents.join(', ') : bot?.agent ?? NO_DATA
  const rule = ruleFor(desk.state, { needsYou: bot?.items?.needsYou ?? 0, failed: desk.failed })
  const chatView: ChatView =
    chat === 'loading'
      ? { kind: 'loading' }
      : chat === null
        ? { kind: 'none', text: NO_DATA }
        : chat.ok
          ? { kind: 'ok', title: chat.title, lastSaid: chat.lastSaid || NO_DATA, ago: chat.at ? formatDuration(now - chat.at) : null, chats: chat.chats }
          : { kind: 'none', text: chat.reason }
  const interns: PanelModel['interns'] =
    !bot || bot.interns === null
      ? { kind: 'none', text: NO_DATA }
      : bot.interns.length === 0
        ? { kind: 'none', text: 'сотрудников нет' }
        : {
            kind: 'list',
            list: bot.interns.map((i) => ({
              name: i.name,
              agent: i.agent ?? NO_DATA,
              state: INTERN_LABELS[i.state],
              color: internColor(i.state),
              live: i.live
            }))
          }
  const items: PanelModel['items'] =
    !bot || bot.items === null
      ? { kind: 'none', text: NO_DATA }
      : {
          kind: 'ok',
          rows: Object.entries(bot.items.counts)
            .filter(([, n]) => n > 0)
            .sort(([a], [b]) => rank(a) - rank(b))
            .map(([status, count]) => ({ label: ITEM_LABELS[status] ?? status, count, highlight: status === 'needs_you' })),
          needsYouTitles: bot.items.needsYouTitles
        }
  return {
    key: desk.key,
    name: desk.name,
    role: seatingRole ?? desk.role,
    agent,
    status: { label: rule.label, color: STATE_COLOR[desk.state], since: desk.since === null ? null : formatDuration(now - desk.since) },
    chats: desk.sessions,
    chat: chatView,
    interns,
    items,
    readAgo: extras && extras.at > 0 ? formatDuration(now - extras.at) : null,
    readError: extras?.error ?? null
  }
}

function rank(status: string): number {
  const i = ITEM_ORDER.indexOf(status)
  return i < 0 ? ITEM_ORDER.length : i
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

const muted = 'opacity:.6'
const section = (title: string, body: string) =>
  `<div style="margin-top:14px"><div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;${muted};margin-bottom:6px">${title}</div>${body}</div>`

/** The panel as HTML (every value escaped); `place` is the «Место» block, already rendered. */
export function renderPanel(model: PanelModel, place = ''): string {
  const h = escapeHtml
  const head = `
    <div style="display:flex;align-items:flex-start;gap:8px">
      <div style="flex:1">
        <div style="font-size:16px;font-weight:bold">${h(model.name)}</div>
        <div style="${muted}">${model.role ? h(model.role) : 'роль: ' + NO_DATA}</div>
      </div>
      <button data-act="close" title="Закрыть (Esc)" style="${buttonStyle};min-width:26px">✕</button>
    </div>
    <div style="margin-top:10px;line-height:1.6">
      <div><span style="color:${model.status.color}">●</span> ${h(model.status.label)}${model.status.since ? ` · ${h(model.status.since)}` : ''}</div>
      <div>агент: ${h(model.agent)}</div>
      <div style="${muted}">Контекст: Orca не отдаёт</div>
    </div>
    <div style="display:flex;gap:6px;margin-top:10px">
      <button data-act="open" style="${buttonStyle};flex:1">Открыть бота в Orca</button>
      <button data-act="appearance" style="${buttonStyle}">Внешность</button>
    </div>
    <div style="font-size:11px;${muted};margin-top:4px">Открывает дом бота. Открыть конкретный чат API Orca не позволяет.</div>`

  const chat =
    model.chat.kind === 'loading'
      ? `<div style="${muted}">читаю…</div>`
      : model.chat.kind === 'none'
        ? `<div style="${muted}">${h(model.chat.text)}</div>`
        : `<div style="font-weight:bold">${h(model.chat.title)}</div>
           <div style="${muted};font-size:11px">${model.chat.ago ? `активность ${h(model.chat.ago)} назад · ` : ''}открытых чатов у бота: ${model.chat.chats}</div>
           <div data-field="lastSaid" style="margin-top:6px;padding:6px 8px;background:#00000033;border-radius:4px;white-space:pre-wrap">${h(model.chat.lastSaid)}</div>`

  const interns =
    model.interns.kind === 'none'
      ? `<div style="${muted}">${h(model.interns.text)}</div>`
      : model.interns.list
          .map(
            (i) =>
              `<div style="display:flex;gap:6px;align-items:baseline;${i.live ? '' : muted}"><span style="color:${i.color}">●</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(i.name)}</span><span style="${muted}">${h(i.agent)}</span><span>${h(i.state)}</span></div>`
          )
          .join('')

  const items =
    model.items.kind === 'none'
      ? `<div style="${muted}">${h(model.items.text)}</div>`
      : model.items.rows.length === 0
        ? `<div style="${muted}">открытых items нет</div>`
        : model.items.rows
            .map(
              (r) =>
                `<div style="display:flex;justify-content:space-between;${r.highlight ? `color:${P.needsYou};font-weight:bold` : ''}"><span>${r.highlight ? '⚑ ' : ''}${h(r.label)}</span><span>${r.count}</span></div>`
            )
            .join('') +
          (model.items.needsYouTitles.length
            ? `<div style="margin-top:6px">${model.items.needsYouTitles.map((t) => `<div style="${muted}">· ${h(t)}</div>`).join('')}</div>`
            : '')

  const footer = `<div style="margin-top:14px;font-size:11px;${muted}">${
    model.readAgo ? `сотрудники и items прочитаны ${h(model.readAgo)} назад` : 'сотрудники и items ещё не прочитаны'
  }${model.readError ? ` · CLI: ${h(model.readError)}` : ''}</div>`

  return (
    head +
    place +
    section(`Текущий чат <button data-act="chat" title="Перечитать" style="${buttonStyle};min-width:0;height:18px;padding:0 6px;font-size:11px">↻</button>`, chat) +
    section('Сотрудники (воркеры)', interns) +
    section('Items', items) +
    footer
  )
}

export const buttonStyle = `min-width:28px;height:26px;border:0;border-radius:4px;background:${P.tag};color:${P.tagText};font:inherit;cursor:pointer`

// ── Appearance editor ──────────────────────────────────────────────────────────────────


const chip = (selected: boolean) =>
  `${buttonStyle};min-width:0;padding:0 8px;${selected ? `outline:2px solid ${P.working};outline-offset:-2px` : ''}`
const swatch = (color: string, selected: boolean) =>
  `width:22px;height:22px;border-radius:4px;border:2px solid ${selected ? P.tagText : '#00000055'};background:${color};cursor:pointer;padding:0`

/** The «Внешность» editor: a preview, presets from the office palette, a plate, «Сбросить». */
export function renderAppearanceEditor(name: string, look: Appearance, saved: boolean | null, opts: { characters: readonly CharacterSkin[]; worker: boolean } = { characters: [], worker: false }): string {
  const h = escapeHtml
  const skin = look.character ? opts.characters.find((c) => c.id === look.character) : undefined
  // A character keeps only some of the person's colours (a fox has no hair; a pirate keeps the skin).
  const used = skin ? ownerColorsUsed(skin) : null
  const shows = (c: 'skin' | 'hair' | 'shirt') => !used || used.has(c)
  const groups = new Map<string, CharacterSkin[]>()
  for (const c of opts.characters) groups.set(c.group, [...(groups.get(c.group) ?? []), c])
  const characterChip = (id: string, label: string) =>
    `<button data-act="set" data-field="character" data-value="${h(id)}" style="${chip(look.character === id || (!skin && id === '' && !look.character))}">${h(label)}</button>`
  const characterSection = opts.characters.length
    ? section(
        'Персонаж',
        `<div style="display:flex;flex-wrap:wrap;gap:4px">${characterChip('', 'Человек')}</div>` +
          [...groups]
            .map(([group, list]) => `<div style="margin-top:6px;font-size:11px;${muted}">${h(group)}</div><div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:2px">${list.map((c) => characterChip(c.id, c.name)).join('')}</div>`)
            .join('') +
          (look.character && !skin ? `<div style="margin-top:6px;font-size:11px;color:${P.waiting}">Пакет с этим персонажем не найден: сейчас рисуется человек.</div>` : '')
      )
    : ''
  const coatSection =
    skin && skin.coats.length > 1
      ? section(
          'Окрас',
          `<div style="display:flex;flex-wrap:wrap;gap:4px">${skin.coats
            .map((c, i) => {
              const color = Object.values(c.colors)[0] ?? '#888888'
              const selected = look.coat === c.id || (i === 0 && !skin.coats.some((x) => x.id === look.coat))
              return `<button data-act="set" data-field="coat" data-value="${h(c.id)}" title="${h(c.name)}" style="${swatch(color, selected)}"></button>`
            })
            .join('')}<span style="align-self:center;margin-left:6px;${muted}">${h((skin.coats.find((c) => c.id === look.coat) ?? skin.coats[0]).name)}</span></div>`
        )
      : ''
  const choices = (field: string, items: readonly string[], value: number | string, labels?: (item: string, i: number) => string) =>
    items
      .map((item, i) => {
        const v = typeof value === 'number' ? i : item
        return `<button data-act="set" data-field="${field}" data-value="${h(String(v))}" style="${chip(v === value)}">${h(labels ? labels(item, i) : item)}</button>`
      })
      .join('')
  const swatches = (field: string, colors: readonly string[], value: number) =>
    colors.map((c, i) => `<button data-act="set" data-field="${field}" data-value="${i}" title="${h(c)}" style="${swatch(c, i === value)}"></button>`).join('')
  return `
    <div style="display:flex;align-items:center;gap:8px">
      <button data-act="back" style="${buttonStyle}" title="Назад к панели">←</button>
      <div style="flex:1;font-weight:bold">Внешность: ${h(name)}</div>
    </div>
    <canvas data-preview width="96" height="52" style="display:block;margin:12px auto;width:192px;height:104px;image-rendering:pixelated;background:#00000033;border-radius:6px"></canvas>
    ${characterSection}
    ${coatSection}
    ${skin ? '' : section('Причёска', `<div style="display:flex;flex-wrap:wrap;gap:4px">${choices('hairStyle', HAIR_STYLES, look.hairStyle)}</div>`)}
    ${shows('hair') ? section('Цвет волос', `<div style="display:flex;flex-wrap:wrap;gap:4px">${swatches('hair', HAIRS, look.hair)}</div>`) : ''}
    ${shows('skin') ? section(skin ? 'Кожа (руки и лицо)' : 'Кожа', `<div style="display:flex;flex-wrap:wrap;gap:4px">${swatches('skin', SKINS, look.skin)}</div>`) : ''}
    ${shows('shirt') ? section('Одежда', `<div style="display:flex;flex-wrap:wrap;gap:4px">${swatches('outfit', SHIRTS.map(([c]) => c), look.outfit)}</div>`) : ''}
    ${section('Аксессуар', `<div style="display:flex;flex-wrap:wrap;gap:4px">${choices('accessory', ACCESSORIES, look.accessory, (a) => ACCESSORY_LABELS[a as keyof typeof ACCESSORY_LABELS])}</div>`)}
    ${opts.worker ? '' : section(`Табличка на столе (до ${PLATE_MAX} символов)`, `<input data-field="plate" maxlength="${PLATE_MAX}" value="${h(look.plate)}" placeholder="пусто — без таблички" style="width:100%;box-sizing:border-box;height:28px;border-radius:4px;border:1px solid #ffffff33;background:#00000044;color:${P.tagText};font:inherit;padding:0 8px">`)}
    <div style="display:flex;gap:6px;margin-top:14px">
      <button data-act="reset" style="${buttonStyle};flex:1">Сбросить</button>
    </div>
    <div style="margin-top:8px;font-size:11px;${muted}">${
      saved === false
        ? `<span style="color:${P.waiting}">Хранилище плагина недоступно: изменения видны до перезапуска.</span>`
        : `Цвета — из палитры офиса, персонажи — из пакетов скинов (office/skins).${opts.worker ? ' Стажёры сотрудника — в том же образе.' : ''} Хранится в хранилище плагина (orca.storage), меняется сразу.`
    }</div>`
}

// ── Workers ────────────────────────────────────────────────────────────────────────────

export type WorkerPanel = {
  id: string
  name: string
  parentKey: string
  parentName: string
  parentColor: string
  agent: string
  state: string
  color: string
  since: string | null
  seated: boolean
}

/** A worker's panel: name, its bot (a link to it), agent, status and time; «Открыть в Orca». */
export function renderWorkerPanel(w: WorkerPanel): string {
  const h = escapeHtml
  return `
    <div style="display:flex;align-items:flex-start;gap:8px">
      <div style="flex:1">
        <div style="font-size:16px;font-weight:bold;word-break:break-all">${h(w.name)}</div>
        <div style="${muted}">сотрудник (воркер бота)</div>
      </div>
      <button data-act="close" title="Закрыть (Esc)" style="${buttonStyle};min-width:26px">✕</button>
    </div>
    <div style="margin-top:10px;line-height:1.7">
      <div>родитель: <button data-act="parent" data-key="${h(w.parentKey)}" style="${buttonStyle};height:22px;padding:0 8px"><span style="display:inline-block;width:8px;height:8px;background:${w.parentColor};margin-right:6px"></span>${h(w.parentName)}</button></div>
      <div>агент: ${h(w.agent)}</div>
      <div><span style="color:${w.color}">●</span> ${h(w.state)}${w.since ? ` · ${h(w.since)}` : ''}</div>
      ${w.seated ? '' : `<div style="${muted}">без стола: в «Командах и отделах» не хватило мест</div>`}
    </div>
    <div style="display:flex;gap:6px;margin-top:10px">
      <button data-act="openWorker" data-id="${h(w.id)}" style="${buttonStyle};flex:1">Открыть в Orca</button>
      <button data-act="appearance" style="${buttonStyle}">Внешность</button>
    </div>
    <div style="font-size:11px;${muted};margin-top:4px">Открывает воркспейс сотрудника.</div>`
}

/** Workers without a desk («+N»): a list, each opens its panel. */
export function renderOverflow(list: readonly WorkerPanel[]): string {
  const h = escapeHtml
  return `
    <div style="display:flex;align-items:center;gap:8px">
      <div style="flex:1;font-weight:bold">Без стола: ${list.length}</div>
      <button data-act="close" style="${buttonStyle};min-width:26px">✕</button>
    </div>
    <div style="${muted};margin:6px 0">В «Командах и отделах» не хватило столов этим сотрудникам.</div>
    ${list
      .map(
        (w) =>
          `<div style="display:flex;gap:6px;align-items:center;padding:3px 0"><span style="display:inline-block;width:8px;height:8px;background:${w.parentColor}"></span><button data-act="pick" data-key="w:${h(w.id)}" style="${buttonStyle};flex:1;text-align:left;padding:0 8px">${h(w.name)}</button><span style="color:${w.color}">●</span></div>`
      )
      .join('')}`
}

// ── Places: «Закрепить» / «Открепить» ─────────────────────────────────────────────────

export type PlaceView = {
  kind: 'bots' | 'workers'
  /** Where it sits now: «Серверная», «стол t5 в «Команды и отделы»», «без места». */
  title: string
  /** The owner pinned it to this place. */
  pinned: boolean
  /** Pinned to a place it could not take (someone else's pin won). */
  pinnedElsewhere: boolean
  /** Storage trouble, if any. */
  note: string | null
}

/** «Место»: where it sits, whether the owner pinned it there, and the buttons. */
export function renderPlace(v: PlaceView): string {
  const h = escapeHtml
  const how = v.pinned
    ? `<span style="color:${P.working}">📌 закреплён овнером</span>`
    : v.kind === 'bots'
      ? `<span style="${muted}">авто: выбран случайно и держится, пока не закрепите</span>`
      : `<span style="${muted}">авто: первый свободный стол, держится</span>`
  return section(
    'Место',
    `<div>${h(v.title)}</div><div style="font-size:11px">${how}</div>` +
      (v.pinnedElsewhere ? `<div style="font-size:11px;color:${P.waiting}">закрепление не выполнено: место занято другим закреплением</div>` : '') +
      `<div style="display:flex;gap:6px;margin-top:8px">` +
      `<button data-act="pin" style="${buttonStyle};flex:1">📌 Закрепить…</button>` +
      (v.pinned || v.pinnedElsewhere ? `<button data-act="unpin" style="${buttonStyle};flex:1">Открепить</button>` : '') +
      `</div>` +
      (v.note ? `<div style="font-size:11px;color:${P.waiting};margin-top:4px">${h(v.note)}</div>` : '')
  )
}

export type PinChoice = { desk: string; title: string; mine: boolean; occupant: string | null; occupantPinned: boolean }

/** Picking a place: every office (a bot) or desk (a worker), free or with who sits there. */
export function renderPinPicker(kind: 'bots' | 'workers', name: string, choices: readonly PinChoice[]): string {
  const h = escapeHtml
  const rows = choices
    .map((c) => {
      const status = c.mine
        ? `<span style="color:${P.done}">сейчас здесь</span>`
        : c.occupant
          ? `<span style="color:${P.waiting}">занят: ${h(c.occupant)}${c.occupantPinned ? ' 📌' : ''}</span>`
          : `<span style="color:${P.working}">свободен</span>`
      return `<button data-act="pinTo" data-desk="${h(c.desk)}" style="${buttonStyle};display:flex;width:100%;height:auto;min-height:28px;padding:4px 8px;margin-top:4px;justify-content:space-between;gap:8px;text-align:left"><span>${h(c.title)}</span>${status}</button>`
    })
    .join('')
  return `
    <div style="display:flex;align-items:center;gap:8px">
      <div style="flex:1;font-weight:bold">📌 Закрепить: ${h(name)}</div>
      <button data-act="pinCancel" title="Отмена (Esc)" style="${buttonStyle};min-width:26px">✕</button>
    </div>
    <div style="${muted};margin:6px 0;font-size:11px">${
      kind === 'bots'
        ? 'Выберите кабинет здесь или кликните по нему на карте. В кабинете один бот: если он занят, предложу поменяться местами.'
        : 'Выберите стол в «Командах и отделах» здесь или кликните по нему на карте.'
    }</div>
    ${rows || `<div style="${muted}">мест нет</div>`}
    <button data-act="pinCancel" style="${buttonStyle};width:100%;margin-top:10px">Отмена</button>`
}

/** The place is taken: swap, or go back to the list. */
export function renderPinConfirm(v: { name: string; place: string; occupant: string; occupantPinned: boolean; from: string | null }): string {
  const h = escapeHtml
  return `
    <div style="font-weight:bold">${h(v.place)} занят</div>
    <div style="margin-top:8px">Там сидит <b>${h(v.occupant)}</b>${v.occupantPinned ? ' (закреплён)' : ''}.</div>
    <div style="margin-top:6px">Поменяться местами? ${h(v.name)} займёт ${h(v.place)}, а ${h(v.occupant)} ${
      v.from ? `пересядет в ${h(v.from)} и будет закреплён там.` : 'вернётся к авто-рассадке.'
    }</div>
    <div style="display:flex;gap:6px;margin-top:12px">
      <button data-act="pinSwap" style="${buttonStyle};flex:1;background:${P.working};color:${P.ink}">Поменяться местами</button>
      <button data-act="pinBack" style="${buttonStyle};flex:1">Назад к списку</button>
    </div>
    <button data-act="pinCancel" style="${buttonStyle};width:100%;margin-top:6px">Отмена</button>`
}

// ── «Оформление» ──────────────────────────────────────────────────────────────────────

export type DecorOption = { id: string; name: string; pack: string; selected: boolean }
export type DecorSection = { part: string; label: string; options: DecorOption[]; isDefault: boolean }

/** A room (floor, walls) or a piece of furniture: every look to pick, with a preview each. */
export function renderDecorPanel(v: { title: string; subtitle: string; sections: DecorSection[]; all?: { label: string; count: number } | null; note?: string | null }): string {
  const h = escapeHtml
  const sections = v.sections
    .map((sec) =>
      section(
        sec.label,
        `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">` +
          `<button data-act="decorReset" data-part="${h(sec.part)}" title="Как в карте" style="${tile(sec.isDefault)}"><div style="height:48px;display:flex;align-items:center;justify-content:center;opacity:.7">как было</div><div style="font-size:10px">по умолчанию</div></button>` +
          sec.options
            .map(
              (o) =>
                `<button data-act="decorPick" data-part="${h(sec.part)}" data-variant="${h(o.id)}" title="${h(o.name)} · ${h(o.pack)}" style="${tile(o.selected)}">` +
                `<canvas data-preview-variant="${h(o.id)}" data-part="${h(sec.part)}" width="48" height="48" style="width:48px;height:48px;image-rendering:pixelated;display:block;margin:0 auto"></canvas>` +
                `<div style="font-size:10px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(o.name)}</div>` +
                `<div style="font-size:9px;${muted}">${h(o.pack)}</div></button>`
            )
            .join('') +
          `</div>`
      )
    )
    .join('')
  return `
    <div style="display:flex;align-items:flex-start;gap:8px">
      <div style="flex:1">
        <div style="font-size:15px;font-weight:bold">🎨 ${h(v.title)}</div>
        <div style="${muted}">${h(v.subtitle)}</div>
      </div>
      <button data-act="decorClose" title="Закрыть" style="${buttonStyle};min-width:26px">✕</button>
    </div>
    ${sections}
    ${v.all ? `<button data-act="decorAll" style="${buttonStyle};width:100%;margin-top:12px">Так же для всех: ${h(v.all.label)} (${v.all.count})</button>` : ''}
    <div style="font-size:11px;${muted};margin-top:10px">Меняется сразу и хранится в хранилище плагина. Варианты — из пакетов office/skins/*.json (см. docs/skin-packs.md).</div>
    ${v.note ? `<div style="font-size:11px;color:${P.waiting};margin-top:4px">${h(v.note)}</div>` : ''}`
}

const tile = (selected: boolean) =>
  `${buttonStyle};height:auto;padding:4px;text-align:center;${selected ? `outline:2px solid ${P.working};outline-offset:-2px` : ''}`

export type AnimalRow = { id: string; name: string; species: string; on: boolean }

/** One animal in «Оформление»: on or off, and its coat (a preview each). */
export function renderAnimalPanel(v: { id: string; name: string; species: string; on: boolean; coats: { id: string; name: string; selected: boolean }[] }): string {
  const h = escapeHtml
  return `
    <div style="display:flex;align-items:flex-start;gap:8px">
      <div style="flex:1">
        <div style="font-size:15px;font-weight:bold">🐾 ${h(v.name)}</div>
        <div style="${muted}">${h(v.species)} · ${v.on ? 'в офисе' : 'выключен'}</div>
      </div>
      <button data-act="decorClose" title="Закрыть" style="${buttonStyle};min-width:26px">✕</button>
    </div>
    <button data-act="animalToggle" data-id="${h(v.id)}" style="${buttonStyle};width:100%;margin-top:10px">${v.on ? 'Выключить' : 'Включить'}</button>
    ${section(
      'Окрас',
      `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">` +
        v.coats
          .map(
            (c) =>
              `<button data-act="animalCoat" data-id="${h(v.id)}" data-coat="${h(c.id)}" title="${h(c.name)}" style="${tile(c.selected)}">` +
              `<canvas data-preview-animal="${h(v.id)}" data-coat="${h(c.id)}" width="48" height="48" style="width:48px;height:48px;image-rendering:pixelated;display:block;margin:0 auto"></canvas>` +
              `<div style="font-size:10px">${h(c.name)}</div></button>`
          )
          .join('') +
        `</div>`
    )}
    <div style="font-size:11px;${muted};margin-top:10px">Животные — только анимация, данные из office/animals/*.json (см. docs/animals.md). Выбор хранится в хранилище плагина.</div>`
}

/** Every animal with an on/off switch (a switched-off one is not on the map to click). */
function animalList(rows: readonly AnimalRow[]): string {
  if (!rows.length) return ''
  return section(
    'Животные',
    rows
      .map(
        (r) =>
          `<div style="display:flex;gap:6px;align-items:center;padding:2px 0"><button data-act="animalPick" data-id="${escapeHtml(r.id)}" style="${buttonStyle};flex:1;text-align:left;padding:0 8px">${escapeHtml(r.name)} <span style="${muted}">${escapeHtml(r.species)}</span></button>` +
          `<button data-act="animalToggle" data-id="${escapeHtml(r.id)}" style="${buttonStyle};padding:0 8px">${r.on ? 'вкл' : 'выкл'}</button></div>`
      )
      .join('')
  )
}

/** Nothing picked yet in «Оформление». */
export function renderDecorHint(animals: readonly AnimalRow[] = []): string {
  return `
    <div style="display:flex;align-items:center;gap:8px">
      <div style="flex:1;font-size:15px;font-weight:bold">🎨 Оформление</div>
      <button data-act="decorClose" title="Выйти (Esc)" style="${buttonStyle};min-width:26px">✕</button>
    </div>
    <div style="margin-top:10px;line-height:1.6">Кликните по комнате — поменять пол и стены.<br>По предмету — его вид (ковёр, стойка, диван, стол, кресло, аквариум, растение…).<br>По человечку — его внешность. По животному — включить, выключить, окрас.</div>
    ${animalList(animals)}
    <div style="font-size:11px;${muted};margin-top:10px">Esc — выйти из оформления.</div>`
}
