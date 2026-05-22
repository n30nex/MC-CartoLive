# Production Deployment

## Recommended Shape

Use the current single-container deployment:

- one Go binary serving API, WebSocket, MQTT ingest, and static frontend
- SQLite persisted under `/app/data`
- Docker Compose as the process manager
- HTTPS handled by Cloudflare Tunnel, Caddy, nginx, or another reverse proxy

Do not publish `.env`, live databases, WAL/SHM files, channel secrets, MQTT
credentials, private keys, or local operator config.

## First Deploy

```bash
git clone <your-repo-url>
cd meshcore-canada-live-map
cp .env.example .env
```

Edit `.env`:

```text
PUBLIC_MODE=true
PUBLIC_BASE_URL=https://your-public-hostname.example
MQTT_ENABLED=true
MQTT_USERNAME=<private username>
MQTT_PASSWORD=<private password>
MESHCORE_CHANNEL_SECRETS=<optional private comma-separated secrets>
```

Start:

```bash
docker compose up -d --build
```

Check:

```bash
docker compose ps
curl http://localhost:39476/healthz
curl http://localhost:39476/api/v1/public/state
```

Point your HTTPS tunnel or reverse proxy at:

```text
http://localhost:39476
```

## Upgrades

Back up first, then rebuild:

```bash
docker compose down
mkdir -p backups
copy data\meshcore-live.db* backups\
docker compose up -d --build
```

On Linux/macOS:

```bash
docker compose down
mkdir -p backups
cp data/meshcore-live.db* backups/
docker compose up -d --build
```

If `sqlite3` is installed on the host, you can also create a live backup:

```bash
sqlite3 data/meshcore-live.db ".backup 'backups/meshcore-live.backup.db'"
```

## Restore

Stop the app, replace the database files, then start again:

```bash
docker compose down
copy backups\meshcore-live.db* data\
docker compose up -d
```

On Linux/macOS:

```bash
docker compose down
cp backups/meshcore-live.db* data/
docker compose up -d
```

## Runtime Notes

- Version 1.3 exposes the app version/build in the top project bar. CI builds use
  the Git commit SHA when available; local Docker builds use a timestamp fallback.
- `PUBLIC_BASE_URL` must match the public browser origin so WebSocket origin checks pass.
- `PUBLIC_IATAS` should stay restricted to supported Canada IATA region codes.
- Keep `PUBLIC_MODE=true` on public hosts.
- The compose file mounts `./data` read/write and `./examples` read-only.
- Container logs are rotated by Docker Compose to avoid unbounded local log growth.
- Health checks use `/healthz`, which verifies the app can read SQLite stats.

## Troubleshooting

View logs:

```bash
docker compose logs -f --tail=200
```

Common startup failures:

- `MQTT subscriber auth requires MQTT_USERNAME and MQTT_PASSWORD`: fill private credentials or set `MQTT_ENABLED=false`.
- WebSocket rejected by origin: set `PUBLIC_BASE_URL` to the exact public HTTPS origin.
- Empty map with MQTT disabled: set `FIXTURE_REPLAY_PATH=/app/examples/fixtures/synthetic-live.ndjson` for demo mode.
