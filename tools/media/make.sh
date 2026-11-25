#!/bin/sh
# Rebuilds docs/media (demo.gif, social-preview.png, social-preview.gif) from the made-up demo office.
# Needs node, ffmpeg and Playwright with a browser (`npm install playwright` in tools/media, then
# `npx playwright install chromium`, or PW_CHANNEL=chrome to use an installed Chrome). Nothing else is downloaded.
#   tools/media/make.sh [work-dir]
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT="$HERE/../.."
WORK="${1:-$(mktemp -d)}"
PORT="${PORT:-18766}"
MEDIA="$ROOT/docs/media"
mkdir -p "$WORK" "$MEDIA"
# The demo harness (fictional bots, no Orca needed), served in the background while recording.
DEMO=1 sh "$ROOT/tools/harness/build.sh" "$WORK/site" "$PORT" > "$WORK/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
until curl -sf "http://127.0.0.1:$PORT/desks.json" > /dev/null; do sleep 0.5; done
URL="http://127.0.0.1:$PORT/"

# demo.gif: 12.5 fps, one palette for all frames, no dithering (pixel art stays crisp), changed rectangles only.
rm -rf "$WORK/demo" && node "$HERE/record.mjs" demo "$URL" "$WORK/site" "$WORK/demo"
ffmpeg -v error -y -framerate 12.5 -i "$WORK/demo/f%04d.png" \
  -filter_complex "split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
  -loop 0 "$MEDIA/demo.gif"

# social-preview.png: the first preview frame with the title band; social-preview.gif: the same, alive (10 fps).
rm -rf "$WORK/preview" && node "$HERE/record.mjs" preview "$URL" "$WORK/site" "$WORK/preview"
node "$HERE/compose-preview.mjs" "$WORK/preview/f0000.png" "$MEDIA/social-preview.png"
ffmpeg -v error -y -i "$MEDIA/social-preview.png" -vf "crop=1280:208:0:432" -update 1 "$WORK/band.png"
ffmpeg -v error -y -framerate 10 -i "$WORK/preview/f%04d.png" -i "$WORK/band.png" \
  -filter_complex "[0][1]vstack,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
  -loop 0 "$MEDIA/social-preview.gif"
ls -l "$MEDIA"
