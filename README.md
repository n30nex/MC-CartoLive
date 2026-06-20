# MeshCore MQTT Live Map v3.0.2

**MC-CartoLive** is a single-container public live map for MeshCore MQTT
observations. It ingests broker traffic, stores normalized observations in
SQLite, resolves only high-confidence RF routes, and serves a privacy-safe
MapLibre dashboard for live packet motion, public chat, replay, Packets,
NetGraph, Node List, Labs, and optional propagation/terrain context.

Public instance: [carto.canadaverse.org](https://carto.canadaverse.org/).

## Current Release

Version 3.0.2 is the loading motion polish release. It keeps the one-container
SQLite deployment shape and stable public API while adding:

- shared branded loading primitives for spinners, skeleton rows, loading blocks,
  and stable busy button labels
- animated loading states for Packets, Chat, NetGraph, propagation history,
  route GIF export, replay/Laser Show, live status, and solar fetches
- contextual lazy-workspace fallbacks for Setup, Packets, Nodes, Chat, NetGraph,
  Labs, and Help
- four map modes for Watch, Explore, Terrain, and Studio workflows
- a mobile app-style tabbar and calmer desktop shell for first-class live use
- unified snackbars and reduced-motion-aware app polish
- first-class workspaces for Map, Packets, Chat, Node List, NetGraph, and Labs
- committed `world` and `canada` v3 asset presets for branding, PWA icons,
  social cards, node roles, packet classes, map layers, workspace states, and
  motion effects
- `VITE_APP_ASSET_PACK=world` as the default GHCR/easy-deploy image preset and
  `VITE_APP_ASSET_PACK=canada` for the hosted Canadaverse deployment
- asset-backed packet chips, node role labels, map/layer thumbnails, live comet
  effects, route GIF overlays, OpenFreeMap 3D visuals, and Waterfall backdrops
- an optional manifest-driven Image API/Batch API workflow for future curated
  asset generations; normal builds and runtime stay fully static

The recommended v3.0.2 release path is clone + Compose on a VPS or local host,
optionally behind Cloudflare Tunnel, Caddy, nginx, or another HTTPS reverse
proxy.

## 3.0 Screenshot Tour

These are public UI captures from the 3.0 Canada surface.

### Map, Routes, And Replay

| Live map overview | Route density | Packet flow replay |
| --- | --- | --- |
| <img src="docs/assets/screenshots/3.0.0/map-overview.png" alt="3.0 live map overview" width="320"> | <img src="docs/assets/screenshots/3.0.0/route-density.png" alt="3.0 route density view" width="320"> | <img src="docs/assets/screenshots/3.0.0/packet-flow-replay.png" alt="3.0 packet flow replay across a route" width="320"> |

| OpenFreeMap 3D terrain |
| --- |
| <img src="docs/assets/screenshots/3.0.0/openfreemap-3d-topo.png" alt="3.0 OpenFreeMap 3D terrain and RF routes" width="640"> |

### Workspaces

| Packets | Chat | Node List |
| --- | --- | --- |
| <img src="docs/assets/screenshots/3.0.0/packets-panel.png" alt="3.0 Packets workspace" width="220"> | <img src="docs/assets/screenshots/3.0.0/chat-panel.png" alt="3.0 public Chat workspace" width="220"> | <img src="docs/assets/screenshots/3.0.0/nodes-workspace.png" alt="3.0 Node List workspace" width="320"> |

### NetGraph And Labs

| NetGraph focus | NetGraph overview | Packet Waterfall Labs |
| --- | --- | --- |
| <img src="docs/assets/screenshots/3.0.0/netgraph-focus.png" alt="3.0 NetGraph selected node focus" width="320"> | <img src="docs/assets/screenshots/3.0.0/netgraph-overview.png" alt="3.0 NetGraph connected component overview" width="320"> | <img src="docs/assets/screenshots/3.0.0/labs-waterfall.png" alt="3.0 Packet Waterfall Labs workspace" width="320"> |

## Capabilities

- Read-only MQTT ingest with MeshCore packet decoding.
- SQLite persistence under `data/` locally or `/app/data` in the container.
- Seven-day raw/event/search retention by default, with compact latest-route
  summaries retained so the live route graph survives database pruning.
- Conservative public route resolution; ambiguous or unsafe paths are not drawn.
- Public MapLibre dashboard with clusters, nodes, labels, live packet comets,
  fading trails, message bubbles, route plotting, replay, and optional 3D.
- Packets, Chat, NetGraph, Node List, Labs, and propagation history workspaces
  built from sanitized public data.
- Public-safe health/readiness endpoints and release smoke scripts.
- Worldwide/private broker support through configurable map bounds and region
  labels.

## Quick Start

Credential-free fixture mode is the safest local test path:

```bash
cp .env.example .env
podman build --format docker -t mc-cartolive-meshcore-live-map:latest .
podman run --rm --name mc-cartolive -p 39476:8080 --env-file .env mc-cartolive-meshcore-live-map:latest
```

Open `http://127.0.0.1:39476`.

The published image can also run the synthetic fixture:

```bash
podman run --rm -p 8080:8080 \
  -e MQTT_ENABLED=false \
  -e PUBLIC_MODE=true \
  -e PUBLIC_BASE_URL=http://localhost:8080 \
  -e FIXTURE_REPLAY_PATH=/app/examples/fixtures/synthetic-live.ndjson \
  ghcr.io/n30nex/mc-cartolive:3.0.2
```

For a persistent deployment:

```bash
podman run -d --name mc-cartolive \
  -p 8080:8080 \
  --env-file .env \
  -v mc-cartolive-data:/app/data \
  ghcr.io/n30nex/mc-cartolive:3.0.2
```

The production droplet currently uses Docker Compose; local release validation
uses Podman unless a host is Docker-only.

## Configuration

Start from `.env.example`. Keep real `.env` files private.

Important variables:

| Variable | Notes |
| --- | --- |
| `PUBLIC_MODE` | Use `true` for public deployments. |
| `PUBLIC_BASE_URL` | Must match the public browser origin for WebSocket checks. |
| `MQTT_ENABLED` | `false` for fixtures, `true` for live broker ingest. |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | Private broker credentials. Never commit them. |
| `MESHCORE_CHANNEL_SECRETS` | Optional private extra channel keys for operators. |
| `FIXTURE_REPLAY_PATH` | Synthetic fixture path for repeatable local demos. |
| `MAP_REGION_PRESET` | `world`, `canada`, or `custom`. |
| `VITE_APP_ASSET_PACK` | Build-time frontend asset preset: `world` by default, `canada` for the hosted Canada release. |
| `MAP_BOUNDS` | Custom bounds as `minLat,minLng,maxLat,maxLng`. |
| `PUBLIC_REGIONS` | Public-safe broker region allowlist. Empty allows safe labels. |
| `DB_PATH` | SQLite path inside the container. |
| `DATA_RETENTION_DAYS` | Raw packets, observations, live edge events, public history/search rows, and propagation/weather history retention. Defaults to `7`; latest public route summaries are preserved separately. |
| `PROPAGATION_EVENT_RETENTION_DAYS` | Optional propagation-only override. Defaults to `7`. |
| `VITE_PMTILES_BASEMAP_URL` | Optional same-origin or CSP-allowed PMTiles basemap for offline profiles. |
| `VITE_PMTILES_TERRAIN_URL` | Reserved optional PMTiles terrain archive URL for future terrain swaps. |

## Development

Backend:

```bash
cd backend
go test ./...
go run ./cmd/app
```

Frontend:

```bash
cd web
npm ci
npm test -- --run
npm run build
```

Release hygiene:

```bash
node scripts/check-version-sync.mjs
node scripts/public-schema-check.mjs
node scripts/check-asset-pack.mjs
node scripts/check-frontend-budget.mjs
node scripts/check-public-privacy.mjs http://127.0.0.1:39476
podman build --format docker -t mc-cartolive-meshcore-live-map:latest .
node scripts/package-smoke.mjs --runtime podman --image ghcr.io/n30nex/mc-cartolive:3.0.2 --pull
```

Live post-deploy smoke:

```powershell
.\scripts\live-smoke.ps1 -BaseUrl https://carto.canadaverse.org -ExpectedVersion 3.0.2 -ExpectedGitSha <short-sha> -DiagnoseRegion YTR
```

## Documentation

- [Docs index](docs/README.md)
- [Production deployment](docs/production.md)
- [Development guide](docs/development.md)
- [Operator runbook](docs/operator-runbook.md)
- [Privacy model](docs/privacy.md)
- [Roadmap](docs/roadmap.md)
- [Changelog](CHANGELOG.md)
- [3.0.2 release notes](docs/3.0.2/release_notes.md)
- [3.0.2 validation checklist](docs/3.0.2/validation_checklist.md)
- [3.0.1 release notes](docs/3.0.1/release_notes.md)
- [3.0.1 validation checklist](docs/3.0.1/validation_checklist.md)
- [3.0.0 release notes](docs/3.0.0/release_notes.md)
- [3.0.0 screenshot tour](docs/3.0.0/screenshot_tour.md)
- [3.0.0 asset pack notes](docs/3.0.0/asset_pack.md)
- [3.0.0 validation checklist](docs/3.0.0/validation_checklist.md)
- [2.9.6 release notes](docs/2.9.6/release_notes.md)
- [2.9.5 release notes](docs/2.9.5/release_notes.md)
- [2.9.4 release notes](docs/2.9.4/release_notes.md)
- [2.9.3 release notes](docs/2.9.3/release_notes.md)

## Privacy Boundary

Never commit or expose MQTT credentials, MeshCore private keys, channel secrets,
live SQLite databases, WAL/SHM files, local operator config, or raw packet
captures.

Public APIs must not expose full public keys, observer public keys, packet
hashes, raw payloads, raw path hex, resolver debug reasons, broker secrets, or
private operator config. The only public route-copy identifier is the
six-character MeshCore `pathHash3` prefix.
