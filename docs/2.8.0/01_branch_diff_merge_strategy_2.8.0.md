# 01 — Branch Diff and 2.8.0 Merge Strategy

**Target:** merge the useful `dev/deepseek-v4` work into `main` as `2.8.0` after stabilization.

## Current branch readout

`main` is the production baseline and currently identifies as `2.6.3`.

`dev/deepseek-v4` identifies as `2.7.7` and contains a large feature/performance/hardening line. The branch comparison showed dev is ahead of main and not behind it, so the merge should be structurally possible. The risk is not merge conflict risk. The risk is release quality.

## Dev branch features worth merging

These should be preserved for 2.8.0 unless tests prove a specific part must be removed.

### Backend and system hardening

- Public-safe API surface:
  - `/healthz`
  - `/readyz`
  - `/metrics`
  - `/api/v1/public/state`
  - `/api/v1/public/history`
  - `/api/v1/public/history/summary`
  - `/api/v1/public/packets`
  - `/api/v1/public/chat`
  - `/api/v1/public/solar`
  - `/ws/public`
- Public/private route split.
- Runtime counters for MQTT, WebSocket, cache refresh, packet projection, search mode, and backfill status.
- SQLite WAL, busy timeout, cache size, temp-store, mmap, and bounded public queries.
- Public packet path projection table, projection backfill, and FTS search.
- Better package smoke with synthetic and world fixtures.
- Privacy scan hook.
- Resolver and decoder unit tests.
- Public cache refresh off the live request path.
- Solar snapshot support.
- Pruning/maintenance loops.
- Safer Docker runtime defaults.

### Frontend and map features

- Packets Explorer.
- Chat page.
- NetGraph page.
- VCR replay.
- Packet route focus/replay.
- GIF export for selected packet replay.
- OpenFreeMap/3D route arcs, node models, packet comets.
- Original dark/light CARTO map modes.
- Theme/palette controls.
- Node freshness visuals.
- Activity heatmap.
- Cluster role badges.
- Map settings drawer.
- Layer toggles for:
  - clusters
  - activity heatmap
  - nodes
  - node labels
  - routes
  - analysis paths
  - live comets
  - packet residue
  - observer bursts
  - message bubbles
  - 3D node models
  - 3D route arcs
  - 3D packet comets
  - 3D buildings
  - terrain line-of-sight
  - terrain heightmap
  - weather clouds
- Desktop/mobile browser smoke structure.

## Dev branch features that must be fixed before merge

### 1. Service worker / PWA

The dev branch registers a service worker unconditionally in `web/src/main.tsx`. The service worker uses a fixed cache name and cache-first behavior for every non-tile request. That can cache API JSON, stale `index.html`, stale CSS, and stale lazy JS chunks.

This is incompatible with a live dashboard unless fixed.

**2.8.0 default:** service worker disabled unless explicitly enabled.

### 2. Packets projection fallback

`publicPackets()` calls the projection path first. The projection path returns a valid JSON response even when it found no projected packets. If the projection table is incomplete or empty, Packets can look broken even though legacy edge events still exist.

**2.8.0 requirement:** use projection only when the projection window is complete, or fallback to legacy edge conversion when projection is empty/incomplete.

### 3. DB migration

`schema.sql` defines `nodes.supports_multibyte`, and node insert/select/update code uses it. Current `Migrate()` does not add it to old databases. Existing production DBs can fail after upgrade.

**2.8.0 requirement:** idempotent migration helper and migration tests.

### 4. Deploy script

`scripts/deploy.sh` defaults to `dev`, checks host port `8080`, and copies only `data/meshcore-live.db`. Compose exposes host `80` and `39476`, not host `8080`, and WAL mode means single-file copy is unsafe.

**2.8.0 requirement:** script defaults to `dev/deepseek-v4`, checks `127.0.0.1:39476/readyz`, and uses SQLite `.backup` where possible.

### 5. Version sync

Dev currently says `2.7.7` in `VERSION`/web package while Dockerfile defaults still say `2.7.6`. The target is `2.8.0`.

**2.8.0 requirement:** `node scripts/check-version-sync.mjs` passes.

### 6. Browser smoke

Browser smoke still has a `perf` scenario expecting `#/perf` and `.perf-panel`. App code redirects `#/perf` away. That smoke test must be updated so CI catches real failures instead of an obsolete panel.

**2.8.0 requirement:** browser smoke covers live map, setup, Packets, Chat, NetGraph, layer toggles, OpenFreeMap, and service-worker upgrade behavior.

## Merge strategy

### Phase A — Stabilize dev branch

Work only on `dev/deepseek-v4` until green.

```bash
git checkout dev/deepseek-v4
git pull origin dev/deepseek-v4
```

Create a stabilization commit series:

1. `fix(release): disable unsafe service worker by default`
2. `fix(db): add idempotent production migrations`
3. `fix(api): protect public packets projection fallback`
4. `fix(ui): stabilize packets chat and netgraph panels`
5. `fix(deploy): correct droplet deploy script`
6. `test(smoke): update browser smoke for 2.8 panels`
7. `chore(release): bump all metadata to 2.8.0`
8. `docs(release): update documentation for world release 2`

### Phase B — Local release verification

Run:

```bash
node scripts/check-version-sync.mjs

cd backend
go test ./...
go tool govulncheck ./...

cd ../web
npm ci
npm test -- --run
npm run build

cd ..
podman build --format docker -t mc-cartolive-meshcore-live-map:latest .
CONTAINER_RUNTIME=podman RUN_PACKAGE_SMOKE=1 ./scripts/release-check.sh
CONTAINER_RUNTIME=podman RUN_BROWSER_SMOKE=1 ./scripts/release-check.sh
```

Also manually open all pages in a browser.

### Phase C — Final PR

Open a PR:

```text
Title: Release 2.8.0 production ready world release 2

Base: main
Compare: dev/deepseek-v4
```

PR description must include:

- What changed.
- Known fixed blockers.
- Test output.
- Browser smoke screenshots.
- Public privacy scan result.
- Deployment plan.
- Rollback plan.

### Phase D — Merge to main

Only merge after:

- All CI checks pass.
- Browser smoke artifacts show the pages working.
- Manual browser verification is complete.
- The PR is reviewed for secrets/private data.

### Phase E — Deploy Canada release

After merge, deploy the exact tested SHA or release tag to the droplet.

Recommended production branch after merge:

```bash
git checkout main
git reset --hard origin/main
```

Do not deploy a different SHA than the one tested unless all tests are re-run.

## What not to do

- Do not cherry-pick only UI changes without backend migration/API fixes.
- Do not leave service worker enabled by default.
- Do not merge because the branch is “ahead only.”
- Do not let Codex claim browser checks passed without Playwright/manual evidence.
- Do not deploy if Packets, Chat, or NetGraph render an empty broken panel or `.panel-error`.
- Do not deploy if live health works but browser pages fail.
- Do not deploy from a dirty working tree.
- Do not commit `.env`, database files, secrets, WAL/SHM, or local screenshots containing private data.

## 2.8.0 changelog target

```markdown
## 2.8.0 - 2026-06-10

- Promoted the `dev/deepseek-v4` feature line to production-ready World Release 2.
- Stabilized Packets, Chat, and NetGraph with desktop/mobile browser smoke coverage.
- Disabled or hardened service worker behavior so live APIs and lazy chunks cannot be cached stale.
- Fixed public Packets projection fallback so incomplete projections cannot hide valid public route paths.
- Added idempotent SQLite migrations for upgraded production databases, including `nodes.supports_multibyte`.
- Fixed droplet deployment safety: correct branch, correct host health port, safe DB backup, and rollback.
- Bumped all release metadata and documentation to 2.8.0.
- Strengthened package/browser smoke, privacy checks, and release-readiness documentation.
- Improved map/layer UX for original map, OpenFreeMap/3D, heatmap, clusters, terrain, weather, packet replay, and live route analysis.
```
