# MC-CartoLive Roadmap

This file tracks the current product direction. Completed release details live
in [CHANGELOG.md](../CHANGELOG.md); operator procedures live in
[operator-runbook.md](operator-runbook.md).

## Current Baseline

Version `2.9.6` is the current Waterfall Labs release on the public-safe event,
operations, Labs, and map-runtime foundation.

- Public API shapes are stable across the 2.8.x and 2.9.x line.
- The default public map is traffic-first: terrain relief, propagation overlays,
  and route lines are opt-in for new visitors.
- The supported deployment shape is one container with the Go backend serving
  the embedded React frontend and SQLite under `/app/data`.
- Local release validation uses Podman; the production droplet can continue to
  use Docker Compose.
- The 2.9.6 frontend keeps the Map Studio foundation and turns Labs into one
  single Packet Waterfall with generated artwork, richer packet motion, and
  opt-in ambient audio without changing public API shapes.

## Active Focus

- Keep the hosted Canada map stable, readable, and privacy-safe during live
  traffic.
- Keep Packets, Chat, NetGraph, Replay, NodeList, propagation history, Map Studio,
  and 3D optional but easy to discover.
- Keep Waterfall Labs fun, browser-safe, and strictly derived from public DTOs.
- Improve map, offline tile, 3D, and panel UX through small API-compatible
  2.9.x patches.
- Keep release evidence concise and current instead of adding more planning
  documents.
- Keep production deployment repeatable with backup, smoke, rollback, privacy
  scan, and live diagnostics.

## Candidate 2.9.x Work

- Expand the new public event log into more history/replay workflows.
- Iterate on Waterfall Labs with workerized transforms, exportable clips, and
  deeper replay sampling once the public event log grows.
- Continue extracting CanadaMap into runtime overlays using the new registry
  contracts.
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
