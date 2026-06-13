#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-/opt/MC-CartoLive}"
BRANCH="${2:-main}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:39476/readyz}"
LOCAL_BASE_URL="${LOCAL_BASE_URL:-http://127.0.0.1:39476}"
SERVICE="${SERVICE:-meshcore-live-map}"
BACKUP_DIR="${BACKUP_DIR:-backups}"

cd "$REPO"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Refusing deploy: tracked working tree has changes"
  git status --short
  exit 1
fi

PREV_SHA="$(git rev-parse HEAD)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"

echo "Previous SHA: $PREV_SHA"
echo "Deploying branch: $BRANCH"
echo "Health URL: $HEALTH_URL"

if command -v sqlite3 >/dev/null 2>&1 && [ -f data/meshcore-live.db ]; then
  DB_BACKUP="$BACKUP_DIR/meshcore-live.$STAMP.db"
  echo "Backing up SQLite database with sqlite3 .backup"
  sqlite3 data/meshcore-live.db ".backup '$DB_BACKUP'"
  sqlite3 "$DB_BACKUP" "PRAGMA integrity_check;"
else
  echo "sqlite3 unavailable or database missing; stopping container for file backup"
  docker compose stop "$SERVICE" || docker compose stop || true
  mkdir -p "$BACKUP_DIR/meshcore-live.$STAMP"
  cp -a data/meshcore-live.db* "$BACKUP_DIR/meshcore-live.$STAMP/" 2>/dev/null || true
fi

echo "Fetching release code"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

DEPLOY_SHA="$(git rev-parse HEAD)"
DEPLOY_SHORT_SHA="$(git rev-parse --short HEAD)"
DEPLOY_VERSION="$(tr -d '\r\n' < VERSION)"
export APP_VERSION="$DEPLOY_VERSION"
export GIT_SHA="$DEPLOY_SHA"
export BUILD_TIME="$STAMP"
export VITE_GIT_SHA="$DEPLOY_SHA"
export VITE_BUILD_TIME="$STAMP"
export VITE_BUILD_NUMBER="$DEPLOY_SHORT_SHA"

echo "Release metadata: version=$APP_VERSION sha=$DEPLOY_SHORT_SHA buildTime=$BUILD_TIME"

echo "Building and starting containers"
docker compose up --build -d --remove-orphans

echo "Waiting for readiness"
for _ in $(seq 1 90); do
  if curl -fsS "$HEALTH_URL" | grep -q '"ready":true'; then
    curl -fsS "$LOCAL_BASE_URL/api/v1/public/state" >/dev/null
    echo "Deployment healthy"
    exit 0
  fi
  sleep 2
done

echo "Health check failed; readiness snapshot follows"
curl -fsS "$HEALTH_URL" | jq '{
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
}' || true

echo "Container logs"
docker compose logs --tail=240 "$SERVICE" || docker compose logs --tail=240 || true

echo "Rolling back to $PREV_SHA"
git reset --hard "$PREV_SHA"
docker compose up --build -d --remove-orphans
exit 1
