# Changelog

## Unreleased

## 2.5.50 - 2026-06-02

- Added `scripts/package-smoke.mjs` to smoke a built or published image in both
  synthetic and worldwide fixture modes.
- Wired package smoke into local release checks and CI Docker image smoke so the
  2.6 release gate reuses one public-safe image verification path.
- Added a GHCR post-push smoke step to the Docker publish workflow so tagged
  releases verify the published image digest before provenance attestation.
- Preserved public APIs, true-route validation, hosted Canada behavior, and
  privacy boundaries.

## 2.5.49 - 2026-06-02

- Added public-safe Packets search-path counters to `/healthz` and `/readyz`
  so operators can see projected FTS searches, projected substring searches,
  and projected no-query requests separately.
- Exposed explicit store-level projected search mode metadata without changing
  `/api/v1/public/packets` response shape.
- Preserved cursor behavior, true-route validation, hosted Canada scope,
  worldwide package behavior, and privacy boundaries.

## 2.5.48 - 2026-06-02

- Extended the public packet-path background backfill to also sync existing
  projected packet rows into the public-safe FTS search index after upgrade.
- Added public-safe `/healthz` and `/readyz` counters for packet-path search
  index sync count and whether search-index catch-up still has remaining work.
- Preserved `/api/v1/public/packets` response shape, cursor behavior,
  true-route validation, hosted Canada scope, worldwide package behavior, and
  privacy boundaries.

## 2.5.47 - 2026-06-02

- Added a public-safe FTS index for projected packet-path search fields so
  complete indexed windows can avoid `instr(search_text, ...)` scans during
  `/api/v1/public/packets` search.
- Kept upgrade behavior safe by using FTS only when the requested projected
  packet window is fully indexed; incomplete windows fall back to the existing
  search path instead of hiding true routed packets.
- Preserved public packet response shape, cursor behavior, true-route
  validation, region scoping, hosted Canada behavior, and privacy boundaries.

## 2.5.46 - 2026-06-02

- Added public-safe Packets projection-path counters to `/healthz` and
  `/readyz` so operators can see indexed projection serves, conversion
  fallbacks, projection errors, and whether the latest requested window was
  projection-complete.
- Recorded projection-vs-fallback decisions inside `/api/v1/public/packets`
  without changing response shape, cursor behavior, true-route validation, or
  privacy boundaries.
- Kept hosted Canada scoping and package worldwide/private-broker behavior
  unchanged.

## 2.5.45 - 2026-06-02

- Exposed public-safe packet-path projection backfill progress in `/healthz`
  and `/readyz` so operators can see whether upgraded databases are still
  catching up to the indexed Packets path.
- Added runtime counters for last backfill latency, last scan count, projected
  rows, mappable rows, non-mappable rows, remaining work, and failure count.
- Preserved `/api/v1/public/packets` response shape, true-route validation,
  hosted Canada scoping, and public privacy boundaries.

## 2.5.44 - 2026-06-02

- Added a bounded startup backfill for missing recent public-safe packet-path
  projection rows so upgraded databases can reach the indexed Packets path
  without waiting for older edge rows to age out naturally.
- Added `PUBLIC_PACKET_PATH_BACKFILL_ENABLED`,
  `PUBLIC_PACKET_PATH_BACKFILL_BATCH`, and
  `PUBLIC_PACKET_PATH_BACKFILL_HOURS` for operators who need to slow or disable
  upgrade catch-up work.
- Kept `/api/v1/public/packets` response shape, true-route validation, hosted
  Canada scoping, and public privacy boundaries unchanged.

## 2.5.43 - 2026-06-02

- Added an internal public-safe packet-path projection table for sanitized true
  route packet records.
- Wrote projection rows when live edge events are inserted, including
  non-mappable marker rows so completeness checks remain correct.
- Made `/api/v1/public/packets` prefer projected packet paths when the requested
  time window is fully projected, while falling back to the existing conversion
  path for older database windows.
- Preserved the existing public response shape and privacy boundaries: no raw
  packet hashes, raw path hex, full public keys, resolver debug fields, broker
  data, or private payloads are exposed.

## 2.5.42 - 2026-06-02

- Updated CI and GHCR publish workflows to current Node 24-capable GitHub and
  Docker action majors.
- Kept the existing backend tests, frontend tests/build, Docker smoke,
  worldwide fixture smoke, GHCR image publish, SBOM, and provenance attestation
  behavior intact.
- Addressed the GitHub Actions Node 20 action-runtime deprecation warning seen
  during package publish.

## 2.5.41 - 2026-06-02

- Removed the remaining full `Store.Stats()` multi-count query from the legacy
  `/api/v1/public/state` fallback path.
- The normal cached public-state path remains unchanged; if the fallback is
  used, it now combines the bounded live-state read with the cheaper packet
  count path.
- Added backend coverage for the cacheless public-state fallback packet total.
- Kept public APIs, response schemas, privacy boundaries, and hosted Canada
  behavior unchanged.

## 2.5.40 - 2026-06-02

- Removed the all-observer scan from ingest fallback endpoint matching.
  Publisher fallback now uses the exact indexed public-key/region observer
  lookup after the normal node lookup misses.
- Added backend coverage for positioned observer endpoint conversion, invalid
  observer coordinate rejection, and exact-region observer lookup.
- Reduced read pressure for route/message anchoring on larger deployments while
  keeping public APIs, response schemas, privacy boundaries, and hosted Canada
  behavior unchanged.

## 2.5.39 - 2026-06-02

- Removed the periodic full `Store.Stats()` call from runtime counter logging
  so the app no longer runs several full-table `COUNT(*)` queries every 30
  seconds on large production databases.
- Replaced those log fields with public-cache and runtime-stat snapshots for
  packet totals, public node/route counts, cache age/truncation, websocket
  pressure, MQTT freshness, and refresh latencies.
- Added backend coverage proving the runtime log snapshot uses cached state and
  works without an attached store.
- Kept public APIs, response schemas, privacy boundaries, and hosted Canada
  behavior unchanged.

## 2.5.38 - 2026-06-02

- Paused NetGraph canvas animation frames and D3 force layout work while the
  browser tab is hidden, then resumed drawing cleanly when the page becomes
  visible again.
- Added a focused NetGraph frame-gating helper and test coverage so live graph
  comets and observer glows do not keep scheduling offscreen work.
- Kept public APIs, privacy boundaries, and hosted Canada behavior unchanged.

## 2.5.37 - 2026-06-02

- Added render-quality frame pacing for the flat packet canvas so `Smooth` and
  `Balanced` modes reduce animation cadence, not only canvas DPR and overlay
  density.
- Added render-quality repaint pacing for the OpenFreeMap 3D custom layer so
  active 3D comets and observer glows do not force an uncapped repaint loop.
- Made Live Follow more conservative with longer camera moves, longer spacing,
  lower point/route zoom targets, and less single-observer zoom-in.
- Changed the Perf page's primary card labels to direct `live`, `degraded`,
  `quiet`, and `not live` states while keeping public-safe supporting details.

## 2.5.36 - 2026-06-02

- Added a persisted Map Settings render quality control with `Smooth`,
  `Balanced`, and `High` modes for packet and OpenFreeMap rendering.
- Lowered the default OpenFreeMap 3D render pressure by scaling node, route,
  comet, observer glow, and route-arc geometry budgets from the selected render
  quality.
- Reduced flat-map packet canvas cost by scaling canvas DPR, residue budgets,
  observer aura budgets, mask refresh cadence, and decorative route sparkles by
  render quality.
- Fixed a long-session OpenFreeMap 3D leak where capped/dropped packet comets
  and observer glows were removed from arrays but their Three.js objects could
  stay attached to the scene.
- Switched the OpenFreeMap Three.js renderer to request high-performance GPU
  rendering without antialiasing the custom layer, preserving the 2D MapLibre
  layers for labels and hit testing.

## 2.5.35 - 2026-06-02

- Simplified the Perf page into direct live/not-live checks for backend,
  frontend/public API, MQTT ingest, and live routed motion.
- Reduced Perf refresh pressure by polling only `/healthz`, `/readyz`, and
  public state instead of sampling history, Packets, and Chat on every refresh.
- Made Live Follow more watchable with longer linear camera moves, lower zoom
  targets, and a longer spacing gate between camera jumps.
- Added missing palette aliases for warning/error UI states so more controls and
  status surfaces inherit the selected theme.
- Added a compact NetGraph legend and node-inspector icons using the same role
  and payload visual registries as the live map legend.

## 2.5.34 - 2026-06-01

- Added a Playwright-based browser smoke script for desktop `1920x1080` and
  mobile `390px` checks across the live map, Perf, Packets, Chat, and NetGraph.
- Added optional release-check integration for the browser smoke gate on
  Windows and Linux/macOS.
- Fixed a mobile clipping regression where Perf and Packets panels kept their
  desktop center transform and rendered partly offscreen at 390px width.
- Documented browser smoke setup, screenshot output, and release-candidate usage
  for the 2.6 acceptance path.

## 2.5.33 - 2026-06-01

- Improved OpenFreeMap selected-packet replay with a trailing chase camera that
  keeps the packet forward in view instead of centering every step directly on
  the packet.
- Added distance-aware chase pitch, follow distance, and lookahead distance so
  local and long-haul routes get different cinematic framing.
- Increased chase camera cadence and switched replay follow steps to linear
  easing for smoother motion between camera frames.
- Added regression coverage for chase-camera frame selection, follow distance,
  lookahead distance, and pitch bands.

## 2.5.32 - 2026-06-01

- Reduced OpenFreeMap 3D object load near detail zoom with adaptive node and
  route-arc budgets that scale up as the viewer zooms closer.
- Added lightweight marker LOD for ordinary 3D nodes at lower detail zoom while
  keeping selected, route-path, and neighbour nodes on full procedural models.
- Added regression coverage for 3D node/route budgets and LOD selection.

## 2.5.31 - 2026-06-01

- Fixed the remaining visible public Chat duplicate case by adding a short
  text-only repeat guard for long messages, so rebroadcasted decoded texts
  collapse even when the server sees different route or sender wrappers.
- Kept short repeated replies from different senders visible, preserving normal
  conversation flow while removing route/observer echo rows.
- Added backend and frontend regression coverage for long-text rebroadcasts and
  short distinct replies.

## 2.5.30 - 2026-06-01

- Reduced OpenFreeMap 3D route arc geometry cost by lowering ordinary-route
  tube detail while preserving higher detail for selected and focused paths.
- Cached 3D packet comet arc samples and Mercator vectors at comet creation so
  live/replay comets no longer resample arcs or replace trail geometry every
  frame.
- Stopped volatile node activity counters from forcing 3D node-scene rebuilds
  when the visible model set and static node properties have not changed.

## 2.5.29 - 2026-06-01

- Made NetGraph canvas rendering palette-aware so backgrounds, selected
  pathways, fallback pathway colors, labels, and observer accents follow the
  active theme instead of fixed dark-blue defaults.
- Updated NetGraph panel chrome to use shared app surface, border, shadow, text,
  accent, and light-mode tokens.
- Added regression coverage for NetGraph dark/light theme token selection while
  keeping the existing shared role icon/color registry.
- Hardened the Chat page against repeated decoded message sightings so the same
  public sender/text is collapsed before rows render, even if repeated route or
  observer copies arrive in a refresh.

## 2.5.28 - 2026-06-01

- Reworked the Perf page into a compact public-safe live status view covering
  backend readiness, browser API reachability, MQTT ingest freshness, routed
  map motion, WebSocket clients, and the Packets/Chat endpoints.
- Made Live Follow calmer with longer eased camera moves, a longer movement
  interval, lower follow zoom targets, and a stronger moving-camera guard.
- Tightened top-bar build-age parsing for compact UTC and ISO-like timestamps
  so invalid build dates no longer normalize into misleading ages.

## 2.5.27 - 2026-06-01

- Made active flat-map pathways easier to read by increasing the bounded
  frequency/freshness width and opacity ramp for recently heard busy routes.
- Updated the route hue ramp so high-activity routes shift more visibly through
  cyan, teal, yellow, and rose while cooling routes shrink back.
- Added deterministic short-lived sparkle residue to recent packet comet trails
  without adding random particles or extra public API data.

## 2.5.26 - 2026-06-01

- Fixed the remaining public Chat duplicate edge case for symbol-only decoded
  messages, such as emoji-only group texts, by adding a safe fallback display
  dedupe key after control and variation selector cleanup.
- Kept the stronger 24h sender/text dedupe from 2.5.25 and added regression
  coverage for repeated symbol-only observer messages.

## 2.5.25 - 2026-06-01

- Hardened public Chat duplicate suppression again after live testing showed
  identical decoded messages could still repeat through separate route/observer
  contexts.
- The backend and frontend now collapse same sender/text messages across the
  full 24h Chat window, with stronger display normalization for hidden control
  characters and punctuation-only differences.

## 2.5.24 - 2026-06-01

- Tightened public Chat duplicate suppression so repeated decoded messages from
  the same sender/text collapse even when route context, region, payload label,
  or hidden formatting characters differ.
- Added backend and frontend regression coverage for route-context Chat repeats
  matching the live duplicate rows reported after 2.5.23.

## 2.5.23 - 2026-06-01

- Made NetGraph layout updates calmer: paused layout is now a true lock, small
  topology changes use a short gentle settle instead of a full pre-tick reset,
  and newly discovered nodes seed near known neighbors.
- Reduced disconnected-component spread by lowering global graph repulsion and
  strengthening component anchors.
- Reduced OpenFreeMap 3D churn by avoiding forced full 3D scene rebuilds on
  every map `moveend`/`zoomend`; the layer now repaints when signatures changed
  or active 3D animations are running.

## 2.5.22 - 2026-06-01

- Added SQLite partial indexes for public Chat message history and switched the
  Chat history query to use index-friendly message predicates.
- This fixes live 24h Chat requests that could still hit the 12s backend
  timeout after the 2.5.21 page cap when the database had millions of rows.
- Kept the public Chat response shape, cursor behavior, duplicate suppression,
  and privacy boundaries unchanged.

## 2.5.21 - 2026-06-01

- Added a Chat endpoint pressure guard by capping public Chat pages at 400 rows
  per request. Larger callers continue through cursor paging instead of making
  the server scan long enough to hit the request timeout.
- Kept the 2.5.20 Chat duplicate suppression, live-health Perf page, top-bar VU
  meters, build-age parsing fix, calmer Live Follow, and recent route glow
  polish intact.

## 2.5.20 - 2026-06-01

- Fixed the live Chat duplicate case where the same decoded public message
  appeared through different route/observer context in the same display window.
  Chat now dedupes by private server-side packet identity first, then by a
  public-visible sender/text/channel repeat window, without exposing hashes.
- Added a frontend Chat safety net so stale or mixed pages still collapse
  repeated public message copies before rendering.
- Added compact top-bar VU meters for per-minute live rates and tighter
  stylized count pills for packet, node, and route totals.
- Reworked the Perf page into a public-safe live deployment health view for
  backend/readiness, public API reachability, MQTT freshness, cache freshness,
  and routed traffic state.
- Fixed build-age parsing for compact UTC build stamps such as
  `20260601T085222Z`.
- Made Live Follow calmer with longer throttling and slower camera easing.
- Made recent packet pathways easier to see on the flat map by letting bounded
  active payload glows appear below detail zoom while idle routes remain gated.

## 2.5.19 - 2026-06-01

- Fixed the residual Chat duplicate case at two-minute bucket boundaries by
  replacing bucketed display dedupe with a sliding sender/text/channel window.
- Verified against live six-hour Chat data that repeated observer reports no
  longer produce visible duplicate rows in the same display window.

## 2.5.18 - 2026-06-01

- Fixed remaining visible Chat duplicates by collapsing repeated
  sender/text/channel observations in a short display window, even when
  multiple observers or distinct packet IDs reported the same decoded message.
- Kept later repeated messages visible so real follow-up chat is not hidden.
- Preserved public privacy boundaries: internal packet identity is still never
  exposed in Chat responses.

## 2.5.17 - 2026-06-01

- Fixed remaining public Chat duplicate rows by deduping internally on packet
  identity without exposing packet hashes in public responses.
- Preserved distinct repeated messages from different packets, so real
  retransmits still appear when the underlying packet identity differs.
- Fixed Docker Compose runtime metadata wiring so `GIT_SHA` and `BUILD_TIME`
  from `.env` are used by `/healthz` and `/readyz`.

## 2.5.16 - 2026-06-01

- Fixed public Chat duplicate rows by collapsing routed decoded messages to one
  observation-scoped message instead of one row per rendered route edge.
- Kept first-run Setup available from the Guide overlay while removing it from
  the permanent top navigation.
- Tightened the Canada droplet deploy flow so release metadata pinned in `.env`
  must be updated with the deployed git SHA and build time.

## 2.5.15 - 2026-06-01

- Added `GET /api/v1/public/chat` for sanitized decoded public text history,
  including routed and observer-only messages, region/IATA filters, channel
  labels, search, cursor paging, and 24h-capped windows.
- Added a top-bar Chat page beside NetGraph with search, region/channel
  filters, 1h/6h/24h windows, refresh, load older, empty/error/loading states,
  and mobile-safe layout.
- Stabilized NetGraph with metadata-stable visible graph selection,
  deterministic edge lane helpers shared by drawing, hit testing, and live
  comets, plus selected-neighborhood helper coverage.
- Added a pure tested OpenFreeMap packet replay chase helper built from shared
  3D route-arc samples, then wired CanadaMap's current replay camera math to it.
- Added `scripts/check-public-privacy.mjs` and wired it into the local release
  checks so public JSON surfaces are scanned for raw hashes, raw hex, full keys,
  secrets, debug fields, and other private material before release, including
  the public WebSocket hello frame.
- Kept hosted Canada behavior and existing public API response shapes
  compatible while adding only the new public-safe Chat endpoint.

## 2.5.14 - 2026-06-01

- Added `scripts/check-version-sync.mjs` to catch release metadata drift across
  backend defaults, Docker defaults, web package metadata, docs, top-bar keys,
  and changelog entries.
- Wired the version-sync guard into CI and both local release-check scripts.
- Updated docs to make the 2.5.14 release path and image tags explicit.
- Kept public API response shapes, hosted Canada behavior, and privacy
  boundaries unchanged.

## 2.5.13 - 2026-06-01

- Added a closeable browser Setup page beside Perf, Packets, and NetGraph for
  first-run deployment help.
- The Setup page generates public-safe `.env` starter snippets for world,
  Canada, and custom private-broker deployments.
- Kept MQTT credentials, channel secrets, raw packet data, and resolver debug
  details out of generated setup snippets.
- Updated docs and roadmap notes for first-run package installs and the
  confirmed 2.6 scope decisions.
- Kept public API response shapes, hosted Canada behavior, and privacy
  boundaries unchanged.

## 2.5.12 - 2026-06-01

- Removed full SQLite `Store.Stats()` work from the public cache refresh hot
  path. Packet totals now rely on the dedicated bounded packet-count refresh.
- Added public-safe health/readiness fields for public cache truncation, public
  Packets scan pressure, and packet-count refresh latency/failure status.
- Compact the in-app changelog popup into a current-release summary instead of
  an ever-growing release-history list.
- Updated the 2.6 roadmap with confirmed scope decisions for equal hosted/package
  priority, core NetGraph, cinematic 3D chase, browser first-run setup, and a
  public-safe Chat page.
- Kept public API response shapes, hosted Canada behavior, and privacy
  boundaries unchanged.

## 2.5.11 - 2026-05-31

- Started the NetGraph stabilization pass with tighter component packing so
  connected mesh groups waste less screen space.
- Added touch-friendly NetGraph pinch zoom while preserving pan, node drag, and
  route/node selection behavior.
- Aligned NetGraph node colors and glyph shapes with the shared map/Legend role
  visual registry.
- Indexed rendered NetGraph edges so live pulse/comet animation no longer scans
  every rendered route each frame.
- Kept NetGraph frontend-only with no public API, backend schema, or privacy
  boundary changes.

## 2.5.10 - 2026-05-31

- Reduced OpenFreeMap 3D scene churn by selecting only visible, focused, or
  recently active node/route candidates before rebuilding Three.js node models
  and route arcs.
- Added focused frontend tests for 3D node and route candidate selection,
  including offscreen stale-route exclusion and focused-route retention.
- Kept flat map behavior, public API response shapes, and privacy boundaries
  unchanged.

## 2.5.9 - 2026-05-31

- Hydrated recent observer-only public text activity from the initial public
  state snapshot so speech bubbles can appear after page reloads and polling
  fallback when the observer has a public-safe location.
- Made frontend speech-bubble eligibility depend on sanitized public
  `messageText` plus a public map anchor instead of payload-name matching.
- Added frontend tests for snapshot observer-burst hydration and stale/unmapped
  activity rejection.
- Kept public API response shapes and privacy boundaries unchanged.

## 2.5.8 - 2026-05-31

- Restored cleaner live Public group-text decoding by preferring verified
  packet-payload decrypts before falling back to broker-provided decoded JSON.
  This prevents bad upstream text decoding from being carried into public map
  speech bubbles when the packet itself can be decoded cleanly.
- Improved the Packets page with an explicit select/replay flow, clearer
  server-history search status, scanned-event counts, and guidance that replay
  pauses live, fits the full route, then plays one watchable packet comet.
- Added backend and frontend tests for the decoder preference and Packets
  search/status copy.
- Kept public API response shapes and privacy boundaries unchanged.

## 2.5.7 - 2026-05-31

- Cleaned up the top status bar with compact two-line metric pills, shorter
  logical labels, semantic theme-aware surfaces, and predictable number
  compaction for crowded desktop widths.
- Made the full Guide visually stronger with color-coded feature cards, larger
  icon scenes, route/dot motifs, and palette-aware guide accents.
- Added focused frontend tests for the compact status metrics.
- Kept public API response shapes and privacy boundaries unchanged.

## 2.5.6 - 2026-05-31

- Hardened the public Packets/history data path by extending the public
  location/hash lookup cache and serializing cold-cache rebuilds so concurrent
  Packets/VCR requests do not stampede SQLite.
- Increased public history and Packets request timeouts slightly so cold starts
  return useful partial data instead of transient `500 Internal Server Error`
  responses while the live database is warming under production traffic.
- Kept public API response shapes and privacy boundaries unchanged.

## 2.5.5 - 2026-05-31

- Centralized map and legend device visuals so repeaters, companions, rooms,
  observers, sensors, and other nodes use the same icon/color definitions.
- Added Sensor and Other entries to the compact Legend so every public node
  role rendered on the map is explainable.
- Improved the VCR timeline presentation by separating the packet-frequency
  spark bars from the live/replay baseline and adding a distinct playhead.
- Kept this as a small 2.6.0 polish phase with no backend API or privacy
  boundary changes.

## 2.5.4 - 2026-05-31

- Added a subtle live activity heatmap layer with sparkle highlights, plus a
  Map Settings toggle so users can hide it without changing packet ingest or
  route replay behavior.
- Made Live Follow usable for normal viewing by throttling repeated camera
  moves, avoiding duplicate targets, waiting for active camera motion to settle,
  lowering follow zoom, and using longer eased camera transitions.
- Added darker semantic route and selected-path colors for light mode so idle
  pathways, analysis paths, and selected/replayed routes remain visible across
  palettes.
- Tightened top status pill labels and sizing so the live status bar scans more
  cleanly on desktop.

## 2.5.3 - 2026-05-31

- Started the 2.5.3 mobile/UI stability pass with shared safe-area and z-index
  CSS tokens for top actions, sheets, map controls, VCR, Packets, settings, and
  palette popovers.
- Added the built-in MeshCore default Public channel key as a safe decoder
  fallback, so live Public group text can populate sanitized map speech bubbles
  without requiring a private `MESHCORE_CHANNEL_SECRETS` entry.

## 2.5.2 - 2026-05-30

- Started the 2.6 production polish track with a detailed local roadmap from
  2.5.2 through the 2.6.0 release gate.
- Fixed CI Docker smoke metadata so the expected image version is read from
  `VERSION` instead of a stale hardcoded release.
- Added configurable frontend deployment branding through `VITE_APP_BRAND_NAME`,
  `VITE_APP_BRAND_URL`, and `VITE_APP_BRAND_LOGO`, with a bundled generic
  MC-CartoLive logo as the package default.
- Refreshed the top-bar changelog, feature list, and guide copy for the 2.5/2.6
  track and added icon-led guide sections.
- Tightened top status pill copy and sizing so the live bar scans more cleanly
  on desktop.
- Updated map node rendering so role icons match the legend assets while
  keeping the existing circles for hit testing and state highlights.
- Made Packets refreshes abort stale requests so slow older filter searches
  cannot overwrite newer results.
- Added public-safe Packets scan summaries so rare filtered searches explain
  when older packet paths may still match without exposing packet hashes or raw
  paths.
- Added CI smoke coverage for the worldwide `r1` fixture so packaged builds
  prove non-Canada coordinates and generic regions still render true public
  routes.
- Restored decoded public text bubbles in clustered map views so messages can
  appear above the mappable sender node or observer fallback location even when
  the map is zoomed out.
- Thinned and lowered the VCR timeline track so the red live track no longer
  obscures the packet-frequency sparkline while scrubbing.
- Increased route/path overlay contrast to improve light-mode readability.

## 2.5.1 - 2026-05-26

- Polished mobile layout so Packets, VCR, palette picker, and Map Settings open
  inside safe-area bounds on vertical phone screens.
- Expanded Packets browsing to request 1000 true-path packets per page, retain up
  to 5000 loaded rows, and continue cursor-backed server filtering across the
  selected 1h/6h/24h window.
- Kept packet focus and replay distinct: selecting a packet fits/highlights the
  route, while Replay compacts the Packets tray, pauses live traffic, fits the
  route, waits, then force-animates the selected packet.
- Added a default zoom gate for live packet comets so low-zoom maps stay clean;
  forced replay bypasses the gate and a Map Settings override can show live
  comets at all zoom levels.
- Added VCR 8x and 16x speeds, replay loading spinner feedback, and a capped
  Laser Show mode for smooth replay of today's routed packet comets.
- Added OpenFreeMap packet replay chase-camera behavior for selected packet
  replays while preserving manual camera cancellation.
- Darkened route/pathway color tokens to keep route overlays readable in light
  mode across palettes.

## 2.5.0 - 2026-05-26

- Released `2.5.0 "World"` to make the packaged app work outside Canada while
  preserving the hosted Canada deployment scope through env config.
- Added configurable map region support with `MAP_REGION_PRESET=world|canada|custom`,
  `MAP_BOUNDS=minLat,minLng,maxLat,maxLng`, and preferred `PUBLIC_REGIONS`.
- Kept `PUBLIC_IATAS` as a deprecated 2.x compatibility alias; legacy Canada
  env files that only set `PUBLIC_IATAS` continue to use Canada bounds.
- Replaced Canada-only coordinate checks with one shared coordinate policy used
  by store writes, public inclusion, stats, diagnostics, and API map metadata.
- Treated MQTT topic labels as generic safe regions, accepting labels such as
  `YKF`, `r1`, `AUS`, and `EU-W` while keeping route resolution region-scoped.
- Added `region` aliases to public-safe nodes, packets, pulses, activities, and
  observer locations without removing existing `iata` fields.
- Updated frontend labels, Packets filters, NetGraph search, and initial map
  camera setup to use configured regions and bounds.
- Added a bundled `worldwide-r1.ndjson` fixture for non-Canada package smoke
  testing with private `r1`/`r2` topics and a routed pulse.
- Updated docs, `.env.example`, operator diagnostics, and live smoke scripts
  around worldwide/private broker deployments.

## 2.4.9 - 2026-05-25

- Upgraded OpenFreeMap mode with a lazy-loaded Three.js custom 3D layer for
  procedural repeater towers, T-Deck-style companions, room houses, observer
  beacons, elevated route arcs, and 3D packet comet trails.
- Added shared route arc sampling so routes, analysis paths, packet replay, and
  OpenFreeMap 3D visuals follow the same deterministic path geometry.
- Added Map Settings toggles for 3D node models, route arcs, packet comets, and
  building extrusions while keeping flat mode and existing 2D hit layers intact.
- Tuned OpenFreeMap dark/light terrain, hillshade, fog, and building extrusion
  colors for stronger overlay contrast without adding a new public API or tile
  proxy.
- Added top-bar `Changelog`, `Features`, and `Guide` popups, plus a first-visit
  welcome guide that users can dismiss through browser-local storage.
- Updated the README with current v2.4.9 screenshots for OpenFreeMap 3D, Packets,
  Plot Routes, and NetGraph.
- Added Three.js as a split frontend chunk, passed OpenFreeMap build overrides
  through Docker Compose, and updated release metadata/docs for `2.4.9`.

## 2.4.8 - 2026-05-25

- Added a top-bar `NetGraph` page at `#/netgraph` with a full-screen canvas graph
  of connected public route-bearing nodes.
- Built NetGraph from existing sanitized public state and WebSocket events only:
  no backend schema changes and no new public debug data.
- Added D3 force layout, graph pan/zoom/drag, search, fit/reset/pause controls,
  compact node and route inspectors, routed packet comets, and matched observer
  node glows.
- Added NetGraph tests for graph construction, live event matching, selection
  helpers, LinkBar routing, and panel rendering.
- Cleaned project documentation around the current supported Docker path, removed
  the obsolete separate OpenFreeMap compose stack, and dropped an oversized old
  screenshot collage from tracked docs assets.
- Updated release metadata/docs for `2.4.8`.

## 2.4.7 - 2026-05-24

- Added public-safe `/api/v1/public/packets` runtime counters to health/readiness output and bounded Packets history scanning with cursor continuation for rare filters.
- Made Packets filters more production-safe with debounced server-backed requests, stale generation guards, fixed payload choices, and explicit uppercase IATA entry.
- Extracted map camera, source update queue, analysis route, and playback buffering helpers to reduce large-file risk without changing public behavior.
- Added Vite manual vendor chunks, extended package smoke around public packet paths, and updated release metadata/docs for `2.4.7`.

## 2.4.6 - 2026-05-24

- Fixed packaging metadata for public release builds by aligning `.env.example`, Docker defaults, frontend package metadata, and backend default version with `2.4.6`.
- Added OCI labels and copied the synthetic fixture into the runtime Docker image so published containers can run a credential-free demo without a repository checkout.
- Added a GHCR publish workflow for tagged releases with version, minor, latest, and short-SHA image tags, plus SBOM/provenance build settings.
- Expanded release checks to include `/api/v1/public/packets` and made live smoke retry transient packet-ingest staleness before failing.
- Updated README, production, and security docs with published-image usage, image tags, public endpoint coverage, and container demo guidance.

## 2.4.5 - 2026-05-24

- Reworked Packets replay into a cinematic analysis flow: replay compacts the Packets panel, pauses live packet flow, fits the full true path, waits briefly, and force-animates the selected real packet path.
- Added a low-zoom highlighted analysis route layer so selected packets, Plot Routes paths, and phonebook paths stay visible when zoomed out without showing every idle route.
- Added a persistent Map Settings drawer with layer toggles for clusters, nodes, labels, known routes, highlighted paths, live comets, packet trails, observer bursts, and message bubbles.
- Added packet visual controls for comet speed, brightness, trail length, and animation style, plus reset-to-default behavior.
- Expanded `/api/v1/public/packets` with additive public-safe filters for IATA, payload, minimum hops, message-only packets, and sanitized query search.
- Increased Packets page default paging to 500 rows, added a windowed list, richer packet detail, public segment breakdown, focus/replay actions, and copyable public route IDs.
- Updated the 2.4 roadmap to cover 2.4.2 through 2.4.5 as the Packets and map-control production pass.

## 2.4.1 - 2026-05-24

- Added the top-bar `Packets` tab for public-safe true-path packet browsing, with 1h/6h/24h windows, search, region/payload/min-hop/message filters, newest-first paging, and load-older support.
- Wired packet rows to the live map: selecting a packet focuses its exact public segments and highlights matching route/node IDs; Replay sends the selected real path through the existing packet comet renderer.
- Changed `/api/v1/public/packets` to page newest-first while preserving oldest-first ordering for VCR `/api/v1/public/history`.

## 2.4.0 - 2026-05-24

- Documented the 2.4 true-path Packets roadmap: public-safe packet API groundwork, Packets tab UI, local-only explainability diagnostics, performance/mobile polish, and production gate.
- Added `GET /api/v1/public/packets`, a public-safe endpoint derived only from persisted mappable route pulse events with stable cursor pagination over the existing 24h history window.
- Added backend tests proving the packets endpoint excludes observer-only, unmappable, disallowed-IATA, and private/raw packet data while preserving sanitized public path details.

## 2.3.2 - 2026-05-24

- Added a top-bar `Perf` tab at `#/perf` with public-safe health, readiness, public state, public history, WebSocket, queue, source-update, and packet animation counters.
- Enabled browser-local performance counters from the Perf tab without sending telemetry or exposing raw packet hashes, full public keys, broker credentials, or resolver debug data.

## 2.3.1 - 2026-05-24

- Added a local `scripts/live-smoke.ps1` production smoke command that verifies health, readiness, public state, public history, WebSocket hello, deployed metadata, Docker health, and bundled `mc-diagnose` on the live droplet.
- Added an optional `-RunLiveSmoke` mode to the heavier release-check script so full local checks can chain into live droplet verification when needed.
- Updated release, production, development, and operator docs with the repeatable post-deploy smoke path and override options.

## 2.3.0 - 2026-05-24

- Started the 2.3 operator-confidence roadmap while keeping public map features stable.
- Added local release-soak scripts for Windows and Linux/macOS that poll health, readiness, public state, and public history over time.
- Expanded release-check output with live-confidence fields so operators can verify packet ingest, cache, and map motion states from one command.
- Updated the operator runbook, production notes, README, and roadmap around repeatable smoke checks, soak artifacts, and the 24h production candidate gate.

## 2.2.5 - 2026-05-24

- Completed the 2.2.0-2.2.5 live-confidence roadmap as an internal-first reliability pass.
- Added explicit public-safe live-confidence states for packet ingest, public cache freshness, routed pulse motion, observer burst motion, and overall live confidence.
- Tightened packet ingest freshness around the production target of packets normally arriving less than five seconds stale, while keeping quiet routed traffic separate from broken ingest.
- Expanded `mc-diagnose` with coordinate/IATA truth fields, public allowlist status, coordinate status, node/observer position source, label lookup, and label-vs-actual-IATA hints.
- Hardened frontend reconnect recovery by deduping repeated live activity and route pulse IDs after snapshot reconciliation.
- Bounded and instrumented live pending queues, added visibility-pause diagnostics, and kept browser diagnostics local-only.
- Added subtle route freshness de-emphasis for older known routes without adding public map labels or panels.
- Updated operator runbooks, production notes, and the roadmap for the 2.2 live-confidence release gate.

## 2.1.10 - 2026-05-24

- Completed the 2.1.6-2.1.10 reliability roadmap as a no-new-map-features hardening pass.
- Centralized public map inclusion decisions for nodes and observers with explicit mappability reasons: `mappable`, `missing_coords`, `zero_coords`, `outside_bounds`, and `iata_filtered`.
- Added a local operator diagnostic command for IATA/name/ID investigations so missing nodes and observers can be explained without exposing a public debug API.
- Ensured Docker builds pass backend version, git SHA, and build time into runtime health/readiness metadata.
- Added public-safe freshness fields to `/healthz` and `/readyz` for recent route pulses, observer activity, and public live freshness.
- Added SQLite indexes for observer/IATA diagnostic and live history pressure paths.
- Added release-check scripts plus an operator runbook and 2.1 reliability roadmap documentation.

## 2.1.5 - 2026-05-24

- Completed the 2.1 production-readiness hardening rollup while keeping the 2.1.0 feature set frozen.
- Added `/readyz` readiness checks beside cheap `/healthz` liveness, with public-safe cache age, DB readiness, static asset, MQTT, WebSocket, version, build, and API latency counters.
- Added lightweight runtime counters for public state/history/summary requests, public cache refresh failures, WebSocket queue drops, WebSocket ping failures, MQTT reconnects, dropped messages, malformed topics, and last MQTT message age.
- Reduced VCR history pressure by caching public node/observer lookup indexes and short-lived timeline summary responses while preserving the existing live-safe SQLite indexes.
- Added request-scoped timeouts to public state/history reads so overloaded DB work fails cleanly instead of hanging public handlers.
- Kept the public packet total tied to the real DB packet count even when public cache refreshes degrade under load, and filtered future-dated packet observations out of recent live snapshots.
- Hardened WebSocket reconnects with bounded jitter/backoff and explicit `recovering` state, and refreshed public snapshots after reconnect.
- Batched frontend MapLibre source updates behind animation frames, capped VCR replay queues, paused packet canvas work while tabs are hidden, and exposed opt-in browser-local performance counters.
- Expanded production, development, and privacy docs with `/readyz`, smoke checks, runtime counter guidance, SQLite backup/checkpoint notes, and public operational privacy boundaries.

## 2.1.0 - 2026-05-23

- Compact the VCR into a shorter bottom control surface while preserving hover timestamp, replay speed, missed comet replay, and mobile-safe offsets.
- Hide the full VCR by default, add a bottom-right live pulse clock, and move Live Follow, Plot routes, Select two map points, and VCR open into a bottom-left action dock.
- Hide the action dock while VCR is open so replay controls, Live Follow, and route-picking modes do not compete for the same bottom map space.
- Hide Busy Pathways by default and simplify it to a compact recent packet-count list for the last 15 minutes.
- Keep Search and compact Legend open together in the top-left stack without drag/snap overlap, with Busy Pathways restorable from the Panels menu.
- Add top-bar panel restore controls, dark/light mode, and a MeshCore Tower palette picker using the local palette set.
- Add light-mode map support for the flat CARTO basemap and theme-aware OpenFreeMap overlay colors.
- Add linked release/build metadata, build age, and best-effort GitHub stars/forks in the MeshCore Canada project bar.
- Add palette contrast safeguards for links, Legend, payload chips, VCR controls, and light-mode control surfaces.

## 1.7.0

- Added a VCR bar for the public map with Live, Pause, Replay missed, rewind, 1h/6h/24h timeline scopes, and 0.5x/1x/2x/4x replay speed controls.
- Added public-safe 24h replay history endpoints for sanitized routed `routePulse` events, plus timeline summary buckets.
- Buffered routed public WebSocket events while paused or replaying so missed packet comets can be replayed through the existing animation pipeline.
- Disabled Live Follow during paused/replay modes and shifted bottom map controls above the VCR surface on desktop and mobile.
- Reduced live-map node source churn by avoiding full node GeoJSON rebuilds for volatile label-clock and packet-counter updates.
- Temporarily removed PacketTV from the public UI while live-map performance and interaction polish are prioritized.

## 1.4.0

- Unified the map detail zoom gate so routes, route payload glow, packet canvas effects, nodes, observer icons, observer labels, and message bubbles enter and exit together.
- Reworked low-zoom clusters into role-split cluster visuals with payload-colored activity glow.
- Removed persistent ordinary node labels to stop label flicker; node names and last-heard age now live in hover/detail panels, while observer names remain persistent without age text.
- Added stale node styling: nodes grey after 30 minutes without mesh activity and darken after 60 minutes.
- Subdued idle route lines and kept packet payload glow active only on current comet routes.
- Replaced loud repeated observer rings with a sustained lower-pressure observer aura.
- Added PacketTV, a floating in-app chase-camera panel that prioritizes long live public routed packets.
- Vendored a curated asset subset for project branding, role icons, observer marker, packet dots, and legend polish.

## 1.3.5

- Improved route rendering performance for slower computers.
- Removed the unused invisible route hit layer now that routes are not directly clickable on the map.
- Moved live route payload glows to a small active-route-only GeoJSON source instead of evaluating every public route with feature-state updates.
- Added route render signatures so live packet counter changes do not force full route source rebuilds when geometry, frequency bucket, and focus state are unchanged.
- Slightly reduced passive route stroke cost while preserving selected node, phonebook path, plotted route, and packet comet visibility.
- Paced websocket event application by backend `displayAt` timestamps so bursty packet traffic ticks through the UI instead of landing in one frame.
- Replayed fresh snapshot route pulses after reconnect/poll recovery so packet comets do not disappear during websocket recovery.
- Made `/healthz` prefer cached public state so Docker health checks do not add SQLite pressure during live ingest.

## 1.3.1

- Changed phonebook defaults from max-hop-first to best useful routes first.
- Added phonebook search across node names, public node IDs, regions/IATAs, path labels, roles, and 3-byte route prefixes.
- Added phonebook sort controls for best route, shortest, busiest, nearest, and most recent.
- Added a distance filter so mobile users can narrow route-copy candidates before choosing a verified path.
- Removed direct map route-line click and hover selection so dense route areas do not steal node clicks.

## 1.3.0

- Added MeshCore 3-byte route copy support from selected phonebook paths.
- Added a Plot routes control for selecting two node endpoints and highlighting the shortest valid public route path.
- Added map-square route lookup by selecting two map corners, with matching routes highlighted and listed.
- Added decoded chatter history on selected node panels using sanitized public message text from the current live window.
- Documented the new route-copy privacy boundary: full public keys remain private, but six-character 3-byte route prefixes are public for verified path copy.

## 1.2.0

- Added node connectivity focus for repeaters, observers, rooms, companions, and sensors.
- Highlighted directly served routes and directly connected nodes when a node is selected.
- Added a reachable-node phonebook grouped by hop count, with path summaries and row-level path highlighting.
- Added close buttons, Escape dismissal, and empty-map-click dismissal for node and route panels.
- Kept the public HTTP and WebSocket API unchanged from 1.1.

## 1.1.0

- Added the MC-CartoLive project bar with MeshCore Canada, GitHub, version, and build links.
- Added a compact red Live Follow control that smoothly follows fresh packet movement.
- Stabilized the status bar so changing counters do not shift the toolbar.
- Improved mobile layout by hiding secondary panels and toasts, moving controls to the bottom, and keeping the map and packet motion as the focus.
- Kept the public API unchanged from 1.0.

## 1.0.0

- Initial public release of MeshCore MQTT Live Map, also known as MC-CartoLive.
- Added Docker Compose deployment, fixture replay mode, privacy-safe public APIs, route animation, cluster activity, observer bursts, message bubbles, and production documentation.
