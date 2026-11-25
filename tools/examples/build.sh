#!/bin/sh
# The example offices (examples/offices/*) in the dev harness, no Orca needed: one folder per office,
# each with its map, made-up bots (demo.json) and starting looks, served on 127.0.0.1.
#   tools/examples/build.sh <out-dir> [port]     then open http://127.0.0.1:<port>/<name>/?fresh
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT="$HERE/../.."
OUT="${1:?out dir}"
PORT="${2:-18768}"
mkdir -p "$OUT"
npx -y esbuild "$ROOT/plugin/editor/main.ts" --bundle --format=esm --target=es2022 --outfile="$OUT/main.js" --log-level=warning
for dir in "$ROOT"/examples/offices/*/; do
  name=$(basename "$dir")
  site="$OUT/$name"
  rm -rf "$site" && mkdir -p "$site/editor"
  cp -r "$ROOT/plugin/office" "$site/office"
  cp "$dir/map.json" "$site/office/map.json"
  cp "$ROOT/tools/harness/index.html" "$ROOT/tools/harness/fake-orca.js" "$site/"
  cp "$OUT/main.js" "$site/editor/main.js"
  node "$HERE/mock.mjs" "$dir/demo.json" "$site"
  echo "$name: http://127.0.0.1:$PORT/$name/?fresh"
done
exec python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$OUT"
