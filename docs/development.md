# Development

## Local Docker

```bash
cp .env.example .env
docker compose up --build
```

Open `http://localhost:39476`.

The default public dashboard uses the MapLibre/CARTO dark map on this same
port. Use the in-app map base toggle to switch to OpenFreeMap 3D without
starting a second service.
OpenFreeMap 3D is frontend-only: Three.js is lazy-loaded for the custom 3D
layer, and the existing 2D MapLibre sources still handle labels, hit testing,
selection, and fallback rendering.

The public example starts in fixture mode. To use live MQTT, edit `.env`, set
`MQTT_ENABLED=true`, clear `FIXTURE_REPLAY_PATH`, and add private MQTT
credentials.

Do not commit `.env`, `data/config.yaml`, live databases, or WAL/SHM files.

## Credential-Free Fixture Run

Use this when you do not have MQTT credentials or when testing UI behavior in a
repeatable way.

The committed `.env.example` already uses:

```text
MQTT_ENABLED=false
FIXTURE_REPLAY_PATH=/app/examples/fixtures/synthetic-live.ndjson
```

Then run:

```bash
docker compose up --build
```

The fixture at `examples/fixtures/synthetic-live.ndjson` contains fake public
keys, fake node names, and synthetic decoded message text.
`examples/fixtures/worldwide-r1.ndjson` covers non-Canada coordinates and
private `r1`/`r2` broker regions for worldwide package testing.

## Backend

```bash
cd backend
go test ./...
go run ./cmd/app
```

Useful local debug APIs are available only when `PUBLIC_MODE=false`:

```bash
curl http://localhost:39476/api/v1/live/state
curl "http://localhost:39476/api/v1/debug/resolution?status=ambiguous&limit=50"
curl "http://localhost:39476/api/v1/debug/collisions?hashSize=1"
```

## Frontend

```bash
cd web
npm ci
npm test -- --run
npm run build
```

Vite dev server:

```bash
cd web
npm run dev
```

The frontend expects the Go backend for live API/WebSocket data when running
outside Docker.

Set `VITE_BUILD_NUMBER` when you want a deterministic build label in the top
project bar. Docker and CI builds also pick up `GITHUB_SHA` when present.

## Mobile UI

The mobile layout keeps the map, route motion, packet comets, Live Follow,
and route-copy tools as the primary experience. Secondary panels,
status toasts, the legend, and busy-path lists are hidden by default at small
viewport widths.

## Node Connectivity UI

At detail zoom, click a repeater, observer, room, companion, or sensor to test
the connectivity focus. Directly served routes and direct neighbors should
brighten while unrelated routes and nodes dim. The phonebook panel should put
least-hop useful routes first by default, allow search by city/region/node
label/public ID/route prefix, support distance filtering, and clicking a row
should highlight the shortest valid public route path without changing the
selected source node.

Route lines on the map are intentionally passive: mouse hover should not glow a
route, and clicking a dense route line should either select an overlapping node,
expand a cluster, or clear selection on empty map space.

Escape, the panel close button, and an empty map click should clear node, route,
and phonebook path focus.

## Manual UI Smoke Checklist

Use this checklist after map, playback, or styling changes:

- Node selection, phonebook rows, and route-copy buttons expose only
  six-character `pathHash3` route prefixes.
- Clusters appear below detail zoom; nodes, routes, labels, observer icons,
  packet effects, and message bubbles appear together at detail zoom.
- Live Follow, WebSocket reconnect, and burst pacing resume packet comets
  without duplicate stale bursts.
- Packets replay compacts the panel, pauses live flow, fits the full true path,
  waits briefly, and animates one selected packet path.
- NetGraph opens from the top bar, renders connected public route nodes, supports
  pan/zoom/drag/search, and shows live routed packet comets without exposing raw
  packet IDs or raw path data.
- Long Plot Routes and selected packet paths remain visible while zoomed out
  without revealing every idle route.
- Map Settings layer toggles and packet visual sliders work without unnecessary
  source rebuilds.
- VCR starts hidden, opens without overlap, scrubs the 24h timeline, and returns
  cleanly to live mode.
- Search, compact Legend, panel restore, dark/light mode, and palette choices
  remain readable on desktop and mobile.
- `mc-diagnose` explains missing nodes/observers by region, coordinate status,
  label hints, position source, and mappability reason.

## Release Checks

Run before publishing or opening a pull request:

```bash
cd backend
go test ./...
```

```bash
cd web
npm ci
npm test -- --run
npm run build
```

```bash
docker compose build
```

Smoke check a built container:

```bash
curl http://localhost:39476/healthz
curl http://localhost:39476/readyz
curl http://localhost:39476/api/v1/public/state
curl "http://localhost:39476/api/v1/public/history?limit=10"
curl "http://localhost:39476/api/v1/public/packets?limit=10"
curl "http://localhost:39476/api/v1/public/chat?limit=10"
```

Run a short local soak when validating release automation:

```powershell
.\scripts\soak-check.ps1 -BaseUrl http://127.0.0.1:39476 -DurationMinutes 10 -IntervalSeconds 30
```

Run production smoke from your workstation after a droplet deploy:

```powershell
.\scripts\live-smoke.ps1
```

Use overrides when testing a branch, alternate host, expected build, or another
diagnostic region:

```powershell
.\scripts\live-smoke.ps1 -BaseUrl https://carto.canadaverse.org -ExpectedVersion 2.5.40 -ExpectedGitSha <short-sha> -DiagnoseRegion YTR
```

Scan public JSON surfaces for privacy-boundary regressions while the app is
running:

```powershell
node .\scripts\check-public-privacy.mjs http://127.0.0.1:39476
```

Check local files before committing:

```bash
git status --short --ignored
```

Private files should appear only under ignored output.
