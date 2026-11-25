# Contributing to Pixel Office

Thanks for wanting to help. A few rules keep the office honest and cheap to run.

## The principles

1. **The office shows only what Orca reports.** A bot's place, signs and numbers come from real Orca data. Decorative
   animation («Жизнь», the cat, fish, steam) is welcome, but it must never look like a status and must give way to a
   real event at once.
2. **Zero tokens.** No calls to language models, no generated text, no chatter between bots. Chat clouds are icons.
3. **Read-only.** The plugin does not write to Orca. New CLI commands go into the allow-list in `plugin/src/cli.ts`
   word for word, with a test; anything that writes is out of scope.
4. **No new access without a reason.** A new capability in `plugin/orca-plugin.json` changes the approval fingerprint
   for every user. Explain why in the pull request.
5. **Your own art only.** Pixel art is drawn in code (`plugin/editor/art.ts`) or shipped as skin packs. No third-party
   sprites, fonts or code unless the licence is compatible with MIT and is named in the pull request.
6. **Draw only when something changes.** One timer for all animation; nothing runs while the tab is hidden.

## Getting started

```sh
cd plugin
orca plugin types .                           # typings into .orca/types
orca plugin test . && orca plugin check .
npx -p typescript@5 tsc -p . --noEmit
DEMO=1 ../tools/harness/build.sh /tmp/po-demo # the office in a browser with made-up bots
orca plugin dev load .                        # the office in Orca, reloading on save
```

All three checks must be green before a pull request.

## Where things are

- `plugin/engine/` — pure logic, no DOM, all of it tested: the map, BFS, seating, status → place, routines, the cat.
- `plugin/editor/` — the tab: rendering, art, the panel, themes and skin packs.
- `plugin/src/` — the trusted worker: what it reads from Orca and how.
- `plugin/office/` — data: `map.json` (the building) and `skins/` (skin packs).
- `docs/` — how it was built (`design-notes.md`), the skin pack format (`skin-packs.md`), the Orca API survey.
- `tools/harness/` — the office outside Orca, for screenshots and quick checks.

## Changes that are easy to accept

- A **skin pack**: see [docs/skin-packs.md](docs/skin-packs.md). Add a line to the pack test if it is shipped.
- A **room or piece of furniture**: a stamp in `map.json` (validated with readable errors) and, for new furniture, a
  type in `engine/catalog.ts` with its picture in `editor/art.ts` and a test that it stays in its box.
- A **routine stop** for «Жизнь»: `engine/life.ts`, with a test in `engine/life.test.ts`.

## Style

- TypeScript, no build step for the plugin itself; small pure functions with tests next to them.
- Comments say why, not what. The UI speaks Russian; code, comments and docs in English (`design-notes.md` is Russian).
- Screenshots in pull requests: use the demo office, never real chats.
- Commit messages: what changed and why, in the imperative.

## Licence

By contributing you agree that your contribution is licensed under the MIT licence of this project.
