#!/usr/bin/env bash
set -euo pipefail
REPO="${1:-/opt/MC-CartoLive}"
BRANCH="${2:-dev/deepseek-v4}"
cd "$REPO"
echo "=== Backing up database ==="
cp data/meshcore-live.db data/meshcore-live.db.bak.$(date +%Y%m%d%H%M%S)
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
cp data/meshcore-live.db.bak.* data/meshcore-live.db 2>/dev/null || true
git checkout HEAD~1
docker compose up --build -d
echo "=== Rolled back ==="
exit 1
