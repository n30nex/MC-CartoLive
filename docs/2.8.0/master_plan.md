# 08 — Master Prompt for GPT 5.5 Codex xhigh

Copy this entire prompt into GPT 5.5 Codex xhigh.

```text
You are GPT 5.5 Codex xhigh working on MC-CartoLive.

Repository:
https://github.com/n30nex/MC-CartoLive

Branches:
- main: current production baseline, version 2.6.3
- dev/deepseek-v4: feature branch to stabilize and merge

Target:
- Release version: 2.8.0
- Release name: Production Ready / World Release 2 / Canada Release
- Production host after approval: carto.canadaverse.org

Mission:
Turn dev/deepseek-v4 into the final 2.8.0 production-ready PR, merge it to main only after all tests/browser checks pass, update all documentation to 2.8.0, and deploy the live release to carto.canadaverse.org after approval.

Important user report:
Packets, NetGraph, and Chat pages do not work on the dev branch. Treat #/packets, #/netgraph, and #/chat as P0 release blockers. Do not mark the work complete until all three pages open and work in desktop and mobile browsers with no console errors, page errors, stale service worker failures, missing chunks, layout breakage, or .panel-error fallback.

Use sub-agents to parallelize:
1. Release manager / merge captain
2. Backend database/API agent
3. Frontend panels agent
4. Map/layers/UI/UX agent
5. QA/browser-smoke agent
6. Security/privacy agent
7. Docs/deploy agent

Non-negotiable safety rules:
- Do not commit .env.
- Do not commit MQTT credentials.
- Do not commit live DB files, WAL, SHM, backups, private keys, or operator config.
- Keep PUBLIC_MODE=true for the public host.
- Public APIs must not expose raw packet hex, raw payload hex, full public keys, private MQTT payloads, channel secrets, private config, or debug internals.
- Preserve RF-only route truth. Do not draw fake MQTT-only RF lines.
- Do not deploy to the live droplet until all tests, smoke checks, privacy checks, and manual browser checks pass.
- Before live deploy, back up SQLite with sqlite3 .backup when available.
- Roll back immediately if live health or browser checks fail.

Phase 0 — Reproduce and baseline

1. Check out branch:
   git fetch origin
   git checkout dev/deepseek-v4
   git reset --hard origin/dev/deepseek-v4

2. Record:
   git rev-parse HEAD
   cat VERSION
   git status --short

3. Run current checks and save output:
   node scripts/check-version-sync.mjs || true

   cd backend
   go test ./... || true
   go tool govulncheck ./... || true
   cd ..

   cd web
   npm ci
   npm test -- --run || true
   npm run build || true
   cd ..

4. Run the local container with Podman:
   podman build --format docker -t mc-cartolive-meshcore-live-map:latest .
   podman rm -f mc-cartolive-local 2>/dev/null || true
   podman run -d --name mc-cartolive-local -p 39476:8080 --env-file .env mc-cartolive-meshcore-live-map:latest
   curl -fsS http://127.0.0.1:39476/healthz | jq .
   curl -fsS http://127.0.0.1:39476/readyz | jq .
   curl -fsS http://127.0.0.1:39476/api/v1/public/state | jq '.stats'

5. Open browser DevTools and reproduce:
   http://127.0.0.1:39476/#/packets
   http://127.0.0.1:39476/#/chat
   http://127.0.0.1:39476/#/netgraph

6. Record exact failures:
   - HTTP status
   - API JSON
   - console errors
   - page errors
   - .panel-error
   - dynamic import failure
   - stale service worker
   - CSS/layout issue
   - NetGraph canvas zero-size
   - MapLibre style error

Phase 1 — Release metadata 2.8.0

Bump every version reference to 2.8.0.

Required files include:
- VERSION
- web/package.json
- web/package-lock.json
- Dockerfile, both APP_VERSION args
- docker-compose.yml APP_VERSION defaults
- .env.example
- backend/internal/app/config.go
- web/index.html
- README.md
- CHANGELOG.md
- docs/production.md
- docs/development.md
- docs/roadmap.md
- any release path docs checked by scripts/check-version-sync.mjs

Run:
node scripts/check-version-sync.mjs

Do not continue until it passes.

Phase 2 — Fix service worker / stale chunk risk

Current dev branch registers /sw.js unconditionally and sw.js cache-firsts non-tile requests. This can cache API responses, old index.html, and old lazy chunks.

For 2.8.0:
1. Disable service worker by default using VITE_ENABLE_SERVICE_WORKER=false.
2. Add one-time legacy cleanup that unregisters existing mc-cartolive service workers and deletes old mc-cartolive caches when service worker is disabled.
3. Never cache /api/, /healthz, /readyz, /metrics, /ws, or query-string live data.
4. Add lazy import retry/clear-cache/reload-once helper for Packets, Chat, NetGraph, Setup, NodeList, ShortcutHelp.
5. Add tests and browser smoke for stale SW/chunk recovery.

Acceptance:
- Browser reports no controlling service worker by default.
- APIs are not cached.
- Old service worker clients recover.
- Packets/Chat/NetGraph chunks load after deploy.

Phase 3 — Fix database migrations

Current schema defines nodes.supports_multibyte and node code uses it, but Migrate() does not add it to existing DBs.

Implement:
1. Idempotent addColumnIfMissing helper.
2. Migration for nodes.supports_multibyte.
3. Verify/add migrations for message columns, message_anchor_json, public_packet_paths columns, FTS table, and triggers.
4. Add migration tests using old schema DBs.

Acceptance:
- Old production-like DB migrates.
- UpsertAdvertNode works.
- UpsertObserver/status node works.
- NodeByPublicKey works.
- Nodes works.
- public state cache refresh works.
- no "no such column" errors.

Phase 4 — Fix public Packets projection fallback

Current publicPackets() tries projection first. publicPacketsFromProjection() returns true and writes empty JSON even when projection has zero rows. This can hide valid live_edge_events.

Implement:
1. Gate projection use on PublicPacketPathProjectionComplete(ctx, from, to), or fallback when projection is incomplete/empty.
2. Preserve fast projection path when complete.
3. Preserve filters/search behavior.
4. Record runtime counters for projection served/fallback/errors/search mode.
5. Add tests:
   - legacy edge events exist and projection empty -> packets returned
   - projection complete and empty -> empty is valid
   - projection backfilled -> packets returned from projection
   - filters/search work in FTS and substring modes

Acceptance:
- /api/v1/public/packets is never empty because projection is incomplete while legacy events exist.
- Packets page works.

Phase 5 — Fix Packets, Chat, NetGraph pages

Packets:
- Fix API empty/fallback states.
- Fix panel runtime errors.
- Fix mobile layout.
- Add clear empty/loading/error messages.
- Add browser smoke for selecting/focusing/replaying packet when fixture has packet paths.

Chat:
- Fix API/panel runtime errors.
- Fix mobile layout.
- Add clear empty/loading/error states.
- Add search/region/channel smoke.
- Confirm public-safe message fields only.

NetGraph:
- Fix canvas sizing.
- Add ResizeObserver fallback.
- Assert nonzero canvas dimensions.
- Fix mobile pan/zoom/select.
- Add graph cap warning.
- Add fit/reset if missing or hard to find.
- Add smoke for search and canvas visibility.

Global:
- No .panel-error.
- No console errors.
- No page errors.
- Browser back/forward works.
- Closing panels returns to map.

Phase 6 — Fix map/layers/UI/UX

Audit every layer:
- original map
- light/dark theme
- OpenFreeMap
- terrain heightmap/hillshade
- terrain LOS
- weather clouds
- clusters
- cluster role badges
- nodes
- node labels
- routes
- analysis paths
- live comets
- packet residue
- observer bursts
- message bubbles
- 3D buildings
- 3D node models
- 3D route arcs
- 3D packet comets

Required:
1. Group map settings into Base, Mesh, Live Motion, 3D, Analysis.
2. Add layer availability/disabled state where needed.
3. Weather clouds must be disabled/marked unavailable without API key.
4. Terrain LOS must either work or show "coming soon/unavailable" rather than silently doing nothing.
5. Fix any MapLibre style expression errors.
6. Add mobile-friendly map settings layout.
7. Add presets if time allows: Balanced, Performance Saver, RF Analysis, Presentation, War Drive.

Acceptance:
- Original map and OpenFreeMap both pass browser smoke.
- Layer toggles do not throw console errors.
- Mobile map settings usable.

Phase 7 — Fix deploy script

Update scripts/deploy.sh:
- default branch main after merge, but support dev/deepseek-v4 as argument
- default health URL http://127.0.0.1:39476/readyz
- safe SQLite backup with sqlite3 .backup
- fallback backup copies db* only with container stopped
- record previous SHA
- refuse dirty tracked working tree
- print readiness fields on failure
- rollback to previous SHA and rebuild
- never print secrets

Acceptance:
- Script works on local Compose dry-run.
- Script cannot deploy wrong branch silently.
- Script does not false-fail because of host port 8080.

Phase 8 — CI, smoke, privacy

Update CI:
- run on pull_request
- run on push to main
- run on push to dev/deepseek-v4 or require PR into dev
- backend go test
- govulncheck
- frontend npm audit
- version sync
- frontend tests/build
- docker build
- package smoke
- secret scan
- lint if lint deps are added
- browser smoke where feasible or as an optional required release job

Update browser smoke:
- remove obsolete perf scenario
- add .panel-error global check
- add Packets/Chat/NetGraph checks
- add NetGraph canvas size check
- add service worker disabled/stale upgrade check
- run desktop 1920x1080 and mobile 390x844
- save screenshots/artifacts

Run privacy scan against:
- /api/v1/public/state
- /api/v1/public/history
- /api/v1/public/history/summary
- /api/v1/public/packets
- /api/v1/public/chat
- /api/v1/public/solar
- /metrics
- /healthz
- /readyz

Phase 9 — Full local release gate

Run and capture output:

node scripts/check-version-sync.mjs

cd backend
go test ./...
go tool govulncheck ./...
cd ..

cd web
npm ci
npm test -- --run
npm run build
cd ..

podman build --format docker -t mc-cartolive-meshcore-live-map:latest .
CONTAINER_RUNTIME=podman RUN_PACKAGE_SMOKE=1 ./scripts/release-check.sh
CONTAINER_RUNTIME=podman RUN_BROWSER_SMOKE=1 ./scripts/release-check.sh
node scripts/check-public-privacy.mjs http://127.0.0.1:39476

Manual browser:
http://127.0.0.1:39476/
http://127.0.0.1:39476/#/setup
http://127.0.0.1:39476/#/packets
http://127.0.0.1:39476/#/chat
http://127.0.0.1:39476/#/netgraph

Do not continue if any fail.

Phase 10 — Final PR

Commit to dev/deepseek-v4.

Suggested commit:
fix: stabilize 2.8.0 production release

Open PR:
base main
compare dev/deepseek-v4
title: Release 2.8.0 production ready world release 2

PR must include:
- blocker fixes
- test outputs
- browser smoke artifacts
- privacy scan output
- manual browser checklist
- deploy/rollback plan
- docs update summary

Merge only after checks pass.

Phase 11 — Live deploy to carto.canadaverse.org

After merge/approval:
1. SSH to droplet.
2. cd /opt/MC-CartoLive or actual path.
3. Confirm clean working tree.
4. Backup DB with sqlite3 .backup.
5. Fetch exact release branch/SHA.
6. Verify VERSION=2.8.0.
7. Verify .env public settings without printing secrets:
   - APP_VERSION=2.8.0
   - PUBLIC_MODE=true
   - PUBLIC_BASE_URL=https://carto.canadaverse.org
   - MQTT_ENABLED=true
   - FIXTURE_REPLAY_PATH empty
   - VITE_ENABLE_SERVICE_WORKER=false
8. docker compose up --build -d --remove-orphans
9. Check:
   - http://127.0.0.1:39476/healthz
   - http://127.0.0.1:39476/readyz
   - https://carto.canadaverse.org/healthz
   - https://carto.canadaverse.org/readyz
   - public state
   - public packets
   - public chat
10. Browser check:
   - https://carto.canadaverse.org/
   - https://carto.canadaverse.org/#/packets
   - https://carto.canadaverse.org/#/chat
   - https://carto.canadaverse.org/#/netgraph

If any live check fails:
- collect logs
- preserve DB backup
- rollback to previous SHA
- do not leave production half-upgraded

Final deliverables:
- dev/deepseek-v4 updated and pushed
- final PR to main
- 2.8.0 version sync green
- Packets/Chat/NetGraph fixed
- service worker disabled or safe
- DB migrations safe
- Packets projection fallback safe
- deploy script fixed
- browser smoke green
- docs updated to 2.8.0
- changelog updated
- main merged after approval
- carto.canadaverse.org deployed after green checks
```

## Completion Status

As of 2026-06-11, this master plan is complete as a 2.8.0 local
stabilization and release-gate plan, and public production checks confirm
`carto.canadaverse.org` is serving `2.8.0` from the current `main` SHA. The
release record still needs operator-only backup and rollback evidence that
cannot be proven from public endpoints.

Use `10_release_completion_evidence_2.8.0.md` as the source of truth for the
completed local release gate and the remaining production evidence fields.

## Completed Local Gates

- Version sync passed for `2.8.0`.
- Backend tests passed.
- `govulncheck` passed with no called vulnerabilities.
- Frontend install, audit, tests, and build passed.
- Local container build/run completed with healthy readiness; current local
  release helpers prefer Podman when available.
- Runtime readiness reported `ready: true` and `version: "2.8.0"`.
- Package smoke passed in synthetic and world modes.
- Follow-up Podman package smoke passed on 2026-06-11 with `--runtime podman`.
- Public privacy scan passed.
- Browser smoke passed on desktop `1920x1080` and mobile `390x844`.
- Browser smoke covered Packets, Chat, NetGraph, map settings, OpenFreeMap,
  theme/palette controls, VCR, packet replay, NetGraph canvas sizing, service
  worker disabled checks, and global `.panel-error`/console/page error checks.
- Whitespace check passed.
- Windows release gate passed with package smoke and browser smoke enabled.

## Completed Release Blockers

- Packets page fixed and covered by browser smoke.
- Chat page fixed and covered by browser smoke.
- NetGraph page fixed and covered by browser smoke, including canvas sizing.
- Service worker disabled by default and legacy stale-cache recovery covered.
- Database migrations made safe for old production-like databases.
- Public Packets projection fallback made safe when projection data is missing
  or incomplete.
- Deploy checks and release gates updated for the 2.8.0 deployment shape.
- Public privacy scanning expanded to the required public endpoints and WebSocket
  path.

## Production Deployment Evidence

Public production checks on 2026-06-11 show `carto.canadaverse.org` is already
serving `2.8.0` from `gitSha` `dbe176ea53ee6e23f719b06791382040586e2629` on
`main`.

- `https://carto.canadaverse.org/healthz` returned `ready: true`,
  `version: "2.8.0"`, `mqttConnected: true`, and the deployed Git SHA above.
- `https://carto.canadaverse.org/readyz` returned `ready: true`,
  `dbReady: true`, `staticReady: true`, and `publicStateReady: true`.
- `https://carto.canadaverse.org/api/v1/public/packets?limit=5` returned HTTP
  `200`.
- `https://carto.canadaverse.org/api/v1/public/chat?limit=5` returned HTTP
  `200`.
- `node scripts/check-public-privacy.mjs https://carto.canadaverse.org` passed.
- Codex in-app browser checks passed for `/`, `#/setup`, `#/packets`,
  `#/chat`, and `#/netgraph` on desktop `1920x1080` and mobile `390x844`.
- The in-app browser found no `.panel-error`, no browser error logs, no
  controlling service worker, and nonzero NetGraph canvas dimensions
  (`1898x958` desktop, `390x653` mobile).

## Still Pending Operator-Only Production Evidence

These items cannot be proven from public endpoints and still require operator
confirmation or droplet access:

- Confirm the production SQLite backup file created before deployment.
- Add the backup file, previous SHA, and operator confirmation to
  `10_release_completion_evidence_2.8.0.md` once available.
- Record the previous deployed SHA, backup file path, and operator name.

## Final Completion Rule

The plan may be treated as locally complete and publicly deployed at
`carto.canadaverse.org` based on public health, privacy, API, and browser
checks. The only remaining release-record gap is operator-only evidence for the
production SQLite backup, previous SHA, and rollback handoff.
