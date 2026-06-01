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
MESHCORE_CHANNEL_SECRETS=<optional private comma-separated extra channel keys>
```

Start:

```bash
docker compose up -d --build
```

Check:

```bash
docker compose ps
curl http://localhost:39476/healthz
curl http://localhost:39476/readyz
curl http://localhost:39476/api/v1/public/state
```

Point your HTTPS tunnel or reverse proxy at:

```text
http://localhost:39476
```

## Published Image Deploy

Release tags publish a built image to GitHub Container Registry:

```text
ghcr.io/n30nex/mc-cartolive:<version>
```

Credential-free demo mode works without a checkout because the synthetic fixture
is copied into the image:

```bash
docker run --rm -p 8080:8080 \
  -e MQTT_ENABLED=false \
  -e PUBLIC_MODE=true \
  -e PUBLIC_BASE_URL=http://localhost:8080 \
  -e FIXTURE_REPLAY_PATH=/app/examples/fixtures/synthetic-live.ndjson \
  ghcr.io/n30nex/mc-cartolive:2.5.19
```

For production, keep private settings in an env file and mount persistent data:

```bash
docker run -d --name mc-cartolive \
  -p 8080:8080 \
  --env-file .env \
  -v mc-cartolive-data:/app/data \
  ghcr.io/n30nex/mc-cartolive:2.5.19
```

The published image runs as non-root `appuser`, includes OCI source/version
labels, includes the bundled `mc-diagnose` operator tool, and exposes `/healthz`
as its Docker healthcheck.

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

- Version 2.5.19 exposes the app version/build in the top project bar. CI builds use
  the Git commit SHA when available; local Docker builds use a timestamp fallback
  plus a separate ISO build time for build-age display.
- Runtime liveness and readiness are split: `/healthz` stays cheap for Docker
  liveness, while `/readyz` verifies DB ping, public cache readiness, static
  frontend availability, and public-safe runtime status.
- Version 2.5.19 also exposes public-safe public-cache truncation counts,
  packet-search scan pressure, and packet-count refresh latency/failures so
  operators can spot scale pressure without exposing private packet material.
- The Guide overlay links to the Setup page, which generates public-safe `.env` starter snippets for
  world, Canada, and custom private-broker deployments. It is a convenience for
  first-run operators; MQTT credentials and channel secrets still belong only in
  private env files or host secret stores.
- Live confidence is separated into packet ingest freshness, public cache
  freshness, route motion, observer motion, and map motion. Packet ingest should
  normally be less than five seconds stale on production traffic.
- Docker Compose forwards optional `VITE_BUILD_NUMBER`, `VITE_GIT_SHA`,
  `VITE_BUILD_TIME`, `VITE_OPENFREEMAP_STYLE_URL`,
  `VITE_OPENFREEMAP_TILEJSON_URL`, `VITE_TERRAIN_TILEJSON_URL`, and
  `VITE_TERRAIN_EXAGGERATION` build args so release builds can link directly
  to the source commit and operators can choose self-hosted OpenFreeMap/terrain
  TileJSON sources.
- Docker Compose also forwards optional `VITE_APP_BRAND_NAME`,
  `VITE_APP_BRAND_URL`, and `VITE_APP_BRAND_LOGO` build args. Package installs
  default to generic MC-CartoLive branding; the hosted Canada deployment can set
  MeshCore Canada branding in its private `.env`.
- `PUBLIC_BASE_URL` must match the public browser origin so WebSocket origin checks pass.
- `MAP_REGION_PRESET=world` is the package default. Use `canada` for the
  hosted Canada map or `custom` with `MAP_BOUNDS=minLat,minLng,maxLat,maxLng`
  for private regional deployments.
- `PUBLIC_REGIONS` is the preferred public allowlist. Empty means all safe
  broker region labels are allowed. `PUBLIC_IATAS` remains a deprecated alias
  for existing Canada env files.
- Keep `PUBLIC_MODE=true` on public hosts.
- The compose file mounts `./data` read/write and `./examples` read-only.
- Container logs are rotated by Docker Compose to avoid unbounded local log growth.
- Health checks use `/healthz`, which avoids SQLite reads during normal liveness
  checks. Use `/readyz` for deployment smoke checks and host monitoring.
- Public history replay uses cached public location indexes and a short-lived
  timeline summary cache to reduce SQLite pressure during VCR polling.
- Local operator diagnostics can explain map-inclusion decisions without adding
  a public debug API:

```bash
cd backend
go run ./cmd/diagnose --db ../data/meshcore-live.db --region YTR --public-regions "$PUBLIC_REGIONS"
go run ./cmd/diagnose --db ../data/meshcore-live.db --name Krabs --public-regions "$PUBLIC_REGIONS"
go run ./cmd/diagnose --db ../data/meshcore-live.db --label Corebot --public-regions "$PUBLIC_REGIONS"
```

On a Docker host, run the bundled diagnostic binary inside the container:

```bash
docker compose exec meshcore-live-map /app/mc-diagnose --db /app/data/meshcore-live.db --region YTR --public-regions "$PUBLIC_REGIONS"
```

The report uses the same mappability reasons as the public-state builder:
`mappable`, `missing_coords`, `zero_coords`, `outside_bounds`, and
`iata_filtered` (legacy name for region-filtered records). It also reports
actual region/IATA values, public allowlist status, coordinate status, label
hints, and whether the position came from a node or observer record.
- SQLite runs in WAL mode with a busy timeout. For long-running hosts, keep
  regular backups and periodically restart/rebuild during maintenance windows
  if WAL files grow unexpectedly.
- Route glow, cluster role badges, hover-only ordinary labels, the VCR playback
  surface, live pulse clock, NetGraph, and the Original/OpenFreeMap map toggle
  use only sanitized public state, WebSocket events, and public history
  endpoints.
- OpenFreeMap 3D uses a lazy Three.js custom layer for procedural node models,
  elevated route arcs, observer glows, and 3D packet comet trails. The 2D
  MapLibre layers remain in place for labels, clicks, selection, fallback
  rendering, and mobile safety.
- Dark/light mode, palette choice, VCR open state, Packets panel mode, Map
  Settings layer/packet visuals, and panel visibility are
  browser-local UI preferences. They do not require database or API migrations.

## Production Readiness Checklist

- Keep `/healthz`, `/readyz`, `/api/v1/public/state`, `/api/v1/public/history`,
  `/api/v1/public/packets`, `/api/v1/public/chat`, and `/ws/public` checks in
  every deploy smoke test.
- Track websocket fanout, WebSocket queue drops, MQTT connectivity, MQTT last
  message age, packet ingest freshness, public cache age, route/observer motion,
  public history latency/errors, SQLite read/write errors, and static asset
  serving errors in logs or host monitoring.
- Back up `data/meshcore-live.db*` before upgrades and document the restore
  path for the host running Docker Compose.
- Audit public JSON responses before each release for raw packet hashes, raw
  hex payloads, full public keys, resolver debug fields, private MQTT payloads,
  and private operator config.
- Browser-test the live container at desktop and narrow mobile widths after UI
  changes, especially hidden/open VCR offsets, bottom-left action dock, compact
  Legend under Search, map toggles, palette contrast, and replay history.
- Run `scripts/release-check.ps1` on Windows or `scripts/release-check.sh` on
  Linux/macOS before tagging or after deploying.
- Run `scripts/live-smoke.ps1` from your workstation after production deploys
  to verify the public URL, WebSocket hello, deployed build metadata, Docker
  container health, and bundled `mc-diagnose` on the droplet:

```powershell
.\scripts\live-smoke.ps1
```

- Run `scripts/soak-check.ps1` or `scripts/soak-check.sh` for short post-deploy
  validation and for the 24h production-candidate soak. Keep the NDJSON artifact
  with release notes when tagging a production candidate.

## Troubleshooting

View logs:

```bash
docker compose logs -f --tail=200
```

Common startup failures:

- `MQTT subscriber auth requires MQTT_USERNAME and MQTT_PASSWORD`: fill private credentials or set `MQTT_ENABLED=false`.
- WebSocket rejected by origin: set `PUBLIC_BASE_URL` to the exact public HTTPS origin.
- Empty map with MQTT disabled: set `FIXTURE_REPLAY_PATH=/app/examples/fixtures/synthetic-live.ndjson` for demo mode. This fixture is included in the published image and bind-mounted by the clone + Compose setup.
