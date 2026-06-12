# MC-CartoLive Roadmap

This file tracks the current product direction. Completed release details live
in [CHANGELOG.md](../CHANGELOG.md); operator procedures live in
[operator-runbook.md](operator-runbook.md).

## Current Baseline

Version `2.9.0` is the current production-ready visitor UX rollup release.

- Public API shapes are stable across the 2.8.x and 2.9.0 line.
- The default public map is traffic-first: terrain relief, propagation overlays,
  and Known Pathways are opt-in for new visitors.
- The supported deployment shape is one container with the Go backend serving
  the embedded React frontend and SQLite under `/app/data`.
- Local release validation uses Podman; the production droplet can continue to
  use Docker Compose.

## Active Focus

- Keep the hosted Canada map stable, readable, and privacy-safe during live
  traffic.
- Keep Packets, Chat, NetGraph, VCR, NodeList, propagation history, and 3D
  optional but easy to discover.
- Improve map and panel UX through small API-compatible 2.9.x patches.
- Keep release evidence concise and current instead of adding more planning
  documents.
- Keep production deployment repeatable with backup, smoke, rollback, privacy
  scan, and live diagnostics.

## Candidate 2.9.x Work

- Improve mobile panel ergonomics after production feedback.
- Tighten map typography, contrast, and label density on small screens.
- Add focused browser smoke coverage for the most-used visitor workflows.
- Continue reducing frontend source rebuilds and idle animation work.
- Improve operator diagnostics where they explain public-safe map inclusion
  without exposing raw packet data.

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
