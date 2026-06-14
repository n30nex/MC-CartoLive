#!/usr/bin/env sh
set -eu

BASE_URL="${BASE_URL:-http://127.0.0.1:39476}"
BROWSER_SMOKE_BASE_URL="${BROWSER_SMOKE_BASE_URL:-$BASE_URL}"
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-}"
LOCAL_IMAGE="${LOCAL_IMAGE:-mc-cartolive-meshcore-live-map:latest}"

if [ -z "$CONTAINER_RUNTIME" ]; then
  if command -v podman >/dev/null 2>&1; then
    CONTAINER_RUNTIME="podman"
  else
    CONTAINER_RUNTIME="docker"
  fi
fi

cd "$ROOT/backend"
node "$ROOT/scripts/check-version-sync.mjs"
node "$ROOT/scripts/public-schema-check.mjs"
node "$ROOT/scripts/check-asset-pack.mjs"

go test ./...
go tool govulncheck ./...

cd "$ROOT/web"
npm ci
npm audit --audit-level=high
npm test -- --run
npm run build
node "$ROOT/scripts/check-frontend-budget.mjs"

cd "$ROOT"
if [ "${SKIP_DOCKER:-0}" != "1" ] && [ "${SKIP_CONTAINER_BUILD:-0}" != "1" ]; then
  if [ "$CONTAINER_RUNTIME" = "podman" ]; then
    "$CONTAINER_RUNTIME" build --format docker -t "$LOCAL_IMAGE" .
  else
    "$CONTAINER_RUNTIME" build -t "$LOCAL_IMAGE" .
  fi
fi

if [ "${RUN_PACKAGE_SMOKE:-0}" = "1" ]; then
  PACKAGE_IMAGE="${PACKAGE_SMOKE_IMAGE:-$LOCAL_IMAGE}"
  node "$ROOT/scripts/package-smoke.mjs" --runtime "$CONTAINER_RUNTIME" --image "$PACKAGE_IMAGE" --version "$(tr -d '\r\n' < VERSION)"
fi

curl -fsS "$BASE_URL/healthz" >/tmp/mc-cartolive-health.json
curl -fsS "$BASE_URL/readyz" >/tmp/mc-cartolive-ready.json
curl -fsS "$BASE_URL/api/v1/public/state" >/tmp/mc-cartolive-state.json

NOW="$(date -u +%s)000"
FROM="$((NOW - 600000))"
curl -fsS "$BASE_URL/api/v1/public/history?from=$FROM&to=$NOW&limit=25" >/tmp/mc-cartolive-history.json
curl -fsS "$BASE_URL/api/v1/public/history/summary?from=$FROM&to=$NOW&bucketMs=60000" >/tmp/mc-cartolive-history-summary.json
curl -fsS "$BASE_URL/api/v1/public/packets?from=$FROM&to=$NOW&limit=25" >/tmp/mc-cartolive-packets.json
curl -fsS "$BASE_URL/api/v1/public/chat?from=$FROM&to=$NOW&limit=25" >/tmp/mc-cartolive-chat.json
curl -fsS "$BASE_URL/api/v1/public/solar" >/tmp/mc-cartolive-solar.json
curl -fsS "$BASE_URL/api/v1/public/propagation?from=$FROM&to=$NOW&limit=25" >/tmp/mc-cartolive-propagation.json
curl -fsS "$BASE_URL/api/v1/public/events?afterSeq=0&limit=25" >/tmp/mc-cartolive-public-events.json
curl -fsS "$BASE_URL/api/v1/public/noc" >/tmp/mc-cartolive-noc.json
curl -fsS "$BASE_URL/api/v1/public/schema" >/tmp/mc-cartolive-public-schema.json
curl -fsS "$BASE_URL/api/v1/public/integrations/home-assistant" >/tmp/mc-cartolive-sensors.json
curl -fsS "$BASE_URL/metrics" >/tmp/mc-cartolive-metrics.txt
node "$ROOT/scripts/check-public-privacy.mjs" "$BASE_URL"

if [ "${RUN_BROWSER_SMOKE:-0}" = "1" ]; then
  node "$ROOT/scripts/browser-smoke.mjs" --base-url "$BROWSER_SMOKE_BASE_URL"
fi

echo "release check ok for $BASE_URL"
echo "container runtime: $CONTAINER_RUNTIME"
echo "health:  /tmp/mc-cartolive-health.json"
echo "ready:   /tmp/mc-cartolive-ready.json"
echo "state:   /tmp/mc-cartolive-state.json"
echo "history: /tmp/mc-cartolive-history.json"
echo "summary: /tmp/mc-cartolive-history-summary.json"
echo "packets: /tmp/mc-cartolive-packets.json"
echo "chat:    /tmp/mc-cartolive-chat.json"
echo "solar:   /tmp/mc-cartolive-solar.json"
echo "propagation: /tmp/mc-cartolive-propagation.json"
echo "events:  /tmp/mc-cartolive-public-events.json"
echo "noc:     /tmp/mc-cartolive-noc.json"
echo "schema:  /tmp/mc-cartolive-public-schema.json"
echo "sensors: /tmp/mc-cartolive-sensors.json"
echo "metrics: /tmp/mc-cartolive-metrics.txt"
echo "live confidence:"
grep -Eo '"(packetIngestState|publicCacheState|mapMotionState|liveConfidenceState)":"[^"]+"' /tmp/mc-cartolive-health.json || true
