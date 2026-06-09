#!/usr/bin/env bash
set -euo pipefail
REPO="${1:-/opt/MC-CartoLive}"
BRANCH="${2:-dev}"
cd "$REPO"
PREV_SHA="$(git rev-parse HEAD)"
BAK_NAME="data/meshcore-live.db.bak.$(date +%Y%m%d%H%M%S)"
echo "=== Backing up database ==="
cp data/meshcore-live.db "$BAK_NAME"
echo "=== Pulling latest ==="
git pull origin "$BRANCH"
echo "=== Building and deploying ==="
docker compose up --build -d --remove-orphans
echo "=== Waiting for health ==="
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8080/readyz | grep -q '"ready":true'; then
    echo "=== Deployment healthy ==="
    exit 0
  fi
  sleep 2
done
echo "=== Health check failed, rolling back ==="
docker compose down
cp "$BAK_NAME" data/meshcore-live.db
git checkout "$PREV_SHA"
docker compose up --build -d
echo "=== Rolled back to $PREV_SHA ==="
exit 1
