# 06 — Production Deployment Runbook for `carto.canadaverse.org`

**Target release:** MC-CartoLive `2.8.0`
**Host:** `carto.canadaverse.org`
**Mode:** Canada public release
**Assumption:** all local tests and browser checks already passed.

## Do not deploy until

```markdown
- [ ] 2.8.0 version sync passed
- [ ] Backend tests passed
- [ ] Govulncheck passed
- [ ] Frontend tests/build passed
- [ ] Docker build passed
- [ ] Package smoke passed
- [ ] Browser smoke passed desktop/mobile
- [ ] Public privacy scan passed
- [ ] Manual local browser verification complete
- [ ] Final PR merged or exact dev SHA approved
- [ ] Rollback SHA known
- [ ] DB backup command tested
```

## Safe deployment model

After the final PR is merged, production should normally deploy from `main`.

Before merge, a release candidate can deploy from `dev/deepseek-v4` only if explicitly approved and all tests were run against that exact SHA.

## Pre-deploy local notes

Record:

```bash
git rev-parse HEAD
git status --short
cat VERSION
```

Expected:

```text
2.8.0
```

## SSH to droplet

```bash
ssh <droplet-user>@carto.canadaverse.org
```

Go to repo path:

```bash
cd /opt/MC-CartoLive
```

Adjust path if production uses a different directory.

## Confirm working tree

```bash
git status --short
```

Stop if unexpected files appear.

Expected local-only files may include:

- `.env`
- `data/`
- backups/log artifacts

Never commit or delete secrets accidentally.

## Record current SHA

```bash
PREV_SHA="$(git rev-parse HEAD)"
echo "Previous SHA: $PREV_SHA"
```

## Safe DB backup

Create backup directory:

```bash
mkdir -p backups
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
```

Preferred live SQLite backup:

```bash
if command -v sqlite3 >/dev/null 2>&1 && [ -f data/meshcore-live.db ]; then
  sqlite3 data/meshcore-live.db ".backup 'backups/meshcore-live.$STAMP.db'"
  sqlite3 "backups/meshcore-live.$STAMP.db" "PRAGMA integrity_check;"
else
  echo "sqlite3 missing; using fallback copy. Stop container first if possible."
  docker compose stop meshcore-live-map || docker compose stop || true
  cp -a data/meshcore-live.db* backups/ 2>/dev/null || true
fi
```

## Fetch release code

After merge to main:

```bash
git fetch origin main
git checkout main
git reset --hard origin/main
```

For approved pre-merge release candidate only:

```bash
git fetch origin dev/deepseek-v4
git checkout dev/deepseek-v4
git reset --hard origin/dev/deepseek-v4
```

Verify:

```bash
cat VERSION
git rev-parse HEAD
```

Expected:

```text
2.8.0
```

## Verify `.env` without printing secrets

```bash
grep -E '^(APP_VERSION|PUBLIC_MODE|PUBLIC_BASE_URL|MQTT_ENABLED|MAP_REGION_PRESET|DEFAULT_REGION|PUBLIC_REGIONS|PUBLIC_IATAS|FIXTURE_REPLAY_PATH|VITE_ENABLE_SERVICE_WORKER)=' .env || true
```

Required public settings:

```text
APP_VERSION=2.8.0
PUBLIC_MODE=true
PUBLIC_BASE_URL=https://carto.canadaverse.org
MQTT_ENABLED=true
FIXTURE_REPLAY_PATH=
VITE_ENABLE_SERVICE_WORKER=false
```

Do not print:

- `MQTT_PASSWORD`
- tokens
- private keys
- channel secrets

## Build and start

```bash
docker compose up --build -d --remove-orphans
docker compose ps
```

Logs:

```bash
docker compose logs --tail=180 meshcore-live-map || docker compose logs --tail=180
```

## Host-local health checks

Compose exposes host port `39476`.

```bash
curl -fsS http://127.0.0.1:39476/healthz | jq .
curl -fsS http://127.0.0.1:39476/readyz | jq .
curl -fsS http://127.0.0.1:39476/api/v1/public/state | jq '.stats'
```

If readiness fails, print focused fields:

```bash
curl -fsS http://127.0.0.1:39476/readyz | jq '{
  ready,
  dbReady,
  staticReady,
  publicStateReady,
  cacheAgeMs,
  mqttConnected,
  mqttLastMessageAgeMs,
  packetPathBackfillRemaining,
  publicPacketsProjectionComplete,
  version,
  gitSha,
  buildTime
}'
```

## Host-local Packets/Chat smoke

```bash
NOW=$(date -u +%s)000
FROM=$((NOW - 86400000))

curl -fsS "http://127.0.0.1:39476/api/v1/public/packets?from=$FROM&to=$NOW&limit=25" \
  | jq '.window, .scan, (.packets|length), .packets[0]'

curl -fsS "http://127.0.0.1:39476/api/v1/public/chat?from=$FROM&to=$NOW&limit=25" \
  | jq '.window, (.messages|length), .messages[0]'
```

Empty Packets may be acceptable only if the live network truly has no packet paths, but if production normally has routes this is suspicious. Check projection fallback/backfill counters before accepting.

## Public HTTPS health checks

```bash
curl -fsS https://carto.canadaverse.org/healthz | jq .
curl -fsS https://carto.canadaverse.org/readyz | jq .
curl -fsS https://carto.canadaverse.org/api/v1/public/state | jq '.stats'
```

Packets/Chat:

```bash
NOW=$(date -u +%s)000
FROM=$((NOW - 86400000))

curl -fsS "https://carto.canadaverse.org/api/v1/public/packets?from=$FROM&to=$NOW&limit=25" \
  | jq '.window, .scan, (.packets|length)'

curl -fsS "https://carto.canadaverse.org/api/v1/public/chat?from=$FROM&to=$NOW&limit=25" \
  | jq '.window, (.messages|length)'
```

## Manual public browser checks

Use a real browser with DevTools open. Disable cache.

Open:

```text
https://carto.canadaverse.org/
https://carto.canadaverse.org/#/setup
https://carto.canadaverse.org/#/packets
https://carto.canadaverse.org/#/chat
https://carto.canadaverse.org/#/netgraph
```

Checklist:

```markdown
- [ ] `/` live map loads
- [ ] version/build display says 2.8.0
- [ ] status is live/degraded/quiet but not crashed
- [ ] Packets opens
- [ ] Chat opens
- [ ] NetGraph opens
- [ ] map settings opens
- [ ] OpenFreeMap toggle works
- [ ] original map toggle works
- [ ] layer toggles work
- [ ] mobile 390px works
- [ ] no console errors
- [ ] no page errors
- [ ] no `.panel-error`
- [ ] no service worker stale-cache issue
- [ ] no 404 on assets
- [ ] no API cached forever
```

## Cloudflare/reverse proxy notes

Ensure proxy does not cache live APIs:

Do not cache:

```text
/api/
/healthz
/readyz
/metrics
/ws
```

Safe to cache immutable hashed assets:

```text
/assets/*
```

HTML should be short-cache or no-cache. The service worker is disabled by default for 2.8.0.

## Rollback procedure

If any health/browser check fails:

1. Save logs.
2. Keep DB backup.
3. Roll back code.
4. Rebuild previous version.
5. Confirm health/browser restored.

Commands:

```bash
docker compose logs --tail=300 meshcore-live-map > "backups/deploy-failed-$STAMP.log" 2>&1 || true

git reset --hard "$PREV_SHA"
docker compose up --build -d --remove-orphans

curl -fsS http://127.0.0.1:39476/readyz | jq .
curl -fsS https://carto.canadaverse.org/readyz | jq .
```

Do not restore DB backup unless migration caused irreversible data problems. If DB restore is required:

```bash
docker compose down
cp -a "backups/meshcore-live.$STAMP.db" data/meshcore-live.db
rm -f data/meshcore-live.db-wal data/meshcore-live.db-shm
docker compose up --build -d --remove-orphans
```

Only do this after confirming the backup integrity.

## Recommended improved `scripts/deploy.sh`

Codex should update the repo script roughly like this:

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-/opt/MC-CartoLive}"
BRANCH="${2:-main}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:39476/readyz}"
SERVICE="${SERVICE:-meshcore-live-map}"

cd "$REPO"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Refusing deploy: tracked working tree has changes"
  git status --short
  exit 1
fi

PREV_SHA="$(git rev-parse HEAD)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p backups

echo "Previous SHA: $PREV_SHA"
echo "Deploying branch: $BRANCH"

if command -v sqlite3 >/dev/null 2>&1 && [ -f data/meshcore-live.db ]; then
  sqlite3 data/meshcore-live.db ".backup 'backups/meshcore-live.$STAMP.db'"
  sqlite3 "backups/meshcore-live.$STAMP.db" "PRAGMA integrity_check;"
else
  echo "sqlite3 not available; stopping container for file backup"
  docker compose stop "$SERVICE" || docker compose stop || true
  cp -a data/meshcore-live.db* backups/ 2>/dev/null || true
fi

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

docker compose up --build -d --remove-orphans

for i in $(seq 1 90); do
  if curl -fsS "$HEALTH_URL" | grep -q '"ready":true'; then
    curl -fsS http://127.0.0.1:39476/api/v1/public/state >/dev/null
    echo "Deployment healthy"
    exit 0
  fi
  sleep 2
done

echo "Health check failed, rolling back to $PREV_SHA"
docker compose logs --tail=240 "$SERVICE" || docker compose logs --tail=240 || true
git reset --hard "$PREV_SHA"
docker compose up --build -d --remove-orphans
exit 1
```

## Post-deploy record

Create a release note containing:

```markdown
MC-CartoLive 2.8.0 deployed to carto.canadaverse.org

- Deployed at:
- Branch:
- SHA:
- Previous SHA:
- DB backup:
- Healthz:
- Readyz:
- Public state:
- Packets API:
- Chat API:
- Browser smoke:
- Operator:
- Notes:
```
