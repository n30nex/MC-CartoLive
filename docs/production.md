# Production Deployment

## Recommended Shape

Run MC-CartoLive as one container:

- Go backend serving HTTP APIs, WebSocket, MQTT ingest, and embedded static
  frontend
- SQLite persisted under `/app/data`
- Docker Compose or Podman as the process manager
- HTTPS handled by Cloudflare Tunnel, Caddy, nginx, or another reverse proxy

Do not publish `.env`, live databases, WAL/SHM files, channel secrets, MQTT
credentials, private keys, or local operator config.

## First Deploy

```bash
git clone <your-repo-url>
cd MC-CartoLive
cp .env.example .env
```

Edit `.env`:

```text
PUBLIC_MODE=true
PUBLIC_BASE_URL=https://your-public-hostname.example
MQTT_ENABLED=true
MQTT_USERNAME=<private username>
MQTT_PASSWORD=<private password>
```

Start with Compose:

```bash
docker compose up -d --build
```

Check readiness:

```bash
curl http://localhost:39476/healthz
curl http://localhost:39476/readyz
curl http://localhost:39476/api/v1/public/state
```

Point your HTTPS proxy at `http://localhost:39476`.

## Published Image

Release images are published as:

```text
ghcr.io/n30nex/mc-cartolive:<version>
```

Credential-free demo:

```bash
podman run --rm -p 8080:8080 \
  -e MQTT_ENABLED=false \
  -e PUBLIC_MODE=true \
  -e PUBLIC_BASE_URL=http://localhost:8080 \
  -e FIXTURE_REPLAY_PATH=/app/examples/fixtures/synthetic-live.ndjson \
  ghcr.io/n30nex/mc-cartolive:3.0.1
```

Persistent deployment:

```bash
podman run -d --name mc-cartolive \
  -p 8080:8080 \
  --env-file .env \
  -v mc-cartolive-data:/app/data \
  ghcr.io/n30nex/mc-cartolive:3.0.1
```

The image runs as non-root `appuser`, includes the bundled `mc-diagnose`
operator tool, and exposes `/healthz` as its container healthcheck.

## Upgrades

Back up first.

If `sqlite3` is available:

```bash
sqlite3 data/meshcore-live.db ".backup 'backups/meshcore-live.backup.db'"
```

Otherwise stop the container and copy the database files:

```bash
docker compose down
mkdir -p backups
cp data/meshcore-live.db* backups/
docker compose up -d --build
```

The repo includes `scripts/deploy.sh`, which performs a tracked-tree check,
SQLite backup when available, fetch/reset to the requested branch, Compose
rebuild, readiness wait, and rollback on failure.

## Runtime Notes

- Version 3.0.1 exposes app version, Git SHA, build number, and build time in
  the top project bar and in health/readiness responses.
- `/healthz` is cheap liveness. `/readyz` checks DB, static assets, public state
  readiness, cache freshness, and public-safe runtime status.
- `PUBLIC_BASE_URL` must match the public browser origin for WebSocket origin
  checks.
- `PUBLIC_MODE=true` should remain enabled on public hosts.
- `MAP_REGION_PRESET=world` is the package default. Use `canada` for the hosted
  Canada map, or `custom` with `MAP_BOUNDS=minLat,minLng,maxLat,maxLng`.
- `VITE_APP_ASSET_PACK=world` is the package/default image preset. Build the
  hosted Canada release with `VITE_APP_ASSET_PACK=canada`,
  `VITE_APP_BRAND_NAME=Carto Live Canada`, and
  `VITE_APP_BRAND_URL=https://canadaverse.org/`.
- `PUBLIC_REGIONS` is the preferred public region allowlist. `PUBLIC_IATAS`
  remains as a deprecated 2.x alias for existing Canada env files.
- UI preferences such as theme, palette, map layers, packet visuals, replay state,
  and panel visibility are browser-local.
- Map Studio style choices are browser-local and do not change public API
  output. The Map drawer opens Watch, Explore, Terrain, and Studio mode cards
  before advanced controls.
- OpenFreeMap/3D, terrain, PMTiles profiles, propagation history, Packets,
  Chat, NetGraph, Replay, Waterfall Labs, and static v3 image assets use
  sanitized public APIs and public WebSocket/history data.
- Optional PMTiles basemaps are build-time frontend URLs. Prefer same-origin
  files such as `/tiles/canada.pmtiles`; external HTTPS PMTiles hosts must also
  be allowed by the deployment CSP.

## Diagnostics

Run `mc-diagnose` locally:

```bash
cd backend
go run ./cmd/diagnose --db ../data/meshcore-live.db --region YTR --public-regions "$PUBLIC_REGIONS"
go run ./cmd/diagnose --db ../data/meshcore-live.db --name Corebot --public-regions "$PUBLIC_REGIONS"
```

Inside the container:

```bash
docker compose exec meshcore-live-map /app/mc-diagnose --db /app/data/meshcore-live.db --region YTR --public-regions "$PUBLIC_REGIONS"
```

The diagnostic report uses public-safe map inclusion reasons such as
`mappable`, `missing_coords`, `zero_coords`, `outside_bounds`, and
`iata_filtered` (legacy name for region-filtered records).

## Production Readiness Checklist

- Run backend tests, frontend tests, frontend build, version sync, container
  build, package smoke, privacy scan, browser smoke for changed UI, and live
  smoke after deploy.
- Keep `/healthz`, `/readyz`, `/api/v1/public/state`,
  `/api/v1/public/events`, `/api/v1/public/viewport`, `/api/v1/public/noc`,
  `/api/v1/public/history`, `/api/v1/public/packets`, `/api/v1/public/chat`,
  `/api/v1/public/propagation`, `/api/v1/public/coverage`,
  `/api/v1/public/los/profile`, `/api/v1/public/schema`,
  `/api/v1/public/integrations/home-assistant`, and `/ws/public` in smoke
  coverage.
- Back up `data/meshcore-live.db*` before upgrades.
- Scan public JSON and WebSocket payloads for raw packet hashes, raw hex, full
  public keys, resolver debug fields, broker credentials, channel secrets, and
  operator config.
- Browser-test desktop and mobile layouts after map, panel, or control changes.
