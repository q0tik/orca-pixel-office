#!/bin/sh
# Draws every character skin (tools/media/gallery.ts, the office's own art code) and saves the README gallery to
# docs/screenshots/characters.png. Needs node and Playwright with a browser, like make.sh.
#   tools/media/gallery.sh [work-dir]          then also: open <work-dir>/site/gallery.html?mode=full
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT="$HERE/../.."
WORK="${1:-$(mktemp -d)}"
PORT="${PORT:-18767}"
mkdir -p "$WORK"
DEMO=1 sh "$ROOT/tools/harness/build.sh" "$WORK/site" "$PORT" > "$WORK/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
until curl -sf "http://127.0.0.1:$PORT/desks.json" > /dev/null; do sleep 0.5; done
npx -y esbuild "$HERE/gallery.ts" --bundle --format=esm --target=es2022 --outfile="$WORK/site/gallery.js" --log-level=warning
printf '<!doctype html><meta charset="utf-8"><title>gallery</title><body style="margin:0;background:#111"><canvas style="image-rendering:pixelated"></canvas><script type="module" src="gallery.js"></script>\n' > "$WORK/site/gallery.html"
node "$HERE/shoot-canvas.mjs" "http://127.0.0.1:$PORT/gallery.html?mode=readme&scale=4" "$ROOT/docs/screenshots/characters.png"
