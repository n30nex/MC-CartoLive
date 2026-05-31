# MC-CartoLive 2.5.2 to 2.6.0 Roadmap

Last audited: 2026-05-31

Baseline audited: `v2.5.6` work in progress on `main`

## Audit Coverage

This roadmap is based on an end-to-end repo audit of the current `main` branch:

- Git status, current tag, package versions, Docker/CI workflows, release scripts, and documentation.
- Backend ingest, config, coordinate policy, public cache, state/history/packets APIs, diagnostics, and SQLite access patterns.
- Frontend live state, map rendering, Packets, VCR, NetGraph, OpenFreeMap 3D, themes, mobile chrome, and top-bar help/changelog surfaces.
- Current verification commands:
  - `cd backend && go test ./...`
  - `cd web && npm test -- --run`
  - `cd web && npm run build`

All three local checks passed during the audit. The production build still has large expected vendor chunks, but Vite no longer emits the earlier single-bundle warning.

## Product Promise

The 2.5.2 to 2.6.0 line should harden one promise:

MC-CartoLive should look live, accurate, smooth, explainable, and world-ready while never weakening public privacy boundaries.

That means:

- Real RF routes only. No guessed links from coordinate proximity, names, or map distance.
- Public-safe API compatibility for the 2.x line.
- Worldwide/private broker support by configuration, not Canada-only assumptions.
- Smooth map, Packets, VCR, NetGraph, and OpenFreeMap 3D behavior on modest clients and the 1 GB VPS production shape.
- Operator diagnostics that explain missing data without exposing private packet material.

## Confirmed Findings

### Release And CI

- The CI Docker smoke check previously hardcoded Docker smoke metadata to `2.5.0` while the repo was `2.5.1`. The 2.5.2 foundation patch now reads expected image metadata from `VERSION`; keep this guarded in future releases.
- The hosted app top-bar changelog/help copy had drifted to OpenFreeMap 3D and 2.4-era production tooling. The 2.5.2 foundation patch refreshes it for the 2.5/2.6 track; future releases should update this alongside `CHANGELOG.md`.
- Release metadata is spread across `VERSION`, backend defaults, Docker defaults, web package metadata, docs, CI, and top-bar copy. This invites drift.

### Backend

- Worldwide support is present, but many internal concepts are still named IATA. Public compatibility can stay, but operator-facing language should become `region` first.
- Public cache caps are fixed at 2500 nodes, 2500 routes, 240 recent pulses, and 240 activity records. That is acceptable for the hosted Canada map today, but it can silently truncate larger worldwide installs.
- `Store.Stats()` performs multiple full `COUNT(*)` queries and is called during public cache refresh. This can become noisy as packet tables grow past millions of rows.
- History/packet conversion uses a cached public location index, but the ingestion fallback path still scans all observers when a node lookup misses. That is risky under heavy ingest.
- The public Packets endpoint keeps the response shape compatible and bounded, but rare filters still require scanning/converting multiple edge-event pages. It needs a better public-safe packet path index before 2.6.
- Current health/readiness counters are useful, but they need more actionable fields around cache truncation, slow public packet searches, DB timeouts, and websocket freshness.

### Frontend

- `App.tsx`, `CanadaMap.tsx`, `styles.css`, `packetAnimator.ts`, and `NetGraphPanel.tsx` remain large ownership hotspots. They work, but they raise regression risk.
- `PacketsPanel` can drop a new filter refresh while an older request is in flight because the in-flight guard returns early instead of aborting or queuing the latest request.
- Packets search is described as 24h-capable, but the frontend only scans a bounded number of backend pages for rare filters. The UI should be honest in 2.5.2 and the backend should become indexed in the packet data-plane phase.
- NetGraph still tends to jitter or spread components with too much empty space. It needs a layout-focused pass instead of more visual polish on top of the current force behavior.
- OpenFreeMap 3D is visually strong, but the default style still depends on external OpenFreeMap/terrain resources. Operators need fallback/cache guidance, and the renderer needs stronger LOD/object pooling before 2.6.
- Mobile UI improved in 2.5.1, but the project needs automated browser smoke checks for 390px vertical layouts to stop regressions.
- Theme palettes are improved, but route/path colors still use several static tokens. Palette and light-mode contrast should become semantic and testable.

### Package And Worldwide Readiness

- Package defaults now support world/custom bounds, but the visible brand and many UI/docs references still say MeshCore Canada. Hosted Canada should keep that branding; packaged installs need configurable instance branding by 2.6.
- The project does not need global IATA lists for correctness. It needs generic region labels, configurable allowlists, map bounds, and true route validation through resolver evidence.
- The operator path should prefer `--region` while keeping `--iata` as a compatibility alias.

## 2.5.2 - Release Hygiene, Packets Reliability, And World-Ready Bugfixes

Goal: fix the highest-risk correctness and release issues found in the audit without adding new public features.

Status: completed for the current foundation scope. The first 2.5.2 pass fixed CI version drift, added configurable deployment branding, refreshed top-bar copy, tightened status pills, aligned node icons with the legend, made Packets refreshes abort stale requests, improved VCR timeline readability, and raised route/path contrast. The second pass added public-safe Packets scan summaries, clearer rare-filter states, CI smoke coverage for the worldwide `r1` fixture, and restored decoded text message bubbles in clustered map views.

### Release Hygiene

- Keep CI Docker smoke deriving expected version from `VERSION`.
- Add a small test/script check that fails when `VERSION`, backend default version, Docker defaults, web package version, and CI smoke version drift.
- Refresh top-bar changelog/help/feature copy for every release.
- Add a short `2.5.2` changelog entry focused on bug fixes, not new features.

### Packets Reliability

- Replace the Packets panel in-flight request guard with generation-safe abortable requests.
- Add timeout support to frontend API calls.
- Queue the newest Packets refresh if filters change while a previous request is still unwinding.
- Make rare-filter behavior explicit: show `searching older packets`, `more available`, and `end of 24h window` states based on cursor progress and public-safe scan summaries.
- Add tests for stale request rejection, abort behavior, and filter changes during slow requests.

### Backend Hot Path Fixes

- Replace ingestion fallback observer scans with a direct observer lookup or short-lived observer location cache.
- Add backend tests for observer fallback lookups and region-scoped observer matching.
- Add public-safe health/readiness fields for public cache truncation and keep per-request public packet search scan limits visible in Packets responses.
- Add query-plan or bounded-scan tests for `/api/v1/public/packets`.

### World-Ready Cleanup

- Change user-visible Packets and diagnostics labels from `IATA` to `Region` where public compatibility does not require the old name.
- Keep `iata` fields and params for API compatibility, but document `region` as the preferred operator term.
- Add one non-Canada fixture smoke path that uses `meshcore/r1/...` topics and non-Canada coordinates.

### Live Message Bubbles

- Keep decoded public text bubbles visible above the sender node, or the first observer location when the sender has no mappable coordinates.
- Do not clear message bubbles just because the map is in low-zoom cluster mode; clusters can stay visible while the transient text overlay anchors to the public-safe node or observer coordinate.
- Keep the Map Settings `Message bubbles` toggle as the user control for disabling this overlay.

### Acceptance

- Backend tests pass.
- Frontend tests/build pass.
- Docker build passes.
- Live smoke passes on hosted Canada with `MAP_REGION_PRESET=canada`.
- CI no longer hardcodes stale version values.
- Packets filters no longer leave the panel stuck because a stale request won a race.
- Packets rare-filter searches explain whether older packet paths may still match.
- CI proves the packaged image can replay a non-Canada `world` fixture with generic region labels.
- Decoded public text bubbles appear in both detail and clustered map views when message bubbles are enabled.

## 2.5.3 - Mobile And UI Stability Pass

Goal: stop mobile and chrome regressions with structure and browser coverage.

Status: started. The first pass adds shared CSS safe-area and z-index tokens and applies them to mobile top actions, bottom sheets, map controls, Packets, settings, VCR, palette/panel popovers, and mini live clock positioning. The second pass decodes the built-in MeshCore default Public channel for sanitized speech bubbles without requiring a private `MESHCORE_CHANNEL_SECRETS` value. Remaining work should add browser-level mobile screenshots and finish extracting top-bar popups into focused components.

### Mobile Layout

- Create a safe-area and z-index registry for top bar, top actions, map controls, mini live clock, bottom dock, VCR, Packets tray, palette picker, and settings sheets.
- Convert mobile popovers into consistent bottom sheets or near-fullscreen sheets.
- Ensure sheets only capture touch gestures inside their visible bounds, leaving MapLibre pan/zoom/rotate usable.
- Pin all transient indicators, including live pulse indicators, to named safe-area corners.

### UI Component Cleanup

- Extract top-bar popups into focused components:
  - `ChangelogPopover`
  - `FeaturePopover`
  - `GuidePopover`
  - `ReleaseLinks`
- Split `styles.css` into ordered CSS modules imported by the root stylesheet:
  - base/theme
  - topbar
  - map chrome
  - panels/sheets
  - packets
  - vcr
  - netgraph
  - mobile

### Browser Regression

- Add Playwright or equivalent browser smoke tests for desktop and 390px vertical mobile.
- Verify no default mobile controls are clipped.
- Verify palette picker selection works on mobile.
- Verify VCR, Packets, and Map Settings open/close without blocking map gestures.

### Acceptance

- Browser smoke runs locally and in CI.
- Mobile screenshots show no cut-off controls in default map, Packets, VCR, palette, settings, and 3D mode.
- CSS is split without changing visible desktop behavior.

## 2.5.4 - Live Map Usability And Activity Polish

Goal: make the default live map feel calmer, clearer, and more visibly alive.

Status: started. The first pass adds a toggleable activity heatmap source/layer,
calms Live Follow camera moves with a shared decision helper, tightens status
pill copy, and uses darker semantic route/path colors for light mode.

### Live Follow

- Throttle repeated live-follow targets so busy traffic does not whip the map.
- Ignore duplicate targets and wait while the previous camera move is still
  active.
- Lower follow zoom and use longer eased transitions for both point and route
  targets.

### Activity Heatmap

- Add a subtle heatmap/sparkle layer based on recent public-safe node activity.
- Keep it independent from packet ingest, counters, Packets, VCR, and comets.
- Expose it through Map Settings so viewers can hide it without disabling other
  layers.

### Light-Mode Route Contrast

- Use semantic route colors for dark and light modes.
- Keep selected, plotted, replayed, and connected route colors readable on light
  basemaps.

### Acceptance

- Live Follow can stay enabled during normal traffic without constant camera
  jumps.
- Activity heatmap can be toggled and does not rebuild node/route sources.
- Light-mode selected/pathway routes remain visible across palettes.

## 2.5.5 - Icon Alignment And VCR Timeline Polish

Goal: close two visible UI mismatches before deeper Packets/VCR data-plane work.

Status: shipped. This pass centralized node role visuals for the map and
Legend, adds missing Sensor and Other legend entries, and moves the VCR timeline
rail into a subtle baseline so frequency bars remain readable.

### Map And Legend Device Visuals

- Keep repeaters, companions, rooms, observers, sensors, and other/unknown
  nodes defined in one frontend visual registry.
- Use that registry for MapLibre role icon IDs, icon asset paths, fallback
  generated icons, role colors, and Legend rows.
- Keep observer positions visually distinct without changing public data.

### VCR Timeline Visuals

- Keep the range input transparent and fully clickable/touchable.
- Render packet-frequency bars above the timeline baseline.
- Add a distinct playhead so scrub position is clear without a heavy red rail
  crossing the frequency bars.

### Acceptance

- The Legend explains every public node role shown by the map.
- VCR density bars remain readable in live, paused, and replay states.
- No backend API, public schema, or privacy-boundary behavior changes.

## 2.5.6 - Packets And VCR Data Plane

Goal: make Packets and VCR truly production-grade over the full public-safe 24h window.

Status: started. The first 2.5.6 patch reduces Packets/VCR cold-cache pressure
by extending the public location/hash cache, serializing rebuilds, and giving
public history/Packets requests a slightly larger bounded timeout under live
traffic. The indexed projection work remains the larger follow-up.

### Cold-Cache Stability

- Keep public location/hash indexes cached long enough for repeated Packets,
  VCR, and history requests to reuse them.
- Serialize cold-cache rebuilds so concurrent requests do not all rebuild the
  same public index from SQLite.
- Keep request windows bounded and return compatible public responses.

### Public Packet Path Index

- Add a public-safe materialized packet path table or equivalent indexed projection.
- Store only sanitized fields already allowed publicly:
  - heard time
  - region
  - payload type
  - endpoint labels
  - hop/segment count
  - distance
  - public-safe segment IDs/labels/distances
  - message preview when already public-safe
- Add indexes for region, payload, heard time, hop count, message-only, and sanitized search fields.
- Keep the existing `/api/v1/public/packets` response shape compatible.

### True 24h Search

- Replace bounded conversion scans with indexed cursor pagination.
- Support server-backed search across the selected 1h/6h/24h window.
- Add clear result state:
  - loaded count
  - matched count if cheap
  - more available
  - end of window
  - query timeout or partial result warning

### VCR Slice Reliability

- Add bounded history slice caching for replay windows.
- Add slice prefetch around scrub timestamp.
- Make timeline loading state deterministic and visible.
- Keep Laser Show adaptive and frame-budgeted instead of unbounded.

### Acceptance

- Rare text/region/payload filters return stable pages without scanning arbitrary raw history.
- VCR scrub-to-play waits for ready slices and never starts with an empty misleading replay.
- Privacy regression covers the new projection table.

## 2.5.7 - OpenFreeMap 3D Production Polish

Goal: keep the impressive 3D mode while making it reliable and scalable.

### Renderer Performance

- Move repeated 3D node assets to instanced meshes where possible.
- Add explicit object pools for packet comets, endpoint pulses, and route arc meshes.
- Add visible-tile or viewport culling before model creation.
- Add per-role LOD:
  - full procedural models close up
  - simplified markers mid zoom
  - no 3D models below configured zoom except selected/live/focused items
- Track 3D object counts in local diagnostics.

### Visual Quality

- Improve route arc bundling so dense routes do not create unreadable ribbons.
- Add chase-camera presets and smoother manual-cancel behavior.
- Add clearer selected packet model and endpoint pulses.
- Tune dark/light OpenFreeMap style tokens using semantic palette values.

### Basemap Reliability

- Document operator choices for OpenFreeMap style URL, terrain URL, and offline/proxy/cache deployment.
- Add graceful fallback when external style or terrain resources fail.
- Keep flat mode unchanged.

### Acceptance

- 3D mode stays smooth in dense Canada views and representative worldwide fixtures.
- Toggling 3D on/off disposes resources cleanly.
- Browser diagnostics show bounded object counts and animation work.

## 2.5.8 - NetGraph Layout Rebuild

Goal: make NetGraph useful and stable instead of jittery.

### Layout Engine

- Persist node positions by stable node ID across live topology changes.
- Add community/component detection and pack components into a tighter viewport.
- Use geographic seeding only as a starting hint, not as a permanent cause of empty space.
- Limit reheat to local neighborhoods when new routes arrive.
- Add a `lock layout` and `recenter components` behavior.

### Readability

- Add edge bundling or curved multi-edge separation for overlapping paths.
- Reduce label clutter with hover/selection-first labeling.
- Add focus mode for a selected node or route neighborhood.
- Add a small minimap or component navigator if the graph remains large.

### Live Animation

- Index graph edges for comet matching instead of searching link arrays each frame.
- Keep observer glows best-effort and matched only to graph nodes.
- Avoid simulation resets from live pulse events.

### Acceptance

- NetGraph no longer jumps or fully resets during normal live updates.
- Connected components are packed with less empty space.
- Overlapping route edges are understandable enough for inspection.

## 2.5.9 - Backend Scale And SQLite Operations

Goal: reduce pressure on SQLite and improve operator confidence for long-running public hosts.

### Runtime Counters

- Replace repeated full count queries with cached or incremental counters where safe.
- Expose public-safe latency percentiles or rolling buckets for state/history/packets endpoints.
- Track cache refresh duration, cache age, truncation counts, and last refresh error.
- Track websocket client pressure and queue depth in readiness.

### SQLite Operations

- Add documented WAL checkpoint, backup, restore, vacuum, and retention commands.
- Add a safe operator command for DB stats and query plan inspection.
- Add request-scoped timeout tests for public state/history/packets.
- Review all indexes with actual `EXPLAIN QUERY PLAN` output from fixture and live-like data.

### Acceptance

- Public cache refresh remains fast with large packet tables.
- A slow Packets or history request fails cleanly without poisoning live state.
- Operator runbook contains tested backup/restore commands.

## 2.5.10 - Worldwide Operator Experience

Goal: make packaged installs feel first-class outside Canada.

### Configuration

- Add a first-run config validator or `mc-diagnose doctor`.
- Validate:
  - region preset
  - custom bounds syntax
  - public region allowlist
  - MQTT topic region parsing
  - database path/writability
  - public mode/privacy posture
- Prefer `--region` in diagnostics while keeping `--iata` as an alias.

### Instance Branding

- Add optional env/config for public instance name, logo URL/path, release link, and default map title.
- Hosted Canada keeps MeshCore Canada branding.
- Packaged installs can show their own country/community/private broker identity.

### Map Defaults

- In world mode, derive a useful initial view from configured bounds or first available public positioned nodes.
- Add examples for:
  - Canada hosted
  - worldwide public broker
  - Australia bounds
  - private `r1/r2` broker
  - small local lab network

### Acceptance

- New operators can diagnose why a map is empty without reading code.
- Private broker users do not need 3-letter uppercase topic regions.
- No global IATA list is required for correctness.

## 2.5.11 - Security, Packaging, And Release Automation

Goal: make releases repeatable and trustworthy.

### Release Automation

- Make every version reference derive from `VERSION` where practical.
- Generate or validate release notes from `CHANGELOG.md`.
- Add package smoke for the published GHCR image, not just local Docker Compose.
- Keep `scripts/live-smoke.ps1` for the hosted Canada deployment, with documented overrides for other hosts.

### Security And Privacy

- Expand privacy snapshot tests across:
  - `/api/v1/public/state`
  - `/api/v1/public/history`
  - `/api/v1/public/history/summary`
  - `/api/v1/public/packets`
  - `/healthz`
  - `/readyz`
  - `/ws/public`
- Add a dependency/license audit command to the release checklist.
- Consider image signing or attestation documentation if GHCR adoption grows.

### Acceptance

- A release can be built, smoked, tagged, published, and live-smoked from documented commands.
- Public responses continue to reject raw packet hashes, raw path hex, full keys, resolver fields, broker secrets, private payloads, and local operator config.

## 2.6.0 - World-Ready Live Network Operations Release

Goal: ship a larger stable release that feels complete for public hosts and packaged worldwide installs.

### Major Deliverables

- Production-grade Packets Explorer with true 24h indexed search, stable pagination, replay tray, and public-safe route details.
- NetGraph 2 with stable layout, packed components, understandable edges, and live graph pulses.
- OpenFreeMap 3D production polish with bounded renderer cost, strong selected packet replay, and documented basemap fallbacks.
- World-ready operator experience with config validation, branded instances, region-first diagnostics, and examples for non-Canada brokers.
- Mobile and desktop browser regression gates.
- Stronger SQLite operations: backup, restore, checkpoint, retention, DB stats, and query budget docs.
- Release automation that keeps version metadata, Docker smoke, docs, and top-bar copy in sync.

### 2.6.0 Acceptance Gate

- `cd backend && go test ./...`
- `cd web && npm test -- --run`
- `cd web && npm run build`
- `docker compose build`
- GHCR packaged-image smoke.
- Hosted Canada live smoke with `/healthz`, `/readyz`, public state, history, packets, websocket, and VCR replay.
- Worldwide fixture smoke with non-Canada coordinates and non-IATA region labels.
- Desktop browser smoke at 1920x1080.
- Mobile browser smoke at 390px vertical.
- 24h hosted Canada soak with packet ingest normally under 5 seconds stale and no unexplained stuck public state.
- Privacy regression across all public JSON and WebSocket payloads.
- README, changelog, production docs, operator runbook, package docs, screenshots, and roadmap updated.

## Backlog After 2.6

- Public-safe node and route history timelines.
- Regional heatmaps based only on sanitized aggregate activity.
- Saved map views and shareable camera positions.
- Route comparison and route health trend views.
- Fixture recorder/player UX for demos and bug reports.
- PWA/kiosk mode for wall displays.
- Auth-gated operator dashboard only if a separate access-control design is approved.

## Non-Goals

- No raw packet hashes, raw path hex, full public keys, resolver debug fields, broker credentials, private payloads, or local config in public APIs.
- No guessed RF routes from coordinate proximity, labels, or map shapes.
- No public debug/admin endpoints without an explicit access-control design.
- No schema-breaking public API changes in the 2.x line unless a migration plan is documented first.
- No worldwide correctness based on a global IATA list. Region labels are broker/operator labels; true routes come from resolver evidence.
