# MC-CartoLive Operator Runbook

## Deploy

```bash
cd /opt/MC-CartoLive
git pull --ff-only
export APP_VERSION=$(cat VERSION)
export VITE_GIT_SHA=$(git rev-parse --short HEAD)
export VITE_BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
export VITE_BUILD_NUMBER=$(date -u +%Y%m%dT%H%M%S)
docker compose build
docker compose up -d
```

## Smoke Check

```bash
curl -fsS http://127.0.0.1/healthz
curl -fsS http://127.0.0.1/readyz
curl -fsS http://127.0.0.1/api/v1/public/state >/tmp/mc-state.json
```

For local release checks:

```bash
scripts/release-check.sh
```

On Windows:

```powershell
.\scripts\release-check.ps1 -BaseUrl http://127.0.0.1:39476
```

To include packaged-image fixture smoke in the local release check:

```powershell
.\scripts\release-check.ps1 -BaseUrl http://127.0.0.1:39476 -RunPackageSmoke
```

The package smoke can also be run directly against a local image, a GHCR tag, or
a GHCR digest:

```powershell
node scripts/package-smoke.mjs --image ghcr.io/n30nex/mc-cartolive:2.7.7 --pull
```

It starts temporary containers for the synthetic fixture and worldwide `r1`
fixture, checks public APIs, and runs the public privacy scanner.

For browser layout smoke during release-candidate UI checks:

```powershell
npm --prefix web exec playwright install chromium
node scripts/browser-smoke.mjs --base-url http://127.0.0.1:39476
```

To include it in the Windows release check:

```powershell
.\scripts\release-check.ps1 -BaseUrl http://127.0.0.1:39476 -RunBrowserSmoke
```

For the production droplet after deploy, run the single live smoke command from
your workstation:

```powershell
.\scripts\live-smoke.ps1
```

Common overrides:

```powershell
.\scripts\live-smoke.ps1 -BaseUrl https://carto.canadaverse.org -SshTarget root@134.122.45.228 -KeyPath "$env:USERPROFILE\.ssh\neonx" -ExpectedGitSha <short-sha> -DiagnoseRegion YTR
```

The live smoke verifies `/healthz`, `/readyz`, public state, public history,
WebSocket hello, deployed version/Git metadata, Docker health, and the bundled
`mc-diagnose` command inside the running container.

## Soak Check

Use a short soak after deploys and a 24h soak before production-candidate tags.
The scripts write local NDJSON artifacts and do not send telemetry anywhere.

Linux/macOS:

```bash
BASE_URL=https://carto.canadaverse.org DURATION_MINUTES=1440 INTERVAL_SECONDS=60 scripts/soak-check.sh
```

Windows:

```powershell
.\scripts\soak-check.ps1 -BaseUrl https://carto.canadaverse.org -DurationMinutes 1440 -IntervalSeconds 60
```

The soak fails after repeated bad samples. Normal quiet route periods may show
`mapMotionState=quiet`; failures are based on degraded live confidence, stale
packet ingest, stale public cache, HTTP failures, or decreasing packet totals.

## Diagnose Missing Nodes Or Observers

Run the local diagnostic command from the backend folder:

```bash
cd backend
go run ./cmd/diagnose --db ../data/meshcore-live.db --region YTR --public-regions "$PUBLIC_REGIONS"
go run ./cmd/diagnose --db ../data/meshcore-live.db --name Krabs --public-regions "$PUBLIC_REGIONS"
go run ./cmd/diagnose --db ../data/meshcore-live.db --name Corebot --public-regions "$PUBLIC_REGIONS"
go run ./cmd/diagnose --db ../data/meshcore-live.db --label Corebot --public-regions "$PUBLIC_REGIONS"
```

On the production Docker host, use the bundled container binary:

```bash
docker compose exec meshcore-live-map /app/mc-diagnose --db /app/data/meshcore-live.db --region YTR --public-regions "$PUBLIC_REGIONS"
```

Map reasons:

- `mappable`: valid public coordinate and not filtered.
- `missing_coords`: no usable latitude/longitude.
- `zero_coords`: coordinate is `0,0` or one side is zero.
- `outside_bounds`: coordinate is outside configured public map bounds.
- `iata_filtered`: legacy reason name for records outside the public region
  allowlist.

Names are labels, not identity. If a node name contains `YTR` but its broker
region is `YGK`, the map treats it as `YGK`.

The diagnostic output shows `actual_iatas`, `public_iata`, `public_regions`,
`coord_status`, `source`, and `label_iata_hint` so coordinate/region truth is
visible without exposing raw keys or packet hashes. The `iata` names are kept in
the report for 2.x database/API compatibility.

## Verify Live Motion

- Top packet total should continue increasing while MQTT is connected.
- `/healthz` should show low `cacheAgeMs`, low `mqttLastMessageAgeMs`,
  `packetIngestState=fresh`, and `liveConfidenceState=fresh` or `quiet`.
- `recentRoutePulseAgeMs` should stay recent when routed traffic exists.
- `mapMotionState=quiet` can be normal when packets are arriving but no routed
  or observer-positioned activity is currently mappable.
- The browser WebSocket status should recover after a forced reconnect and
  packet comets should resume without duplicated stale bursts.

## Backup And Restore

Before upgrades:

```bash
mkdir -p backups
cp data/meshcore-live.db* backups/
```

If `sqlite3` is installed:

```bash
sqlite3 data/meshcore-live.db ".backup 'backups/meshcore-live.backup.db'"
```

Restore by stopping the container, copying the database files back into
`data/`, then starting Docker Compose again.

## Privacy Check

Before release, inspect public responses and WebSocket payloads for forbidden
fields or values:

- raw packet hashes
- raw payload/path hex
- full public keys
- resolver debug fields
- broker credentials
- channel secrets
- local operator config
