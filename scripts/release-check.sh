#!/usr/bin/env sh
set -eu

BASE_URL="${BASE_URL:-http://127.0.0.1:39476}"
BROWSER_SMOKE_BASE_URL="${BROWSER_SMOKE_BASE_URL:-$BASE_URL}"
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

cd "$ROOT/backend"
node "$ROOT/scripts/check-version-sync.mjs"

go test ./...

cd "$ROOT/web"
npm test -- --run
npm run build

cd "$ROOT"
if [ "${SKIP_DOCKER:-0}" != "1" ]; then
  docker compose build
fi

curl -fsS "$BASE_URL/healthz" >/tmp/mc-cartolive-health.json
curl -fsS "$BASE_URL/readyz" >/tmp/mc-cartolive-ready.json
curl -fsS "$BASE_URL/api/v1/public/state" >/tmp/mc-cartolive-state.json

NOW="$(date -u +%s)000"
FROM="$((NOW - 600000))"
curl -fsS "$BASE_URL/api/v1/public/history?from=$FROM&to=$NOW&limit=25" >/tmp/mc-cartolive-history.json
curl -fsS "$BASE_URL/api/v1/public/packets?from=$FROM&to=$NOW&limit=25" >/tmp/mc-cartolive-packets.json
curl -fsS "$BASE_URL/api/v1/public/chat?from=$FROM&to=$NOW&limit=25" >/tmp/mc-cartolive-chat.json
node "$ROOT/scripts/check-public-privacy.mjs" "$BASE_URL"

if [ "${RUN_BROWSER_SMOKE:-0}" = "1" ]; then
  node "$ROOT/scripts/browser-smoke.mjs" --base-url "$BROWSER_SMOKE_BASE_URL"
fi

echo "release check ok for $BASE_URL"
echo "health:  /tmp/mc-cartolive-health.json"
echo "ready:   /tmp/mc-cartolive-ready.json"
echo "state:   /tmp/mc-cartolive-state.json"
echo "history: /tmp/mc-cartolive-history.json"
echo "packets: /tmp/mc-cartolive-packets.json"
echo "chat:    /tmp/mc-cartolive-chat.json"
echo "live confidence:"
grep -Eo '"(packetIngestState|publicCacheState|mapMotionState|liveConfidenceState)":"[^"]+"' /tmp/mc-cartolive-health.json || true
