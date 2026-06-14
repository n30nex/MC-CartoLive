# MC-CartoLive 3.0.0 Operator Notes

3.0.0 is safe to deploy over 2.9.6 with the normal backup, build, smoke, and
rollback flow. It changes frontend assets and release metadata, not public API
response shapes.

## World Image

The default package preset is `world`:

```bash
podman run --rm -p 8080:8080 \
  -e PUBLIC_MODE=true \
  -e MQTT_ENABLED=false \
  -e PUBLIC_BASE_URL=http://localhost:8080 \
  -e FIXTURE_REPLAY_PATH=/app/examples/fixtures/synthetic-live.ndjson \
  ghcr.io/n30nex/mc-cartolive:3.0.0
```

## Canada Droplet

Build the hosted Canada release with:

```text
APP_VERSION=3.0.0
VITE_APP_ASSET_PACK=canada
VITE_APP_BRAND_NAME=Carto Live Canada
VITE_APP_BRAND_URL=https://canadaverse.org/
PUBLIC_BASE_URL=https://carto.canadaverse.org
MAP_REGION_PRESET=canada
```

The public port mapping remains `80:8080` on the droplet.

## Required Checks

Before deploy:

```bash
cd backend && go test ./...
cd ../web && npm test -- --run
npm run build
cd ..
node scripts/check-version-sync.mjs
node scripts/public-schema-check.mjs
node scripts/check-asset-pack.mjs
```

After deploy:

```powershell
.\scripts\live-smoke.ps1 -BaseUrl https://carto.canadaverse.org -ExpectedVersion 3.0.0 -ExpectedGitSha <short-sha> -DiagnoseRegion YTR
```

Confirm `/healthz` reports version `3.0.0`, the expected git SHA, ready state,
and fresh public runtime metadata.
