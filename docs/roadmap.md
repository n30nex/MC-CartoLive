# MC-CartoLive Roadmap

This document tracks the active release focus. Completed release details belong
in `CHANGELOG.md`; operator procedures belong in `docs/operator-runbook.md`.

## Current Baseline

Version `2.5.47` is the active foundation patch toward the next production-ready
`2.6.0` release.

- Detailed next-phase plan: [2.5.2 to 2.6.0](roadmap-2.5.2-to-2.6.0.md).
- Public map behavior remains stable while package installs support
  worldwide/private brokers through configurable region labels and map bounds.
- Current patch focus: public-safe projected packet-path FTS search indexing,
  public-safe Packets projection-path observability, public-safe packet-path
  projection backfill observability, bounded public packet-path projection
  backfill, public packet-path projection groundwork,
  release workflow Node 24 compatibility,
  cacheless public-state fallback pressure reduction, ingest observer lookup
  pressure reduction, runtime counter logging pressure reduction, NetGraph
  hidden-tab animation pausing, render-quality controls, quality-aware animation
  frame pacing, calmer Live Follow, smoother OpenFreeMap 3D and flat-map
  animation budgets, backend scale, Packets/VCR data-path stability, light-mode
  route contrast, and mobile/browser regression coverage.
- Public packet/path data remains sanitized and schema-compatible.
- The supported runtime is the main Docker Compose service or the published
  GHCR image. OpenFreeMap is an in-app map toggle, not a separate stack.
- Release readiness is verified with backend tests, frontend tests/build, Docker
  build, packaged-image smoke, live smoke, and privacy checks.

## Active Maintenance Focus

- Keep packet ingest, public cache, WebSocket fanout, public history, and public
  packet paths observable through public-safe health/readiness counters.
- Keep the Packets page server-backed, cursor-stable, and bounded under rare
  filters or large 24h windows.
- Keep NetGraph frontend-only, smooth, privacy-safe, and core to the 2.6 user
  experience while it renders live connected public routes from existing state
  and WebSocket events.
- Add a public-safe Chat page for sanitized decoded text history with
  region/IATA and channel filters.
- Keep browser first-run setup available for world, Canada, and custom packaged
  installs so new operators can generate safe starter env settings without
  reading code.
- Keep OpenFreeMap 3D frontend-only, smooth, and optional: the true 3D layer is
  a visual overlay over the existing 2D map sources, not a new public data API.
- Keep map rendering smooth on modest clients by avoiding unnecessary source
  rebuilds, duplicate replay schedulers, and hidden-tab animation work.
- Keep production deployment repeatable through release, smoke, major-release
  screenshot artifacts, and operator diagnostic scripts.
- Keep docs concise enough that new operators can deploy, smoke test, diagnose,
  back up, restore, and upgrade without reading historical planning notes.

## 2.5.47 Patch Focus

- Add a public-safe FTS index for projected packet-path search fields.
- Use indexed search only for projected packet windows where the search index
  is complete; otherwise fall back to the existing search path.
- Preserve public packet response shapes, true-route validation, hosted Canada
  scoping, package worldwide behavior, and privacy boundaries.

## 2.5.46 Patch Focus

- Expose public-safe `/api/v1/public/packets` projection-path counters in
  `/healthz` and `/readyz`.
- Count indexed projection serves, conversion fallbacks, projection errors, and
  whether the latest requested packet window was projection-complete.
- Preserve public packet response shapes, true-route validation, hosted Canada
  scoping, package worldwide behavior, and privacy boundaries.

## 2.5.45 Patch Focus

- Expose public-safe packet-path projection backfill progress in `/healthz` and
  `/readyz` so upgraded databases are easier to diagnose while they catch up.
- Report last backfill latency, scan/projected/mappable/non-mappable counts,
  failure count, and whether more catch-up work remains.
- Preserve public response shapes, true-route validation, hosted Canada
  scoping, and privacy boundaries.

## 2.5.2 Patch Focus

- Keep release metadata in sync across app, Docker, CI, health checks, and docs.
- Make packaged deployments look generic by default while hosted Canada can
  override top-bar brand name, URL, and logo through env build args.
- Keep Packets request handling generation-safe so slow stale searches cannot
  replace newer filtered results.
- Show public-safe Packets scan progress so rare filters explain when older
  true-path packets may still match.
- Make status pills, map node icons, VCR scrub visuals, and light-mode routes
  cleaner without changing public API schemas.
- Keep the CI packaged-image smoke covering both the hosted-style fixture and a
  worldwide generic-region fixture.
- Restore decoded public text message bubbles above mappable sender nodes or
  observer fallback locations, including while the map is clustered.

## 2.5.3 Patch Focus

- Continue the mobile/UI stability work started after 2.5.2.
- Decode the built-in MeshCore default Public channel for sanitized speech
  bubbles without requiring a private channel-secret env override.

## 2.5.4 Patch Focus

- Make Live Follow usable for viewers by throttling repeated camera movements
  and using slower eased transitions.
- Add a subtle activity heatmap layer that can be toggled independently from
  nodes, routes, comets, and packet ingest.
- Keep light-mode pathway and analysis route colors readable with semantic
  darker route colors.
- Continue tightening top status pills and guide/changelog copy for every
  release.

## 2.5.5 Patch Focus

- Keep map node icons and Legend role entries driven from the same public visual
  registry.
- Add missing Sensor and Other role entries to the compact Legend.
- Improve the VCR scrubber so packet-frequency bars sit above a subtle
  live/replay baseline with a distinct playhead instead of a heavy rail through
  the bars.
- Keep this release frontend-only with no public API or privacy-boundary
  changes.

## 2.5.6 Patch Focus

- Reduce transient Packets/VCR load failures by extending the public
  location/hash cache and serializing cold-cache rebuilds.
- Increase public history and Packets request timeouts slightly so cold starts
  can return useful bounded results under live traffic.
- Keep public API shapes, Packets pagination, and privacy boundaries unchanged.

## 2.5.7 Patch Focus

- Make crowded top status pills more compact, logical, and theme-aware with
  clear metric labels.
- Make the in-app guide more visual with color-coded feature cards, larger
  icon scenes, and route/pulse motifs.
- Keep this release frontend-only with no public API or privacy-boundary
  changes.

## 2.5.8 Patch Focus

- Prefer verified Public group-text packet decrypts over broker-provided
  decoded JSON when both are available, so new map speech bubbles use clean
  sanitized text.
- Make Packets page selection/replay behavior easier to understand with an
  explicit replay flow and visible server-history search status.
- Keep public API shapes and privacy boundaries unchanged.

## 2.5.9 Patch Focus

- Hydrate recent observer-only public text activity from the initial public
  state snapshot so speech bubbles can appear after a reload or polling
  fallback.
- Make frontend speech-bubble eligibility depend on sanitized public
  `messageText` with a public map anchor, rather than fragile payload-name
  matching.
- Keep routed text messages anchored to public source endpoints and
  observer-only text anchored to public observer locations when available.
- Keep public API shapes and privacy boundaries unchanged.

## 2.5.10 Patch Focus

- Reduce OpenFreeMap 3D scene churn by selecting only visible, focused, or
  recently active candidates before rebuilding Three.js node models and route
  arcs.
- Add focused frontend tests for 3D candidate selection so dense live route
  changes do not force full-scene work unnecessarily.
- Keep flat map behavior, public API shapes, and privacy boundaries unchanged.

## 2.5.11 Patch Focus

- Make NetGraph steadier by preserving stable node positions across live
  topology refreshes and packing components closer to the viewport center.
- Align NetGraph node colors and shapes with the same role visual registry used
  by the map and Legend.
- Add touch-friendly NetGraph pinch zoom and pan/select handling on mobile.
- Index rendered graph edges so live pulse/comet drawing does not scan every
  route every animation frame.
- Keep NetGraph frontend-only with no public API or privacy-boundary changes.

## 2.5.12 Patch Focus

- Remove full SQLite stats counts from the public cache refresh hot path.
- Expose public-safe cache truncation, packet search scan pressure, and packet
  count refresh health in `/healthz` and `/readyz`.
- Document and test SQLite backup, checkpoint, query-budget, and slow-read
  behavior for long-running public hosts.
- Keep public API shapes, public privacy boundaries, and hosted Canada behavior
  unchanged.

## 2.5.13 Patch Focus

- Add a closeable browser Setup page beside Perf, Packets, and NetGraph.
- Generate public-safe starter `.env` snippets for world, hosted Canada, and
  custom private-broker deployments.
- Keep the generated setup guidance free of MQTT credentials, channel secrets,
  raw packet material, and resolver debug data.
- Document that browser setup is a convenience layer; true route validation,
  region scoping, and public privacy boundaries remain unchanged.

## 2.5.14 Patch Focus

- Add a release metadata drift guard that derives expectations from `VERSION`.
- Run that guard from release-check scripts and CI so backend defaults, Docker
  defaults, web package metadata, docs, top-bar keys, and changelog entries
  cannot silently drift.
- Add a public JSON privacy scan to local release checks so public endpoints are
  checked for raw hashes, raw hex, full keys, secrets, tokens, and debug fields.
- Keep this patch operational only: no public map feature or API schema change.

## 2.5.15 Patch Focus

- Add a public-safe Chat page beside NetGraph for sanitized decoded public text
  history with region, channel, time-window, search, refresh, and cursor paging.
- Keep Chat backed by a bounded public endpoint that includes routed and
  observer-only public text without exposing raw packet data or secrets.
- Stabilize NetGraph with metadata-stable visible graph selection and
  deterministic edge lane helpers used by rendering, hit testing, and comets.
- Move OpenFreeMap packet replay chase math into a pure tested helper built on
  shared 3D route-arc samples.
- Keep public privacy checks in release scripts, including public JSON and the
  `/ws/public` hello frame.

## 2.5.16 Patch Focus

- Collapse duplicate Chat rows from multi-edge routed packets so one decoded
  message appears once in the public Chat page.
- Keep first-run Setup under the Guide overlay instead of the permanent top
  navigation.
- Keep live Canada deploy metadata aligned with the deployed git SHA while
  preserving `MAP_REGION_PRESET=canada`.

## 2.5.44 Patch Focus

- Backfill missing recent public-safe packet-path projection rows in bounded
  startup batches so upgraded databases can reach the indexed Packets path
  without waiting for old rows to age out.
- Keep the catch-up window and batch size operator-tunable through env config.
- Preserve public response shapes, true-route validation, hosted Canada scoping,
  and privacy boundaries.

## 2.5.43 Patch Focus

- Add an internal public-safe packet-path projection for sanitized true-route
  packet records.
- Write projection rows when live edge events are inserted and mark invalid
  edge rows as non-mappable so projection completeness remains correct.
- Let `/api/v1/public/packets` prefer projected packet paths when the requested
  window is fully projected, while preserving fallback conversion for older DB
  windows.
- Keep public response shapes, true-route validation, hosted Canada scoping, and
  privacy boundaries unchanged.

## 2.5.42 Patch Focus

- Update CI and GHCR publish workflows to current Node 24-capable GitHub and
  Docker action majors.
- Keep existing backend tests, frontend tests/build, Docker smoke, worldwide
  fixture smoke, GHCR image publish, SBOM, and provenance attestation behavior
  intact.
- Remove the GitHub Actions Node 20 action-runtime deprecation warning from the
  package release path.

## 2.5.41 Patch Focus

- Remove the remaining full `Store.Stats()` multi-count query from the legacy
  `/api/v1/public/state` fallback path.
- Keep the normal cached public-state path unchanged.
- If the fallback is used, combine the bounded live-state read with the cheaper
  packet-count path for the public packet total.
- Keep public APIs, response schemas, privacy boundaries, and hosted Canada
  behavior unchanged.

## 2.5.40 Patch Focus

- Remove the all-observer scan from ingest fallback endpoint matching.
- Use the exact indexed public-key/region observer lookup after normal node
  lookup misses.
- Keep route/message anchoring, true-route validation, public schemas, privacy
  boundaries, and hosted Canada behavior unchanged.
- Add backend coverage for positioned observer conversion, invalid coordinate
  rejection, and exact-region observer lookup.

## 2.5.39 Patch Focus

- Remove periodic full `Store.Stats()` database counts from runtime counter
  logging.
- Log cached public-state and runtime counters for packet totals, public
  node/route counts, cache age/truncation, websocket pressure, MQTT freshness,
  and refresh latency.
- Keep public APIs, response schemas, privacy boundaries, and hosted Canada
  behavior unchanged.

## 2.5.38 Patch Focus

- Stop NetGraph canvas animation frames and D3 force layout work while the
  browser tab is hidden.
- Resume drawing cleanly when NetGraph becomes visible again without changing
  graph topology, public API schemas, or privacy boundaries.
- Add focused helper coverage for the NetGraph frame gate.
- Keep hosted Canada behavior unchanged.

## 2.5.37 Patch Focus

- Pace flat-map packet canvas frames by selected render quality so `Smooth` and
  `Balanced` modes reduce frame cadence as well as visual density.
- Pace OpenFreeMap 3D custom-layer repaints by selected render quality so live
  3D comets and glows do not create an uncapped repaint loop.
- Make Live Follow slower and broader again with lower zoom targets and longer
  camera spacing.
- Make Perf primary cards answer `live`, `degraded`, `quiet`, or `not live`
  before showing public-safe details.
- Keep public APIs, privacy boundaries, and hosted Canada behavior unchanged.

## 2.5.36 Patch Focus

- Add a persisted Smooth/Balanced/High render quality control under Map
  Settings.
- Use the selected render quality to scale OpenFreeMap 3D node, route, comet,
  observer glow, and route-arc geometry budgets.
- Use the selected render quality to scale flat-map packet canvas DPR, masking,
  residue, observer aura, and sparkle work.
- Dispose capped/dropped 3D comet and observer-glow objects immediately so
  long live sessions do not accumulate hidden Three.js objects.
- Keep public APIs, privacy boundaries, and hosted Canada behavior unchanged.

## 2.5.35 Patch Focus

- Simplify Perf into direct backend, frontend/public API, MQTT, and live-route
  status instead of broad operational detail.
- Reduce Perf refresh pressure by checking only health, readiness, and public
  state on the five-second status loop.
- Make Live Follow slower, lower-zoom, and linear so viewers can track camera
  movement instead of being jumped rapidly between packets.
- Extend palette-driven warning/error tokens to more UI status surfaces.
- Add a compact NetGraph legend and selected-node icons that reuse the same
  role and payload visual registries as the map legend.

## 2.5.34 Patch Focus

- Add a repeatable browser smoke gate for desktop `1920x1080` and mobile
  `390px` layouts covering the live map, Perf, Packets, Chat, and NetGraph.
- Wire the browser smoke into release checks as an explicit opt-in so
  release-candidate UI gates can produce local screenshots without slowing
  normal quick checks.
- Fix the mobile Perf/Packets clipping found by the new smoke gate by resetting
  the shared centered panel transform on narrow viewports.

## 2.5.33 Patch Focus

- Make OpenFreeMap selected-packet replay feel more cinematic with a trailing
  chase camera that frames the packet forward along the route instead of
  centering directly on each packet position.
- Add tested distance-aware follow distance, lookahead distance, pitch, and
  smoother replay camera cadence.
- Keep the change frontend-only and preserve flat-map replay behavior, public
  API compatibility, and privacy boundaries.

## 2.5.32 Patch Focus

- Reduce OpenFreeMap 3D object pressure at detail zoom with adaptive node and
  route-arc budgets that scale by zoom.
- Render ordinary nodes as lightweight 3D markers near the detail threshold
  while selected, route-path, and neighbour nodes keep full procedural models.
- Keep OpenFreeMap 3D frontend-only, optional, and compatible with existing
  map hit-testing and public data/privacy boundaries.

## 2.5.31 Patch Focus

- Fix the remaining visible public Chat repeat case by collapsing long decoded
  text rebroadcasts inside a short repeat window even when route or sender
  wrappers differ.
- Keep ordinary short replies from different senders visible so normal public
  chat still reads like a conversation.
- Keep the public Chat API shape and privacy boundaries unchanged.

## 2.5.30 Patch Focus

- Reduce OpenFreeMap 3D route arc geometry cost by using cheaper tube detail
  for ordinary arcs while preserving detail for selected and focused paths.
- Cache 3D packet comet route-arc samples and projected vectors at comet
  creation so per-frame animation updates move existing buffers instead of
  resampling arcs and replacing trail geometry.
- Keep 3D node scenes stable when only volatile activity counters change and
  the visible model set/static node properties remain the same.
- Keep flat mode unchanged and keep public APIs/privacy boundaries unchanged.

## 2.5.29 Patch Focus

- Make NetGraph canvas rendering follow the active app palette and light/dark
  mode for its background, selected pathway color, fallback link color, labels,
  observer accents, and comet head contrast.
- Move NetGraph panel chrome onto the shared app surface, border, shadow, text,
  accent, and light-mode tokens so it visually matches the map, Legend,
  Packets, Chat, and top bar.
- Render Chat from a final de-duped view model so repeated decoded sender/text
  sightings cannot appear as duplicate rows after refreshes or older-page loads.
- Keep NetGraph frontend-only and preserve public API and privacy boundaries.

## 2.5.28 Patch Focus

- Replace the Perf page with a concise public-safe live status view that checks
  backend readiness, browser public API reachability, MQTT ingest freshness,
  routed map motion, WebSocket clients, and Packets/Chat endpoints.
- Make Live Follow calmer by using longer eased camera moves, lower follow zoom
  targets, a longer movement interval, and a stronger moving-camera guard.
- Make compact top-bar build-age parsing strict for compact UTC and ISO-like
  release timestamps.

## 2.5.27 Patch Focus

- Make flat-map live motion more obvious without exposing idle route clutter:
  recently heard busy routes get thicker, higher-contrast hue-shifted lines and
  stronger payload glow while cooled routes shrink and fade back.
- Add deterministic sparkle residue to recent packet comet trails with tight
  per-route caps so live packets read better on the map without adding random
  particles or public data fields.
- Keep the 2.5.23 NetGraph and OpenFreeMap 3D stability work intact while the
  2.6.0 roadmap continues.

## 2.5.26 Patch Focus

- Close the live Public Chat duplicate loophole where the same sender/text can
  be repeated through different route context, payload labels, hidden formatting
  characters, or symbol-only decoded text.
- Keep public response shape, cursor behavior, and privacy boundaries
  unchanged.

## 2.5.23 Patch Focus

- Make NetGraph layout pause a true lock that is not disturbed by live topology
  refreshes.
- Reduce NetGraph jitter and empty-space spread by using gentler incremental
  settling, neighbor seeding for newly discovered nodes, lower global repulsion,
  and stronger component anchors.
- Reduce OpenFreeMap 3D scene churn by keeping move/zoom-end rebuilds
  signature-gated and repainting only when scene signatures changed or 3D
  animations are active.
- Keep public APIs, packet schemas, privacy boundaries, and hosted Canada
  behavior unchanged.

## 2.5.22 Patch Focus

- Add SQLite partial indexes for public Chat message reads so 24h Chat windows
  stay responsive on the live multi-million-row database.
- Use index-friendly message predicates in the Chat history query.
- Keep public response shape, cursor behavior, duplicate suppression, and
  privacy boundaries unchanged.

## 2.5.21 Patch Focus

- Cap public Chat pages at 400 rows so larger 24h requests continue through
  cursor paging instead of spending the full request timeout.
- Keep public response shape and privacy boundaries unchanged.
- Carry forward the 2.5.20 Chat duplicate suppression and live-health polish.

## 2.5.20 Patch Focus

- Collapse visible Chat repeats across route and observer context by using
  private server-side packet identity first and a public display repeat window
  as a fallback.
- Add compact top-bar VU meters and stylized count pills so live traffic rates
  are readable at a glance.
- Replace Perf Lab copy with a public-safe live deployment health view for
  backend, public API, MQTT, cache, and routed traffic status.
- Fix compact build-age parsing, slow Live Follow camera moves, and make recent
  packet pathways more visible below detail zoom without exposing all idle
  routes.
- Keep Chat public-safe and continue the 2.6 production-readiness track.

## 2.5.19 Patch Focus

- Use a sliding decoded-message dedupe window for Chat so repeated
  multi-observer reports do not leak through display bucket boundaries.
- Keep public response shape and privacy boundaries unchanged.

## 2.5.18 Patch Focus

- Collapse repeated decoded Chat messages reported by multiple observers or
  repeated packet IDs while keeping later follow-up messages visible.
- Keep Setup under Guide instead of the permanent top bar and keep release
  metadata pinned to the deployed commit.

## 2.5.17 Patch Focus

- Deduplicate Chat by internal packet identity, never by exposed packet data, so
  multi-observer/routed repeats do not duplicate a decoded message.
- Preserve distinct retransmitted messages when the underlying packet identity
  differs.
- Fix Docker Compose metadata fallback so both the frontend build and backend
  health/readiness can use `GIT_SHA` and `BUILD_TIME` from `.env`.

## Next Cleanup Candidates

- Continue the started mobile stability pass with browser screenshots for
  390px vertical layouts, palette selection, Packets, VCR, and Map Settings.
- Continue splitting large frontend surfaces only when behavior is covered by
  tests and the visible UI stays unchanged.
- Add focused regression tests for any packet filtering, replay, map source, or
  privacy boundary bug that appears in production.
- Review screenshots and docs each release so README examples reflect the
  current UI and do not keep obsolete release-specific assets.
- Keep local-only artifacts, databases, and generated output out of Git and out
  of Docker build contexts.

## Non-Goals

- No public raw packet hashes, raw path hex, full public keys, resolver debug
  fields, private payloads, broker credentials, or operator config.
- No public admin/debug page without a separate access-control design.
- No guessed map routes. Missing data should be explained by diagnostics, not
  invented on the public map.
