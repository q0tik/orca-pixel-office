# Данные Orca для этапов 2–4: что доступно плагину

> **Обновление (этап 2).** CTO разрешил read-only доступ к `orca` CLI по белому списку из пяти команд
> (`bot list`, `bot work list`, `bot item list`, `worktree ps`, `bot chats` — последнее только по клику).
> Реализация и правила — `plugin/src/cli.ts` и раздел «Доступ к Orca CLI» в README.
>
> Что выяснилось на этапе 2:
>
> - Открыть конкретный чат нельзя. `orca bot chats --help`: id чата принимает только пишущая
>   `orchestration send --chat`, а в host API такого метода нет. Кнопка поэтому «Открыть бота в Orca»
>   (`workspace.open`), проверено вживую.
> - `worktree ps` помечает воркеры бота полем `bot` (имя бота) и `parent.selector` (= id воркспейса бота). Дом бота
>   там тоже есть, с `botHome: true`: его исключаем.
> - `bot work list` отдаёт статус воркера строкой «agent working»/«agent idle», без вида агента. Вид агента и точный
>   статус берём из `worktree ps`.
> - `bot item list` по умолчанию отдаёт открытые items и `counts` по статусам; ключ Needs you — `needs_you`.
> - `history:read` не включаем: решение CTO, Usage отложен.
>
> **Обновление (этап 3).** Источник событий — `orca orchestration inbox --json --limit 50`, добавлен в белый список
> вместе с `orca orchestration worker-list --json` (решение CTO).
>
> - Без `--terminal`/`--run` inbox показывает все почтовые ящики: межботовая картина есть.
> - Фильтра `since` нет, только `--limit`.
> - Времени в кратком виде нет: `created_at` есть только в `--full`, который отдаёт тело целиком. CTO решил `--full`
>   не брать, поэтому время — это момент, когда офис впервые увидел письмо.
> - Адреса:
>   - `orca_session_id:…` — чат бота (по `agents[].address` в `worktree ps` у дома бота) или агент воркера;
>   - `term_…` — терминал воркера (там же);
>   - `dispatch:ctx_…` / `ctx_…` — через `worker-list` (dispatchId → terminal/workspace);
>   - `run:…` — координатор Run, выводится из пар писем;
>   - `orca:items` — сама Orca.
> - Отдельного события «воркер стартовал с parent» в host API нет: есть `workspace.created`, а чей это воркер,
>   берём из `worktree ps` (`bot`, `parent.selector`).
> - `outcome: failure` есть только в `agent.status.changed` (`mainAgent.outcome`), в `agents.list` его нет.
>
> **Обновление (v7.1, адреса писем).** В белый список добавлена одна read-only форма:
> `orca orchestration task-list --run <run_…> --json` (берутся только id задач). `orca bot chats` теперь читается и
> для почты, но берутся только id чатов. Новых прав у плагина нет.
>
> - `structworker_…` — терминал структурного воркера: его нет в `worktree ps`, но он есть в `worker-list`
>   (`terminal` → `workspace`).
> - `run:…` — у Run бота `coordinator_handle` пустой (`run-list --full`). Чей Run, видно по его задачам:
>   `task-list --run` → `taskId` в `worker-list` → воркспейс → бот.
> - `orca:items` — payload пустой. Кто сделал, видно только по теме, которую пишет Orca: «Your owner …» (овнер) или
>   «Your other chat …» (другой чат того же бота).
>
> **Обновление (этап 4).** Добавлено право `storage:own` (внешность ботов, выбранная тема). Заполнение контекста
> перепроверено: host API по-прежнему 1.10, в типах и в `orca … --help` про контекст ничего нет; у агентов в
> `worktree ps` есть поля `children` и `subagentObservation`, но нет контекста и токенов. Поэтому в панели строка
> «Контекст: Orca не отдаёт».

Разведка 2026-11-24 на Orca с host API 1.10, плагин `local.pixel-office` 0.3.0. У плагина три одобренных права: `workspace:read`, `agent:read`,
`workspace:write`. Все строки ниже проверены вызовом из trusted-worker плагина: временный обработчик
`office.probe`, вызванный через `orca plugin dev request`. В коммит он не попал. Обработчик возвращал только структуру ответов, счётчики и коды
ошибок, без текста переписки.

Обозначения: ✅ доступно с текущими правами; ⛔ нужна новая capability (не добавлял); ⚠️ доступно только через
`orca` CLI из воркера, то есть в обход модели прав плагина; ❌ в Orca такого нет.

| Фича (этап) | Источник данных | Доступно trusted-worker сейчас? | Как проверил |
|---|---|---|---|
| Статус бота и его чатов (Э1) | `workspace.list` + `agents.list({workspaceId})` + событие `agent.status.changed` | ✅ | Работает в этапе 1. `agents.list` у дома бота: `{terminalId:null, title, agent:"claude", state, stateStartedAt, sessionId, task:null}` |
| Агент бота (claude/codex/…) (Э2) | поле `agent` в `agents.list` | ✅ | Вызов: `agent: "claude"`. Показывается в подсказке при наведении |
| Открыть **чат** бота (Э2) | `workspace.open({workspaceId: <папка бота>})` | ✅ частично | Вызов вернул `{opened:true}`, после него `workspace.readContext` = папка бота, терминалов 0. Открывается дом бота, его основной вид в Orca. **Открыть конкретный чат по id** (у Ады их 4) API не умеет: в методах нет «chat.open» |
| Сфокусировать чат как терминал | `terminal.list` / `terminal.focus` | ❌ для ботов | `terminal.list` у дома бота: 0 терминалов, у агента бота `terminalId: null`. Чат бота не терминал, фокусировать нечего |
| Последнее сообщение / текущая задача (Э2) | `agents.list[].task`, `agents.list[].title` | ✅, но пусто | Для чатов бота `task: null`, `title: null`. Текст последнего сообщения API не отдаёт |
| То же через CLI | `orca bot chats --bot <имя> --json` → `lastAsked`, `lastSaid`, `title`, `lastActivityAt` | ⚠️ | `execFile` из воркера: код выхода 0. **Это текст переписки**: CLI отдаёт его без всяких прав плагина |
| Воркеры бота, «сотрудники» (Э2, Э3) | `orca bot work list --bot <имя> --json` → `workspaces[{id,name,agent}]`, `items` | ⚠️ | `execFile`: код 0, у Ады 3 воркспейса |
| Воркеры по API | `workspace.list` (worktree без признака бота) | ✅ частично | В `workspace.list` нет поля «чей воркер». Поля `bot`/`botHome`/`parent` есть только в `orca worktree ps --json` (⚠️, проверено: код 0, 21 строка) |
| Items бота и число «Needs you» (Э2) | `orca bot item list --bot <имя> --status needs-you --json` → `items`, `counts` | ⚠️ | `execFile`: код 0, `counts: {done, in_progress}`. Статусы: planned, in-progress, needs-you, done, canceled |
| Items по API | — | ❌ | В host API 1.10 таких методов нет |
| События orchestration: handoff/question/status между ботами (Э3) | `orca orchestration inbox --json` → `messages[{id,type,from,to,subject,handled,body}]` | ⚠️ только опросом | `execFile`: код 0. В `PluginEvents` таких событий нет. Остаётся только периодический опрос, а это таймер и чтение `body`: тело сообщения — это переписка |
| Запуск воркера (Э3) | событие `workspace.created` (+ `orca worktree ps` для `parent`/`bot`) | ✅ событие, ⚠️ связь с ботом | Событие уже в манифесте. Чей это воркер, событие не говорит |
| blocked / approval / ошибка (Э3) | `state: "blocked"` в `agent.status.changed`, `mainAgent.outcome` (`failure`, `interruption`…) | ✅ | Типы host API 1.10. `blocked` уже рисуется («!» у двери CEO). `outcome: failure` можно показать красным «!» на этапе 3 |
| «Ждёт овнера» vs «ждёт что-то другое» | — | ❌ | В Orca 4 состояния: working/blocked/waiting/done. Кого ждёт агент, не сообщается. `blocked` и `waiting` оба ведут к двери овнера |
| Usage / токены бота (Э4) | `agent.listSessions` → `totalTokens`, `messageCount` | ⛔ `history:read` | Вызов: `capability_denied: plugin does not have the "history:read" capability` |
| Заполнение контекста (Э4) | — | ❌ | Ни в host API, ни в `orca` CLI нет. «Использовано 55%» в статус-баре Orca — лимит аккаунта, не контекст бота, и плагину он не отдаётся (`orca account list` — только аккаунты) |
| Вывод терминала | `terminal.read` | ⛔ `terminal:read` | Вызов: `capability_denied` |
| Автоматизации | `automation.list` | ⛔ `automation:read` | Вызов: `capability_denied` |
| Хранилище для редактора внешности (Э4) | `orca.storage` / `storage.get/set` | ⛔ `storage:own` | Метод в API есть, права в манифесте нет. Нужна новая capability, решение за вами |
| Боты других компьютеров (другие компьютеры) | `workspace.list` | ❌ сейчас | `orca bot list` помечает их `unreachable`. `workspace.list` их не отдаёт, поэтому в офисе их нет |
| Бот-UUID (`orca bot list` → `id`) | — | ⚠️ | В host API бота нет как сущности. Стабильный ключ этапа 1 — имя папки `~/.orca/bots/<slug>` |

## Может ли trusted-worker запускать процессы (`orca` CLI)

Может. Trusted-worker — это Node.js с правами пользователя. `node:child_process.execFile` с абсолютным путём
`/Applications/Orca.app/Contents/Resources/bin/orca` и массивом аргументов отработал на всех семи командах из таблицы.
Таймаут 15 с, `maxBuffer` 4 MiB, без shell. Новой capability Orca на это не требует: execution `trusted-worker` уже
означает «свой Node-процесс с правами пользователя».

**Но это обход модели прав.** Тот же процесс без всяких `*:read` получает:

- переписку ботов (`bot chats`: `lastAsked`/`lastSaid`);
- тела orchestration-сообщений;
- любые другие команды CLI, включая пишущие: `orchestration send`, `bot reply`.

Принцип 1 («только API Orca») и принцип 7 (приватность) против этого. Поэтому этап 1 CLI не использует.
Если на этапе 2 нужны items, «Needs you» и воркеры бота, есть варианты:

1. **Рекомендую:** попросить в Orca методы host API (`bots.list`, `bot.items`, `bot.work`, событие
   `orchestration.message`) с отдельными правами. Тогда всё идёт через одобряемые capabilities.
2. Временно читать через CLI только счётчики: число items по статусам и число воркеров. Ограничения:
   - белый список команд и флагов в коде;
   - `execFile` без shell, имя бота только как отдельный аргумент;
   - таймаут 10–15 с, `maxBuffer`;
   - никаких `bot chats` и тел сообщений;
   - запуск по событию `agent.status.changed`, а не по таймеру.

   Решение за овнером: это фактически расширение доступа, которого нет в списке прав плагина.

Безопасность, если вариант 2 одобрят:

- только `execFile` с массивом аргументов: `exec` и строка через shell запрещены;
- фиксированный путь к бинарнику;
- имена ботов приходят из `workspace.list` и передаются отдельным аргументом;
- в каждом вызове таймаут и `maxBuffer`;
- из JSON берутся только числа и id, текст наружу не уходит;
- запуск не чаще одного раза на событие, с дебаунсом.
