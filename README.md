# MeshCore MQTT Live Map v2.9.4

Also known as **MC-CartoLive**.

MC-CartoLive is a single-container public live map for MeshCore MQTT
observations. It ingests MeshCore broker traffic, stores normalized
observations in SQLite, resolves only high-confidence RF routes, and serves a
privacy-safe MapLibre dashboard with live packet motion, public chat, replay,
Packets, NetGraph, and optional propagation/terrain context.

Public instance: [carto.canadaverse.org](https://carto.canadaverse.org/).

## Current Release

Version 2.9.4 is the Labs polish update on the public-safe 2.9 foundation. It
keeps the one-container SQLite deployment shape while adding:

- a routed Labs dropdown with individual experiment pages under `#/lab/*`
- a fullscreen Labs workbench with tuned responsive layouts and canvas sizing
- richer per-experiment signal context, cue chips, and inspector metrics
- polished Canvas treatments for RF synth, waterfall, sequencer, route
  organism, constellation, aurora, DJ booth, radar, and message fireflies
- a restrained weather cloud layer that fades out before detail-map mode
- focused tests, browser-smoke coverage, and release documentation for Labs

The recommended v2.9.4 release path is clone + Compose on a VPS or local host,
optionally behind Cloudflare Tunnel, Caddy, nginx, or another HTTPS reverse
proxy.

## Screenshots

Real public map data from the production UI:

![Canada cluster overview](docs/assets/screenshots/canada-clusters.png)

![Toronto live route detail](docs/assets/screenshots/toronto-detail.png)

![Ottawa live route detail](docs/assets/screenshots/ottawa-detail.png)

## Capabilities

- Read-only MQTT ingest with MeshCore packet decoding.
- SQLite persistence under `data/` locally or `/app/data` in the container.
- Conservative public route resolution; ambiguous or unsafe paths are not drawn.
- Public MapLibre dashboard with clusters, nodes, labels, live packet comets,
  fading trails, message bubbles, route plotting, VCR replay, and optional 3D.
- Packets, Chat, NetGraph, NodeList, and propagation history panels built from
  sanitized public data.
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
  ghcr.io/n30nex/mc-cartolive:2.9.4
```

For a persistent deployment:

```bash
podman run -d --name mc-cartolive \
  -p 8080:8080 \
  --env-file .env \
  -v mc-cartolive-data:/app/data \
  ghcr.io/n30nex/mc-cartolive:2.9.4
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
| `MAP_BOUNDS` | Custom bounds as `minLat,minLng,maxLat,maxLng`. |
| `PUBLIC_REGIONS` | Public-safe broker region allowlist. Empty allows safe labels. |
| `DB_PATH` | SQLite path inside the container. |

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
node scripts/check-public-privacy.mjs http://127.0.0.1:39476
podman build --format docker -t mc-cartolive-meshcore-live-map:latest .
node scripts/package-smoke.mjs --runtime podman --image ghcr.io/n30nex/mc-cartolive:2.9.4 --pull
```

Live post-deploy smoke:

```powershell
.\scripts\live-smoke.ps1 -BaseUrl https://carto.canadaverse.org -ExpectedVersion 2.9.4 -ExpectedGitSha <short-sha> -DiagnoseRegion YTR
```

## Documentation

- [Docs index](docs/README.md)
- [Production deployment](docs/production.md)
- [Development guide](docs/development.md)
- [Operator runbook](docs/operator-runbook.md)
- [Privacy model](docs/privacy.md)
- [Roadmap](docs/roadmap.md)
- [Changelog](CHANGELOG.md)
- [2.9.4 release notes](docs/2.9.4/release_notes.md)
- [2.9.4 validation checklist](docs/2.9.4/validation_checklist.md)
- [2.9.3 release notes](docs/2.9.3/release_notes.md)

## Privacy Boundary

Never commit or expose MQTT credentials, MeshCore private keys, channel secrets,
live SQLite databases, WAL/SHM files, local operator config, or raw packet
captures.

Public APIs must not expose full public keys, observer public keys, packet
hashes, raw payloads, raw path hex, resolver debug reasons, broker secrets, or
private operator config. The only public route-copy identifier is the
six-character MeshCore `pathHash3` prefix.
