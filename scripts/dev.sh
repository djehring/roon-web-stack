#!/usr/bin/env bash
# Start the local bridge so API and UI rebuild when source changes.
# Serves the Angular app from the API (http://localhost:3000 and
# https://localhost:3443). Refresh the browser after a UI rebuild.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # The stack wants Node >= 22.6.0. .nvmrc pins an exact version that may not
  # be installed, so fall back to any Node 22, then to whatever is on PATH.
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use >/dev/null 2>&1 || nvm use 22 >/dev/null 2>&1 || true
fi

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if (( node_major < 22 )); then
  echo "warning: Node $(node --version 2>/dev/null) is below the required v22.6.0" >&2
fi

API_BIN="$ROOT/app/roon-web-api/bin"
WEB_LINK="$API_BIN/web"
NG_DIST="$ROOT/app/roon-web-ng-client/dist/roon-web-ng-client/browser"

mkdir -p "$API_BIN" "$(dirname "$NG_DIST")"
ln -sfn "$NG_DIST" "$WEB_LINK"

yarn workspace @djehring/roon-web-api kill-ports >/dev/null 2>&1 || true
# webpack/nodemon also take the inspector port.
if command -v kill-port >/dev/null 2>&1; then
  kill-port 9229 >/dev/null 2>&1 || true
fi

echo "API watch  → http://localhost:3000  https://localhost:3443"
echo "UI watch   → $NG_DIST (served as $WEB_LINK)"
echo "Ctrl-C stops both."

pids=()
cleanup() {
  trap - INT TERM EXIT
  for pid in "${pids[@]+"${pids[@]}"}"; do
    kill "$pid" 2>/dev/null || true
  done
  pkill -f "roon-web-api/bin/app.js" 2>/dev/null || true
  pkill -f "ng build --watch" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Deliberately not `start:debug`: that pipes webpack through pino-pretty, which
# buffers when stdout is not a terminal, so nodemon never reported the server
# starting. Raw webpack keeps the NodemonPlugin restart working either way.
NODE_ENV=development LOG_LEVEL=debug NODE_OPTIONS=--no-deprecation \
  yarn workspace @djehring/roon-web-api exec webpack --watch &
pids+=("$!")
# Rebuilds the files Fastify serves. Does not hot-reload the browser.
yarn workspace @djehring/roon-web-ng-client watch &
pids+=("$!")

wait
