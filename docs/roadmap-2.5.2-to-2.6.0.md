# MC-CartoLive 2.5.2 to 2.6.0 Roadmap

Last audited: 2026-06-02

Baseline audited: `v2.6.1` completed the browser-annotation UI cleanup,
expanded browser-control smoke coverage,
packaged-image release-gate smoke automation,
projected Packets search-path observability,
projected packet-path search-index upgrade catch-up, public-safe projected
packet-path FTS search indexing, public-safe
Packets projection-path observability, public-safe packet-path projection
backfill observability, bounded public packet-path projection backfill, public
packet-path projection groundwork, release workflow Node 24 compatibility, cacheless
public-state fallback pressure reduction, ingest observer lookup pressure
reduction, runtime counter logging pressure reduction, NetGraph hidden-tab
frame/layout pause, render-quality frame pacing, calmer Live Follow, direct
live/not-live Perf labels, render-quality controls, OpenFreeMap/flat-map render
budget reductions, live-status simplification, broader palette token coverage,
NetGraph legend/icon alignment, browser smoke gate and mobile Perf/Packets
clipping fix, OpenFreeMap selected-packet chase camera refinement, OpenFreeMap
3D adaptive LOD/budgets, long-text Chat rebroadcast dedupe, OpenFreeMap 3D
render-cost reduction, palette-aware NetGraph visuals, strict build-age
parsing, Chat duplicate suppression hardening, Chat pressure guard, Chat query
indexes, NetGraph layout stability, OpenFreeMap 3D rebuild guard, flatter route
readability, NetGraph helper, 3D chase-helper, release-privacy scan work, and
the first internal public packet-path projection slice, recent projection
backfill for upgraded databases, backfill progress fields in health/readiness,
projection-vs-fallback Packets request counters, indexed projected packet
search with fallback while upgrade windows catch up, background FTS catch-up
for already-projected packet rows, and health/readiness counters that show
whether projected text searches use FTS or substring fallback, reusable package
smoke coverage for synthetic and worldwide fixture modes, and browser smoke
coverage for OpenFreeMap 3D, palettes, Map Settings, VCR, and top-bar help
popovers.

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

## 2.6.0 Completion Status

The 2.6.0 release closes the active roadmap with the following production
readiness items in place:

- **Backend scale:** public state fallback, packet count refreshes, observer
  lookups, Packets projection reads, and VCR history reads are bounded and
  observable through public-safe health/readiness counters.
- **Packets/VCR data plane:** Packets and VCR history prefer the public-safe
  projected packet-path table, keeping 24h true-route browsing and scrub replay
  responsive as SQLite databases grow.
- **Mobile/browser regression gate:** repeatable desktop and 390px smoke covers
  live map, Perf, setup, Packets, Chat, NetGraph, VCR, palette, settings, and
  OpenFreeMap controls.
- **NetGraph as a core feature:** NetGraph remains frontend-only and renders the
  connected public RF topology with stable layout, live pulses, search, and
  compact inspectors.
- **OpenFreeMap 3D efficiency:** OpenFreeMap 3D remains optional, bounded, and
  safe on mobile; selected packet replay uses the cinematic chase path where
  the browser supports the 3D custom layer.
- **Chat history:** the public-safe Chat page is available beside NetGraph with
  region/channel/search filters over sanitized decoded public text.
- **Worldwide operator flow:** first-run setup, configurable bounds, generic
  region labels, and `PUBLIC_IATAS` compatibility support non-Canada/private
  broker installs without weakening hosted Canada defaults.
- **Release gate:** backend tests, frontend tests/build, Docker build, package
  smoke, browser smoke, privacy checks, and hosted Canada live smoke are the
  required 2.6.0 release evidence.

## 2.6 Scope Decisions

These decisions were confirmed on 2026-06-01 and should guide the rest of the
2.6 work:

- Hosted Canada and packaged worldwide/private-broker users are equal
  priorities. Tradeoffs should preserve both whenever practical.
- Indexed packet-path projection is preferred, but not a 2.6 blocker if bounded
  Packets search remains honest about partial scans and end-of-window states.
- NetGraph is a core 2.6 feature, not a side experiment.
- Cinematic OpenFreeMap 3D selected-packet chase/replay is a release blocker.
- First-run browser setup should be added for easy package installs.
- Add a Chat page beside NetGraph with region/IATA and channel-filterable
  sanitized public chat history.
- No soak test is required for 2.6.0.
- Saved screenshot artifacts are required for major releases like 2.6.0, not
  every patch release.
- The final 2.6 feature slot is NetGraph improvements plus the Chat page.

## 2.5.51 - Browser Control Smoke Expansion

Goal: make the 2.6 browser regression gate cover the controls that have
historically broken without requiring manual visual inspection for every patch.

Status: implemented with live-map browser-smoke actions for OpenFreeMap 3D,
palette selection, Map Settings, VCR open/scrub/close, and desktop top-bar help
popovers. The same gate caught the oversized changelog popover, which now
scrolls inside the viewport.

### Acceptance

- Desktop and 390px mobile smoke still cover live map, Perf, Packets, Chat, and
  NetGraph pages.
- The live-map scenario exercises VCR, palette, settings, and OpenFreeMap 3D
  controls where they are available.
- The smoke avoids flaky WebGL pixel readback while still verifying that map
  canvas and controls remain visible in viewport.
- Public APIs, hosted Canada behavior, packaged worldwide defaults, true-route
  validation, and privacy boundaries remain unchanged.

## 2.5.50 - Packaged Image Release-Gate Smoke

Goal: close the release-gate gap where CI smoked local images but the published
GHCR image was not verified after push.

Status: implemented with `scripts/package-smoke.mjs`, local release-check
integration, CI Docker image smoke reuse, and a GHCR post-push smoke step in
the Docker publish workflow.

### Acceptance

- One script can smoke any image reference, including a local Docker image,
  `ghcr.io/n30nex/mc-cartolive:<version>`, or a GHCR digest.
- The smoke verifies synthetic and worldwide fixture modes, public APIs,
  Packets paths, Chat windows, readiness metadata, and public privacy scanning.
- CI uses the script for local image smoke and the publish workflow uses it
  after pushing the tagged image.
- Public APIs, true-route validation, hosted Canada behavior, package worldwide
  defaults, and privacy boundaries remain unchanged.

## 2.5.49 - Projected Packets Search-Path Observability

Goal: make `/api/v1/public/packets?q=...` execution paths visible to operators
without exposing query text, raw packets, or private packet material.

Status: implemented with explicit store-level projected search mode metadata
and public-safe runtime counters. `/healthz` and `/readyz` now report how many
projected Packets requests used the FTS index, how many fell back to safe
substring search, and how many had no text query.

### Acceptance

- Operators can tell whether projected packet text searches are using FTS or
  substring fallback.
- Search mode counters are public-safe aggregate counts only.
- Public packet response shape, cursor behavior, route validation, region
  scoping, hosted Canada behavior, and privacy boundaries remain unchanged.

## 2.5.48 - Projected Packet-Path Search Index Catch-Up

Goal: make the 2.5.47 indexed search path complete on upgraded databases that
already had projected packet rows before the FTS table existed.

Status: implemented by extending the normal public packet-path background
backfill loop. When no route projections are missing, the same bounded worker
now syncs existing public-safe `public_packet_paths.search_text` rows into the
FTS table. `/healthz` and `/readyz` expose the latest sync count and whether
search-index catch-up still has work remaining.

### Acceptance

- Existing projected packet rows with missing FTS rows are indexed in bounded
  batches without rereading private packet data.
- Packet search still falls back safely until the requested window is indexed.
- Operators can see search-index catch-up through public-safe health/readiness
  fields.
- Public packet response shape, cursor behavior, route validation, region
  scoping, hosted Canada behavior, and privacy boundaries remain unchanged.

## 2.5.47 - Projected Packet-Path Search Index

Goal: reduce `/api/v1/public/packets` search pressure by indexing the
public-safe projected packet search text while preserving compatible fallback
behavior for upgraded databases.

Status: implemented with a standalone FTS5 table maintained by
`public_packet_paths` triggers. `PublicPacketPaths` uses FTS only when the
requested window has a complete FTS index; otherwise it falls back to the
previous `search_text` filter so true routed packets are not hidden during
upgrade catch-up.

### Acceptance

- Complete projected packet windows can use indexed text search.
- Incomplete search-index windows still return matching true routed packets via
  the existing fallback.
- FTS queries are built from sanitized prefix tokens, not raw user query syntax.
- Public packet response shape, cursor behavior, route validation, region
  scoping, hosted Canada behavior, and privacy boundaries remain unchanged.

## 2.5.46 - Packets Projection-Path Observability

Goal: make the remaining Packets data-plane pressure visible without changing
public packet response shapes.

Status: implemented through public-safe `/healthz` and `/readyz` fields. The
runtime now counts projected packet requests served from the indexed
projection, requests that fell back to legacy conversion, projection query
errors, and whether the last requested window was projection-complete.

### Acceptance

- Operators can see whether `/api/v1/public/packets` is using the indexed
  projection path or falling back to conversion.
- Projection check/query errors increment a public-safe error counter.
- No public packet API schema, cursor behavior, true-route validation, region
  scoping, or privacy boundary is changed.

## 2.5.45 - Packet-Path Projection Backfill Observability

Goal: make packet-path projection catch-up visible to operators without adding
public debug endpoints or exposing private packet material.

Status: implemented through public-safe `/healthz` and `/readyz` fields. The
runtime now records the latest backfill latency, scan count, projected count,
mappable count, non-mappable count, remaining-work flag, and failure count.

### Acceptance

- Operators can tell whether upgraded databases are still catching up to the
  indexed Packets path.
- Failed backfill attempts increment a public-safe failure counter.
- No public packet/path response shape changes are introduced.
- True-route validation, hosted Canada scoping, and public privacy boundaries
  remain unchanged.

## 2.5.44 - Public Packet-Path Projection Backfill

Goal: make upgraded databases reach the indexed Packets projection path quickly
without blocking startup or changing public APIs.

Status: implemented as a bounded background startup loop. The app scans only
missing `live_edge_events` rows inside the configured recent window, writes
public-safe packet-path projection rows or non-mappable markers, and exits once
the window is complete.

### Acceptance

- Old live edge rows inside the configured window are projected in bounded
  batches.
- Invalid or unmappable rows become non-mappable markers so projection
  completeness checks remain correct.
- Operators can tune or disable catch-up with
  `PUBLIC_PACKET_PATH_BACKFILL_ENABLED`, `PUBLIC_PACKET_PATH_BACKFILL_BATCH`,
  and `PUBLIC_PACKET_PATH_BACKFILL_HOURS`.
- Public response shapes and privacy boundaries remain unchanged.

## 2.5.43 - Public Packet-Path Projection Groundwork

Goal: start replacing Packets endpoint conversion scans with an indexed
public-safe projection while preserving existing responses and older database
behavior.

Status: implemented for new live edge writes. `public_packet_paths` stores only
sanitized packet-path fields already allowed in public responses. New edge
events write either a mappable projected packet path or a non-mappable marker
row. `/api/v1/public/packets` prefers the projection when the requested window
is fully covered and otherwise falls back to the existing conversion path so
older 24h windows do not lose results.

### Acceptance

- New projected rows expose no raw packet hashes, raw path hex, full public
  keys, resolver debug fields, broker data, or private payloads.
- Invalid or unmappable edge rows do not appear in public Packets results but
  still count toward projection completeness.
- Region allowlists still apply when projected rows are used.
- Existing Packets response shape and cursor behavior remain compatible.

## Confirmed Findings

### Release And CI

- The CI Docker smoke check previously hardcoded Docker smoke metadata to `2.5.0` while the repo was `2.5.1`. The 2.5.2 foundation patch now reads expected image metadata from `VERSION`; keep this guarded in future releases.
- The hosted app top-bar changelog/help copy had drifted to OpenFreeMap 3D and 2.4-era production tooling. The 2.5.2 foundation patch refreshes it for the 2.5/2.6 track; future releases should update this alongside `CHANGELOG.md`.
- Release metadata is spread across `VERSION`, backend defaults, Docker defaults, web package metadata, docs, CI, and top-bar copy. This invites drift.

### Backend

- Worldwide support is present, but many internal concepts are still named IATA. Public compatibility can stay, but operator-facing language should become `region` first.
- Public cache caps are fixed at 2500 nodes, 2500 routes, 240 recent pulses, and 240 activity records. That is acceptable for the hosted Canada map today, but it can silently truncate larger worldwide installs.
- `Store.Stats()` still exists for private debug stats, but the public cache,
  runtime counter logs, and cacheless public-state fallback no longer call the
  full multi-count path.
- History/packet conversion uses a cached public location index, and the ingest
  observer fallback now uses exact public-key/region lookup after node lookup
  misses. The remaining Packets/VCR risk is rare-filter scan/conversion cost.
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

## 2.5.7 - Top Chrome And Guide Polish

Goal: make the common top chrome easier to scan and the built-in guide more
useful for first-time viewers and package operators.

Status: shipped. The top status bar now uses compact two-line metrics, shorter
semantic labels, theme-aware surfaces, and predictable number compaction. The
Guide now uses color-coded feature cards with larger icon scenes and
route/pulse motifs.

### Acceptance

- Status pills fit better at desktop widths without truncating the most useful
  metric values.
- Guide sections are visually distinct and easier to scan than plain text
  bullets.
- No backend API, public schema, or privacy-boundary behavior changes.

## 2.5.8 - Public Message And Packets Usability Polish

Goal: restore trust in live public text bubbles and make Packets easier to
understand before the larger Packets data-plane/index work.

Status: shipped. The backend group-text decoder now prefers a verified
packet-payload decrypt before using broker-provided decoded JSON, so bad
upstream text decoding does not pollute new public speech bubbles when the
packet itself can be decoded. The Packets panel now explains the select/replay
flow, shows scanned-event counts, and makes server-history search status
visible.

### Acceptance

- New Public group text messages decode cleanly from the packet payload when
  the default Public channel or configured channel key can decrypt them.
- Map speech bubbles continue to use sanitized public message text only, with
  no raw packet hashes, raw path hex, full keys, or resolver debug output.
- Packets page copy makes it clear that selecting focuses the path and replay
  pauses live, fits the route, then plays one watchable comet.
- Public API response shapes remain unchanged.

## 2.5.9 - Message Bubble Snapshot Reliability

Goal: make decoded public text bubbles survive reloads and polling fallback, not
only fresh WebSocket frames.

Status: in progress. Observer-only text activity from the initial public state
snapshot is hydrated into the same observer-burst visual queue as live
WebSocket activity, so a fresh reload can still show recent public text near
the observer that first saw it. The frontend now treats any sanitized
`messageText` with a public map anchor as eligible for a speech bubble instead
of relying on fragile payload label matching.

### Acceptance

- Recent observer-only public text messages can produce speech bubbles after a
  reload or polling fallback when the observer has a public-safe location.
- Routed text messages continue to anchor to the sender/source endpoint when
  available, falling back to the observer anchor only when needed.
- Message bubbles still require sanitized public `messageText`; raw packet
  hashes, raw payload hex, full keys, broker data, and resolver debug output
  remain excluded.
- Public API response shapes remain unchanged.

## 2.5.10 - OpenFreeMap 3D Production Polish

Goal: keep the impressive 3D mode while making it reliable and scalable.

Status: in progress. The first 2.5.10 pass reduces scene rebuild pressure by
selecting visible, focused, or recently active 3D node/route candidates before
rebuilding Three.js models and route arcs. Larger instancing, object pooling,
and visual refinement items remain in this section.

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

## 2.5.11 - NetGraph Layout Rebuild

Goal: make NetGraph useful and stable instead of jittery.

Status: started. The first 2.5.11 pass tightens component packing, preserves
positions through topology updates, indexes rendered edges for faster live
comet drawing, adds mobile pinch zoom, keeps the live pulse chip in a real
corner, and draws node glyphs with the shared map/Legend role visual registry.

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
- Mobile users can pan, pinch zoom, and select nodes/routes in NetGraph.

## 2.5.12 - Backend Scale And SQLite Operations

Goal: reduce pressure on SQLite and improve operator confidence for long-running public hosts.

Status: started. The current pass removes full `Store.Stats()` calls from the
public cache refresh hot path, records packet count refresh latency/failures,
tracks public packet search scan pressure, and exposes public cache truncation
counts in health/readiness.

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

## 2.5.13 - Worldwide Operator Experience

Goal: make packaged installs feel first-class outside Canada.

Status: started with the browser first-run setup foundation. The current pass
adds a closeable Setup page available by direct route, generates
public-safe `.env` starter snippets for world/Canada/custom deployments, and
keeps secrets and private packet material out of the browser guidance.

### Configuration

- Add a browser first-run setup page for easy package installs.
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

- New operators can configure and diagnose why a map is empty without reading
  code.
- Private broker users do not need 3-letter uppercase topic regions.
- No global IATA list is required for correctness.

## 2.5.14 - Security, Packaging, And Release Automation

Goal: make releases repeatable and trustworthy.

Status: started with a cross-file release metadata guard. The current pass adds
`scripts/check-version-sync.mjs`, runs it from CI and local release checks, and
fails fast when `VERSION`, backend defaults, Docker defaults, frontend package
metadata, docs, top-bar localStorage keys, or changelog entries drift.
The release-check scripts also run `scripts/check-public-privacy.mjs` against a
running public instance so JSON responses are scanned for raw hashes, raw hex,
full keys, secrets, tokens, and debug fields before a release is promoted.

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

## 2.5.15 - Chat And NetGraph Final Feature Slot

Goal: finish the last user-facing 2.6 feature work without expanding public
privacy boundaries.

Status: started with the public-safe Chat endpoint and top-bar Chat page,
metadata-stable NetGraph visible graph helpers, deterministic NetGraph edge
lanes, selected-neighborhood helpers, and a pure tested OpenFreeMap packet
replay chase helper based on shared 3D route-arc samples.

### Public-Safe Chat Page

- Add a top-bar `Chat` page beside NetGraph.
- Show sanitized decoded public text history only.
- Filter by region/IATA, channel label, sender/observer label, and time window.
- Link chat messages back to public map anchors when available.
- Keep the endpoint bounded and cursor-paged so search does not become an
  unbounded 24h scan under live traffic.
- Do not expose raw payloads, raw packet hashes, full public keys, channel
  secrets, broker metadata, or resolver debug data.

### NetGraph Core Polish

- Reduce overlapping route edges with bundling or deterministic curved
  separation.
- Add selected-neighborhood focus and a clear way back to the full graph.
- Add layout lock/recenter behavior so live updates do not reset user context.
- Keep mobile pan, pinch zoom, node select, and route select reliable.

### Acceptance

- Chat can browse/filter recent public decoded text without private data.
- NetGraph is stable and useful enough to be listed as a core 2.6 feature.
- Desktop and 390px mobile browser checks cover Chat and NetGraph.

## 2.5.16 - Chat Deduplication And Topbar Cleanup

Goal: close the first production feedback from the Chat feature without
expanding scope.

Status: active patch.

- Collapse routed Chat rows by packet observation so repeated route-edge rows do
  not duplicate the same decoded public message.
- Keep first-run Setup available by direct route, but remove it from the
  permanent top navigation beside Packets, NetGraph, and Chat.
- Verify hosted Canada still runs with `MAP_REGION_PRESET=canada` after deploy.

## 2.5.42 - Release Workflow Node 24 Compatibility

Goal: keep the CI and package publish gate ahead of the GitHub Actions Node 20
action-runtime deprecation.

Scope:

- Update checkout, setup-node, Docker Buildx, Docker login, Docker metadata,
  Docker build/push, and build-provenance actions to current Node 24-capable
  major versions.
- Keep backend tests, frontend tests/build, Docker smoke, worldwide fixture
  smoke, GHCR publish, SBOM, and provenance attestation behavior unchanged.
- Keep app runtime code, public APIs, privacy boundaries, and hosted Canada
  behavior unchanged.

## 2.5.41 - Cacheless Public-State Fallback Pressure Reduction

Goal: keep the legacy cacheless `/api/v1/public/state` fallback off the full
multi-count `Store.Stats()` path.

Scope:

- Keep the normal cached public-state path unchanged.
- Replace fallback `Store.Stats()` usage with `Store.PacketCount()` for the
  public packet total.
- Keep fallback live-state reads bounded by the existing recent packet and edge
  limits.
- Add backend coverage for the cacheless public-state fallback packet total.
- Keep public APIs, privacy boundaries, and hosted Canada behavior unchanged.

## 2.5.40 - Ingest Observer Lookup Pressure Reduction

Goal: avoid an all-observer table scan on packet ingest when a publisher is not
already known as a positioned node.

Scope:

- Keep node lookup as the preferred endpoint source.
- Replace the fallback `Store.Observers()` scan with the exact
  `ObserverByPublicKeyIATA` lookup for the publisher public key and region.
- Reuse the same coordinate validation rules before creating observer fallback
  route/message anchors.
- Add backend coverage for valid positioned observers, invalid observer
  coordinates, and exact-region lookup behavior.
- Keep public APIs, privacy boundaries, and hosted Canada behavior unchanged.

## 2.5.39 - Runtime Counter Logging Pressure Reduction

Goal: reduce backend read pressure on large SQLite databases by keeping
periodic runtime logs off full-table statistics queries.

Scope:

- Remove the 30-second `Store.Stats()` call from runtime counter logging.
- Use cached public-state counts for packet totals, public nodes, routes,
  recent pulses, and recent activity.
- Use runtime snapshots for cache refresh latency/failures, packet-count
  refresh latency/failures, websocket pressure, and MQTT freshness.
- Keep debug stats and public API behavior unchanged.
- Keep public APIs, privacy boundaries, and hosted Canada behavior unchanged.

## 2.5.38 - NetGraph Hidden-Tab Animation Pause

Goal: stop NetGraph from spending canvas and D3 force-layout work while the
browser tab is hidden, without changing the graph's public data model.

Scope:

- Gate NetGraph animation frames while `document.hidden` is true.
- Stop the active D3 force simulation when the page is hidden.
- Resume drawing and any still-active simulation cleanly when visible again.
- Keep live graph comets and observer glows capped and generation-safe.
- Keep public APIs, privacy boundaries, and hosted Canada behavior unchanged.

## 2.5.37 - Animation Frame Pacing And Live Status Clarity

Goal: make the Smooth/Balanced render-quality setting reduce actual animation
frame pressure and make the live-status page answer the user's live/not-live
question more directly.

Scope:

- Pace flat-map packet canvas frames by selected render quality.
- Pace OpenFreeMap 3D custom-layer repaints by selected render quality.
- Keep High mode closest to the richest previous cadence while Smooth and
  Balanced trade animation cadence for lower CPU/GPU pressure.
- Make Live Follow even calmer with longer camera moves, longer spacing, lower
  route/point zoom targets, and less single-observer zoom-in.
- Make Perf primary cards read `live`, `degraded`, `quiet`, or `not live`.
- Keep public APIs, privacy boundaries, and hosted Canada behavior unchanged.

## 2.5.36 - Render Quality And Map Animation Budget

Goal: improve OpenFreeMap 3D and flat-map smoothness without changing public
data schemas or reducing the user's ability to choose richer visuals.

Scope:

- Add a persisted `Smooth` / `Balanced` / `High` render quality setting under
  Map Settings.
- Use render quality to scale OpenFreeMap 3D node, route, comet, observer glow,
  and route-arc geometry budgets.
- Use render quality to scale flat-map packet canvas DPR, mask refresh cadence,
  route residue budget, observer aura budget, and decorative sparkle work.
- Dispose capped/dropped Three.js comet and observer-glow objects as soon as
  they leave the active budget.
- Keep the default Balanced mode smoother than prior releases while preserving
  High mode for richer visuals on stronger clients.

## 2.5.35 - Live Status, Live Follow, Theme, And NetGraph Visual Polish

Goal: address the next user-facing 2.6 readiness issues without changing
public schemas: Perf must be a useful live/not-live page, Live Follow must be
watchable, more UI status color must follow the selected palette, and NetGraph
must look like part of the same map product.

Scope:

- Replace the broad Perf detail view with four direct status surfaces:
  backend, frontend/public API, MQTT ingest, and live routes.
- Reduce Perf refresh pressure by polling only health, readiness, and public
  state.
- Increase Live Follow camera duration and minimum spacing, use lower zoom caps,
  and use linear movement for less jumpy live-follow behavior.
- Add missing palette aliases for warning/error status styling.
- Add a compact NetGraph legend and selected-node role icons sourced from the
  same device and payload registries as the live map legend.

## 2.5.34 - Browser Smoke Gate And Mobile Panel Fix

Goal: turn the remaining 2.6 desktop/mobile browser verification requirement
into a repeatable command and use it to catch real layout regressions.

Scope:

- Add `scripts/browser-smoke.mjs` using Playwright from the web dev dependency
  set.
- Check desktop `1920x1080` and mobile `390px` viewports across the live map,
  Perf, Packets, Chat, and NetGraph.
- Write screenshots to `artifacts/browser-smoke` by default for release
  evidence, while keeping artifacts ignored by Git.
- Add optional release-check integration: `-RunBrowserSmoke` on PowerShell and
  `RUN_BROWSER_SMOKE=1` on Linux/macOS.
- Fix the first smoke-found mobile regression: Perf and Packets panels no
  longer keep the desktop `translateX(-50%)` transform at 390px width.

## 2.5.33 - OpenFreeMap Selected-Packet Chase Camera Polish

Goal: move the 2.6 release-blocking 3D packet replay experience closer to a
cinematic, inspectable chase view without changing public data schemas.

Scope:

- Add a pure chase-camera frame helper that tracks the packet subject while
  placing the map center slightly behind the packet along the route.
- Scale camera follow distance, lookahead distance, pitch, and zoom behavior by
  total route distance.
- Increase camera follow cadence and use linear step easing so forced replay
  feels smoother instead of repeatedly easing into coarse camera chunks.
- Keep manual map interaction cancel behavior and flat-map replay fallback
  unchanged.

## 2.5.32 - OpenFreeMap 3D Adaptive LOD

Goal: reduce 3D object pressure in dense OpenFreeMap views without removing
selected or route-analysis context.

Scope:

- Add adaptive 3D node and route-arc budgets that scale up as the viewer zooms
  closer.
- Render ordinary nodes as lightweight markers near the detail threshold while
  keeping selected, route-path, and neighbour nodes on full procedural models.
- Keep existing 2D MapLibre layers responsible for labels, hit testing,
  selection, and fallback rendering.
- Preserve public API compatibility and privacy boundaries.

## 2.5.31 - Chat Long-Text Rebroadcast Guard

Goal: close the visible duplicate Chat rows where the same decoded public text
arrives through different route or sender wrappers.

Scope:

- Keep the existing sender/text full-window duplicate key.
- Add a short text-only duplicate key for long messages so route/observer
  rebroadcasts collapse even when wrapper metadata differs.
- Keep short repeated replies from different senders visible.
- Preserve the public Chat response shape and public privacy boundaries.

## 2.5.30 - OpenFreeMap 3D Render Cost Reduction

Goal: improve OpenFreeMap 3D smoothness without changing public data contracts,
flat-map behavior, or the visible feature set.

Scope:

- Reduce ordinary 3D route arc tube detail while preserving higher detail for
  selected, focused, plotted, and analysis paths.
- Cache 3D packet comet route-arc samples and Mercator vectors at comet
  creation so animation frames update positions and fixed trail buffers instead
  of rebuilding samples and geometry.
- Keep 3D node-scene signatures stable when only volatile activity counters
  change and the visible model set/static properties are unchanged.
- Preserve OpenFreeMap 3D as a frontend-only overlay and keep existing
  MapLibre layers for hit testing, labels, selection, and fallback.

## 2.5.29 - NetGraph Theme Alignment And Chat Render Guard

Goal: make NetGraph visually match the rest of the app across dark/light modes
and palette selections, and close the remaining visible Chat duplicate render
case without adding public data or backend work.

Scope:

- Read active app palette tokens for the NetGraph canvas background, selected
  pathway color, fallback pathway color, labels, observer accents, and comet
  head contrast.
- Move NetGraph panel chrome to shared app surface, border, shadow, text, and
  light-mode tokens.
- Keep the existing shared role color/shape registry for NetGraph nodes,
  Legend entries, and map icons.
- Render Chat from a final de-duped view model so repeated decoded sender/text
  sightings cannot show as duplicate rows even if stale refreshes, older pages,
  or repeated observer/route copies enter component state.
- Keep NetGraph frontend-only and preserve public API and privacy boundaries.

## 2.5.28 - Live Status And Camera Calm

Goal: make the operational top-bar and live-follow behavior easier to trust
while keeping public APIs and data privacy unchanged.

Scope:

- Replace the Perf page with a direct live/degraded/offline deployment status
  surface covering backend readiness, browser API reachability, MQTT ingest,
  routed map motion, WebSocket clients, and Packets/Chat endpoint reachability.
- Slow Live Follow camera motion, reduce follow zoom targets, and add stronger
  spacing so normal live traffic does not whip the map around.
- Parse compact UTC and ISO-like build timestamps strictly so top-bar build age
  never displays a misleading normalized date.
- Keep Setup out of the permanent top bar and keep all status fields
  public-safe.

## 2.5.27 - Flat Map Live Pathway Polish

Goal: make the default flat map look more alive and easier to scan during real
traffic without exposing all idle routes at low zoom.

Scope:

- Increase the bounded route width and opacity ramp for fresh high-frequency
  public routes while cooled routes shrink back.
- Use a clearer activity hue ramp for visible pathways in both dark and light
  modes.
- Add deterministic short-lived sparkle residue to recent packet comet trails,
  capped per route and derived only from already-public live route pulses.
- Keep route source signatures stable, public API response shapes unchanged,
  and privacy boundaries unchanged.

## 2.5.26 - Chat Duplicate Hardening

Goal: close the visible Public Chat duplicate loophole reported after the first
round of duplicate suppression.

Scope:

- Collapse repeated decoded Chat messages by sender/text across the full 24h
  Chat window, regardless of route context, observer context, region, endpoint
  labels, channel label, or payload label.
- Strip hidden/control formatting characters and normalize punctuation-only
  differences before display dedupe so visually identical text rows cannot
  survive as separate messages.
- Add a symbol-only fallback display key so repeated emoji-only group texts
  collapse without relying on raw packet hashes or private identifiers.
- Keep public response shape, cursor behavior, and privacy boundaries
  unchanged.

## 2.5.23 - NetGraph And 3D Stability Guard

Goal: improve the two most visible 2.6 surfaces without changing public data
contracts.

Scope:

- Keep paused NetGraph layouts locked through live topology refreshes.
- Use gentler incremental graph settling for small live topology changes.
- Seed newly discovered graph nodes near known neighbors instead of letting them
  kick the whole graph apart from component seeds.
- Reduce disconnected component spread with lower global repulsion and stronger
  component anchors.
- Keep OpenFreeMap 3D move/zoom-end rebuilds signature-gated instead of forcing
  full scene rebuilds after every camera movement.

## 2.5.22 - Chat Query Index Guard

Goal: keep public Chat 24h windows responsive on large live SQLite databases.

Scope:

- Add partial indexes for public Chat message history reads.
- Use index-friendly message predicates for routed and observer-only public
  Chat events.
- Keep the 2.5.21 page cap, cursor paging, public response shape, and privacy
  boundaries unchanged.

## 2.5.21 - Chat Pressure Guard

Goal: keep public Chat responsive when clients request large 24h pages after
display de-dupe.

Scope:

- Cap public Chat pages at 400 rows per request.
- Preserve cursor paging so clients can continue loading older public messages.
- Keep the public Chat response shape and privacy boundaries unchanged.

## 2.5.20 - Chat And Live Health Polish

Goal: close the remaining visible Chat repeat case and make the live map easier
to trust at a glance while staying on the 2.6 production-readiness path.

Scope:

- Dedupe Chat rows by private server-side packet identity when available, then
  by public-visible sender/text/channel repeat window as a fallback. Do not
  expose packet hashes or route debug data.
- Add frontend Chat display dedupe so mixed/stale pages still render cleanly.
- Add compact top-bar VU meters for per-minute rates and tighter count pills
  for packet, node, and route totals.
- Replace the Perf page with public-safe deployment health: backend/readiness,
  public API reachability, MQTT freshness, cache freshness, and routed traffic
  state.
- Fix compact UTC build-age parsing and make Live Follow camera movement slower
  and less jumpy.
- Make recent packet pathways easier to see below detail zoom while keeping idle
  route clutter gated.

## 2.5.19 - Sliding-Window Chat Dedupe

Goal: close the remaining Chat duplicate edge case at display bucket
boundaries.

Scope:

- Replace fixed time-bucket display dedupe with a sliding sender/text/channel
  window.
- Verify against live six-hour Chat data after deploy.
- Keep public response shape and privacy boundaries unchanged.

## 2.5.18 - Display-Window Chat Dedupe

Goal: fix the remaining visible Chat duplicate cases where the same decoded
message is observed by multiple observers or appears under multiple packet IDs.

Scope:

- Dedupe Chat rows by normalized sender, decoded text, channel, and payload type
  inside a short display window.
- Keep later repeated messages visible so real follow-up chat is not hidden.
- Preserve packet-identity dedupe as a fallback and never expose packet hashes
  publicly.
- Keep Setup out of the permanent top bar and keep deployed metadata pinned to
  the running commit.

Verification:

- Backend public Chat tests cover repeated message dedupe and internal hash
  privacy.
- Live smoke must pass against the Canada droplet after deploy.

## 2.5.17 - Packet-Identity Chat Dedupe

Goal: fix the remaining live Chat duplicate cases from repeated routed
observations without hiding legitimate repeated messages.

Status: active patch.

- Deduplicate Chat rows using internal packet identity when available.
- Keep packet hashes private and absent from public Chat responses.
- Fall back to a normalized public display tuple only when packet identity is
  unavailable.
- Fix Compose metadata fallback so `GIT_SHA` and `BUILD_TIME` update both
  frontend build metadata and backend health/readiness metadata on deploy.

## 2.6.0 - World-Ready Live Network Operations Release

Goal: ship a larger stable release that feels complete for public hosts and packaged worldwide installs.

### Major Deliverables

- Production-grade Packets Explorer with true 24h indexed search, stable pagination, replay tray, and public-safe route details.
- NetGraph 2 with stable layout, packed components, understandable edges, live graph pulses, and reliable mobile interaction.
- OpenFreeMap 3D production polish with bounded renderer cost, cinematic selected-packet chase/replay, and documented basemap fallbacks.
- Public-safe Chat page with region/IATA and channel-filterable decoded public message history.
- World-ready operator experience with browser first-run setup, config validation, branded instances, region-first diagnostics, and examples for non-Canada brokers.
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
- Major-release screenshot artifacts for desktop and 390px mobile.
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
