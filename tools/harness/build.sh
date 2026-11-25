#!/bin/sh
# Dev harness: the office tab outside Orca, with a stand-in `orca` (fake-orca.js) and a snapshot of
# the worker's answer. Builds into a folder outside the repo and serves it on 127.0.0.1.
#   tools/harness/build.sh <out-dir> [port]      then open http://127.0.0.1:<port>/
#   DEMO=1 tools/harness/build.sh <out-dir>     a made-up office (tools/harness/demo.js), no Orca needed
# Acts for headless screenshots go in the URL: #acts=[{"wheel":[x,y,dx,dy,ctrl]},{"drag":[x1,y1,x2,y2]},
# {"key":"+"},{"state":["bot-2","working"]},{"wait":1500}]
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
PLUGIN="$HERE/../../plugin"
OUT="${1:?out dir}"
PORT="${2:-18765}"
mkdir -p "$OUT/editor"
rm -rf "$OUT/office" && cp -r "$PLUGIN/office" "$OUT/office"
cp "$HERE/index.html" "$HERE/fake-orca.js" "$OUT/"
if [ -n "$DEMO" ]; then
  node "$HERE/demo.js" "$OUT"
else
# The worker's real answer (names and states only), or an empty office when Orca is not running.
orca plugin dev request "$PLUGIN" office.desks --json 2>/dev/null | jq '.result.result' > "$OUT/desks.json" || echo '{"desks":[],"at":0}' > "$OUT/desks.json"
# Workers and items as the worker reads them (names, states, counts and item titles; no chat text).
orca plugin dev request "$PLUGIN" office.extras --json 2>/dev/null | jq '.result.result | .bots |= map_values(.items.needsYouTitles |= (if . then map("(заголовок скрыт)") else . end))' > "$OUT/extras.json" || true
# Mail metadata as the worker reads it, subjects replaced: who → whom and the type only.
orca plugin dev request "$PLUGIN" office.mail --json 2>/dev/null | jq '.result.result | .entries |= map(.subject = "(тема скрыта)")' > "$OUT/mail.json" || true
fi
npx -y esbuild "$PLUGIN/editor/main.ts" --bundle --format=esm --target=es2022 --outfile="$OUT/editor/main.js"
exec python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$OUT"
