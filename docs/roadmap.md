# MC-CartoLive Roadmap

This file tracks the current product direction. Completed release details live
in [CHANGELOG.md](../CHANGELOG.md); operator procedures live in
[operator-runbook.md](operator-runbook.md).

## Current Baseline

Version `3.0.1` is the current smooth live-map shell release on the public-safe
event, operations, Labs, map-runtime, and world-ready packaging foundation.

- Public API shapes remain stable across the 2.8.x, 2.9.x, and 3.0.1 line.
- The default public map is traffic-first: terrain relief, propagation overlays,
  and route lines are opt-in for new visitors.
- The supported deployment shape is one container with the Go backend serving
  the embedded React frontend and SQLite under `/app/data`.
- Local release validation uses Podman; the production droplet can continue to
  use Docker Compose.
- The 3.0.1 frontend keeps committed `world` and `canada` asset presets for
  branding, map/layer affordances, node/packet visuals, workspace states,
  motion effects, and Waterfall backdrops without changing public API shapes.

## Active Focus

- Keep the hosted Canada map stable, readable, and privacy-safe during live
  traffic.
- Keep Packets, Chat, NetGraph, Replay, NodeList, propagation history, Map Studio,
  and 3D optional but easy to discover.
- Keep Waterfall Labs fun, browser-safe, and strictly derived from public DTOs.
- Improve map, offline tile, 3D, asset, and panel UX through small
  API-compatible 3.x patches.
- Keep release evidence concise and current instead of adding more planning
  documents.
- Keep production deployment repeatable with backup, smoke, rollback, privacy
  scan, and live diagnostics.

## Candidate 3.x Work

- Expand the new public event log into more history/replay workflows.
- Iterate on Waterfall Labs with workerized transforms, exportable clips, and
  deeper replay sampling once the public event log grows.
- Continue extracting CanadaMap into runtime overlays using the new registry
  contracts.
- Add a human review lane for future OpenAI-generated asset candidates before
  they become committed deterministic runtime files.
- Add importer tooling for coarse coverage cells and Canada CDEM LOS samples.
- Add more focused browser smoke coverage for PMTiles, terrain, and 3D style
  workflows once fixture assets are available.
- Continue improving operator diagnostics without exposing raw packet data.

## Release Gates

Every production release should pass:

- `cd backend && go test ./...`
- `cd web && npm test -- --run`
- `cd web && npm run build`
- `node scripts/check-version-sync.mjs`
- `node scripts/public-schema-check.mjs`
- `node scripts/check-asset-pack.mjs`
- `node scripts/check-frontend-budget.mjs`
- Podman image build and package smoke
- public privacy scan
- browser smoke for changed UI surfaces
- live smoke after deploy

## Non-Goals

- No raw packet hashes, raw payloads, full public keys, path hex, resolver debug
  fields, broker credentials, channel secrets, or operator config in public
  responses.
- No guessed RF routes. Missing data should be explained by diagnostics, not
  invented on the map.
- No public admin/debug surface without a separate access-control design.
