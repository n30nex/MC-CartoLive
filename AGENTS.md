# AGENTS.md

## Scope

These instructions apply to the whole repository.

## Repository Overview

This repo is **MeshCore MQTT Live Map / MC-CartoLive**, a Dockerized public live map for MeshCore Canada RF observations. It ingests MeshCore MQTT topics, stores normalized observations in SQLite, resolves only high-confidence RF routes, and serves a privacy-safe public MapLibre dashboard.

The deployment shape is intentionally simple:

- Go backend: HTTP API, WebSocket hubs, MQTT subscriber, MeshCore packet decoding, route resolution, SQLite persistence.
- React/Vite frontend: public live map, route/node visualization, PacketTV, route plotting, phonebook/path-copy tools.
- Docker image: builds the frontend, embeds `web/dist` into the Go binary, and runs a single container.
- SQLite data lives under `data/` locally or `/app/data` in Docker.

## Use Current Library Docs

Use Context7 MCP to fetch current documentation whenever a task asks about a library, framework, SDK, API, CLI tool, or cloud service. This includes API syntax, configuration, version migration, library-specific debugging, setup instructions, and CLI tool usage for dependencies such as React, Vite, Vitest, MapLibre, Go libraries, Docker, or MQTT tooling.

Do not use Context7 for refactoring, writing scripts from scratch, debugging business logic, code review, or general programming concepts.

Context7 workflow:

1. Start with `resolve-library-id` using the library name and the user's question, unless the user provides an exact `/org/project` library ID.
2. Pick the best match by exact name, description relevance, snippet count, source reputation, and benchmark score. Use version-specific IDs when the user mentions a version.
3. Call `query-docs` with the selected library ID and the full user question.
4. Base the answer or implementation on the fetched docs.

## Important Paths

- `backend/cmd/app/main.go`: backend entry point.
- `backend/internal/app/`: configuration, lifecycle, MQTT handling, public cache refresh, fixture replay, route wiring.
- `backend/internal/api/`: HTTP routes, public/internal API boundaries, static file serving.
- `backend/internal/live/`: public response types, WebSocket hub, public cache, route/pulse/activity shaping.
- `backend/internal/meshcore/`: MeshCore packet parsing, payload names, public message decoding/sanitization.
- `backend/internal/mqtt/`: MQTT client, topic parsing, payload normalization, auth config.
- `backend/internal/resolve/`: conservative path resolution and confidence statuses.
- `backend/internal/store/`: SQLite schema and persistence/query layer.
- `backend/tests/`: cross-package backend privacy, resolver, decoder, fixture, and public API tests.
- `web/src/App.tsx`: top-level public dashboard state and UI orchestration.
- `web/src/state.ts`: public snapshot/WebSocket state reducer, live pacing inputs, route traces, observer bursts.
- `web/src/types.ts`: frontend mirror of public API/WebSocket shapes.
- `web/src/map/CanadaMap.tsx`: MapLibre sources/layers, map interactions, cluster/detail modes, live follow, overlays.
- `web/src/map/packetAnimator.ts`: canvas comet, route residue, observer burst animation.
- `web/src/connectivity.ts`: reachable-node graph, phonebook sorting/filtering, MeshCore 3-byte path copy data.
- `web/src/routeTools.ts`: route plotting, bounds intersection, selected-node message history.
- `web/src/components/`: dashboard panels and controls.
- `examples/fixtures/synthetic-live.ndjson`: credential-free synthetic replay data.
- `docs/`: development, production, privacy, and screenshot docs.

## Development Commands

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

Docker:

```bash
docker compose up --build
docker compose build
```

`make test` runs backend tests and the frontend Vitest suite, assuming dependencies are installed.

## Runtime Configuration

- Copy `.env.example` to `.env` for local Docker runs.
- The committed example defaults to synthetic fixture mode with `MQTT_ENABLED=false` and `FIXTURE_REPLAY_PATH=/app/examples/fixtures/synthetic-live.ndjson`.
- To use live MQTT, set `MQTT_ENABLED=true`, clear `FIXTURE_REPLAY_PATH`, and add private MQTT credentials in `.env`.
- Public Docker port is `39476:8080`.
- `PUBLIC_BASE_URL` must match the public browser origin so WebSocket origin checks pass.
- Keep `PUBLIC_MODE=true` for public deployments. Internal debug routes are available only when `PUBLIC_MODE=false`.

## Privacy And Security Rules

This project has a strict public data boundary. Never commit, log, expose in public APIs, or include in screenshots/issues:

- real `.env` values or any `.env.*` except `.env.example`
- MQTT usernames/passwords
- MeshCore private keys
- channel/group secrets
- live SQLite databases, WAL files, or SHM files
- `data/config.yaml` operator overrides
- raw packet captures copied from live traffic

Public responses must not expose:

- full public keys or observer public keys
- packet hashes
- raw packet summaries
- raw path hex
- resolver debug reasons
- raw payloads or private broker data

The only public route-copy identifier is the six-character `pathHash3` MeshCore 3-byte prefix. Do not expand it into full keys.

When changing public API shaping, route pulses, message bubbles, node labels, or route-copy behavior, run backend public/privacy tests and inspect serialized output for forbidden fields.

## Backend Invariants

- Public routes must be drawn only from high-confidence RF paths. Do not guess ambiguous or unresolved routes.
- `resolve.Resolver` accepts only one forwarder-capable candidate per path prefix. Duplicate prefixes, collisions, non-forwarder roles, missing candidates, missing coordinates, missing RF evidence, and distance-gated segments must not produce public route edges.
- Non-trace 4-byte paths are invalid for map rendering; trace payloads are the allowed exception.
- `STRICT_RF_ONLY`, `REQUIRE_RSSI_OR_SNR_FOR_EDGE`, `MAX_UNVERIFIED_EDGE_KM`, and `ALLOW_LONG_TRACE_EDGES` are route-truth controls. Treat changes here as public behavior changes.
- Public IATA allowlists are exact 3-letter entries. Wildcards must not grant access.
- Public state is served from `live.PublicStateCache` when warm; live WebSocket events also update that cache.
- `/healthz`, `/api/v1/public/state`, `/ws/public`, and static frontend files are public. `/api/v1/live/*`, `/api/v1/debug/*`, `/api/v1/nodes*`, `/api/v1/packets*`, and `/ws` must stay blocked in `PUBLIC_MODE=true`.
- `backend/internal/api/static` is populated by the Docker/frontend build. Treat it as generated output except for the committed placeholder.

## Frontend Invariants

- `web/src/types.ts` must match the sanitized public API and WebSocket schema from `backend/internal/live/public.go`.
- `App.tsx` hydrates `/api/v1/public/state`, connects to `/ws/public`, paces events by `displayAt`, and falls back to polling. Preserve this resilience when changing live state.
- `CanadaMap.tsx` owns MapLibre sources/layers and high-frequency map interactions. Keep expensive route-source redraws guarded by stable signatures in `routeSource.ts`.
- Cluster mode and detail mode share one boundary: clusters below zoom `7.08`, nodes and routes together at `7.08+`.
- Route lines are intentionally passive. Dense route lines should not steal clicks from nodes; map clicks select nodes, expand clusters, plot routes, or clear selection.
- Live motion uses canvas through `PacketAnimator`; MapLibre layers are for stable route/node/cluster state.
- Mobile layout prioritizes the map, Live Follow, PacketTV, route-copy, and selection. Secondary panels are intentionally hidden or compressed.
- Keep UI text compact and avoid exposing internals, debug reasons, public keys, raw path data, or packet hashes.

## Testing Guidance

Use focused tests first, then broaden based on risk:

- Backend privacy/public API/schema changes: `cd backend && go test ./...`
- MeshCore decoding/resolver changes: `backend/tests/decoder_test.go`, `backend/internal/resolve/*`, then `go test ./...`
- MQTT topic/payload normalization: `backend/internal/mqtt/*_test.go`
- Public cache or WebSocket pacing: `backend/internal/live/*_test.go` plus frontend live state tests.
- Frontend state/pacing changes: `cd web && npm test -- --run web/src/state.test.ts web/src/livePacing.test.ts`
- Map routes/clusters/animation changes: run relevant tests in `web/src/map/*.test.ts`, then the full Vitest suite.
- Connectivity, phonebook, route-copy, or plotting changes: `web/src/connectivity.test.ts`, `web/src/routeTools.test.ts`, and related component behavior.
- Before release or deployment work: backend tests, full frontend tests, `npm run build`, and `docker compose build`.

## Coding Style

- Follow existing package/module boundaries. Avoid unrelated refactors.
- Go code should be `gofmt`/`go test` clean and use the standard library plus existing dependencies unless there is a clear need.
- TypeScript is strict and ESM. Keep public data transformations typed and covered by Vitest.
- Prefer pure helper modules with tests for route math, graph/path logic, live pacing, and formatting.
- Keep React components focused on rendering and event wiring; put reusable logic in helpers such as `state.ts`, `connectivity.ts`, `routeTools.ts`, or `web/src/map/*`.
- Use existing lucide icons and existing CSS conventions for frontend controls.
- Do not add new secrets, sample live data, or real packet captures. Use synthetic fixtures for reproducible examples.

## Worktree Notes

This repo may have active uncommitted work. Check `git status --short` before editing, avoid overwriting unrelated changes, and keep edits scoped to the requested files.

## Shared Canadaverse hygiene

- Inspect `git status --short --branch` and recent commits before editing; preserve unrelated and concurrent work.
- Use a scoped `codex/<task>` branch or isolated worktree. Never force-push or reset shared work.
- On the shared Windows workstation, keep builds, caches, worktrees, and temporary files on `F:`; use the platform workspace elsewhere. Do not commit generated caches, logs, device backups, or downloaded artifacts.
- Never commit credentials, `.env` files, Wi-Fi/MQTT passwords, API keys, Cloudflare tokens, MeshCore private keys, live databases, packet captures, or user messages.
- Resolve the exact device, build environment, artifact, offset, host, service, and rollback boundary before hardware or deployment work.
- Preserve firmware identity/settings and unrelated Pi services by default.
- Run focused checks plus `git diff --check`; use the repository's existing CI/release path rather than creating a parallel one.
- Release and deployment claims require exact-commit artifacts and observable verification. Mark anything not physically or publicly tested as unverified.
