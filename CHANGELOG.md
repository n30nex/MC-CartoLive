# Changelog

This changelog records the public release history at a useful level of detail.
Detailed patch-by-patch investigation notes and temporary planning material live
in Git history, not in the active documentation set.

## 2.9.2 - 2026-06-12

- Added durable public event storage with monotonic sequences, `/api/v1/public/events`,
  WebSocket `latestSeq`, lag/backfill metadata, and frontend reconnect backfill.
- Added public-safe NOC, viewport, coverage, LOS profile, schema, and integration
  summary endpoints behind flags while keeping raw/private analyzer scope out.
- Added a default compact NOC dashboard strip, public route quality buckets, and
  sequence-aware frontend dedupe.
- Added map runtime foundations for style profiles, overlay registry contracts,
  PMTiles graceful setup, and worker-ready GeoJSON transforms.
- Expanded public privacy scanning to the new public surfaces and added event,
  style registry, worker, and route-quality tests.
- Enabled app-shell/service-worker snapshot support with explicit opt-out.
- Upgraded the frontend build toolchain to Vite 8 with an audited esbuild
  dependency path.

## 2.9.1 - 2026-06-12

- Reduced default live-mode frontend churn by stopping routine full public-state
  polling while the public WebSocket is healthy.
- Changed route pulse handling so touched routes update incrementally instead
  of rebuilding, normalizing, and sorting every public route on each pulse.
- Gated activity heatmap GeoJSON work when the layer is hidden and throttled
  visible heatmap source refreshes to reduce MapLibre `setData` pressure.
- Slowed non-critical node label freshness refreshes and top-level idle clocks
  while keeping active VCR playback responsive.
- Stopped polling VCR history summaries while the VCR drawer is closed.
- Reserved a single mobile bottom-control zone so the dock, replay clock,
  drawers, MapLibre controls, and export actions no longer overlap on narrow
  screens.
- Integrated the PR #5 chrome-overlap fixes so workspace panels suppress
  floating map panels, PacketTV suppresses the bottom dock, and the mobile
  release bar stays compact.
- Hardened public WebSocket recovery on browser construction/send failures,
  skipped gzip work for already-compressed static assets, and made live hub
  drop accounting concurrency-safe.
- Updated in-app release highlights, version metadata, release docs, and
  validation notes for the 2.9.1 performance patch.

## 2.9.0 - 2026-06-12

- Shipped the visitor UX rollup on top of the 2.8.x propagation and flat-first
  map foundation without changing public API shapes.
- Added frontend-only layer presets for Live, Clean, Analysis, and 3D map
  workflows while preserving existing packet visual preferences.
- Reworked Map Settings into clearer Base, Live, Routes, Analysis, and Visuals
  groups.
- Added local-only first-visit orientation and refreshed in-app help for live
  comets, trails, nodes, panels, VCR, and Known Pathways.
- Improved selection drawer hierarchy with compact node and route summary
  metrics before detailed public-safe fields.
- Updated release documentation, validation evidence, and the in-app release
  highlights for the 2.9.0 line.

## 2.8.2 - 2026-06-12

- Made the first map view flatter and quieter by defaulting terrain relief and
  propagation overlays off, including a one-time migration for legacy 2.8.1
  saved settings.
- Removed the top-bar propagation event counter while keeping propagation
  history available from Map Settings and the propagation drawer.
- Kept flat maps free of DEM hillshade and softened dark-mode relief contrast
  when terrain is manually enabled.
- Replaced the crowded mobile top action strip with a bottom control dock and
  sheet for map settings, Known Pathways, panels, theme, palette, and secondary
  map actions.
- Updated 2.8.2 release metadata, docs, tests, and validation checklist.

## 2.8.1 - 2026-06-11

- Added public-safe propagation insights for already-public high-confidence RF
  paths, including `/api/v1/public/propagation`, SQLite retention, cautious
  weather-supported scoring, and replay/focus actions.
- Added Open-Meteo weather-model context and NOAA SWPC solar context while
  keeping labels probabilistic: `Tropo possible` or `Long-distance event`.
- Changed first-run map defaults so Known Pathways are off by default, added a
  prominent red/green toolbar toggle, and added propagation insights controls.
- Improved map zoom-through behavior by fading cloud cover out before the
  detail route/label boundary.
- Replaced jitter-prone DOM node labels with viewport-aligned MapLibre symbol
  labels anchored to node geometry.
- Repaired DEM terrain behavior with separate terrain/hillshade raster-dem
  sources, actual MapLibre terrain toggling, and restrained hillshade.
- Redesigned Chat with a clearer operations header, filter chips, compact
  stats, richer route context, and mobile-friendly dense rows.

## 2.8.0 - 2026-06-11

- Promoted the World Release 2 feature line to production.
- Stabilized Packets, Chat, and NetGraph with desktop/mobile browser-smoke
  coverage.
- Disabled the service worker by default, added legacy service-worker/cache
  cleanup, and added one-shot lazy chunk reload recovery.
- Fixed SQLite production migrations for old databases and public packet-path
  projection columns.
- Fixed public Packets and History projection fallback so incomplete
  projections cannot hide valid legacy RF edge events.
- Added explicit proxy-header trust configuration for public rate limiting.
- Hardened deployment with safe SQLite backup, host readiness checks,
  dirty-tree refusal, readiness diagnostics, and rollback.
- Updated privacy scans, release checks, CI triggers, browser smoke, and
  release evidence for the production gate.

## 2.7.x - 2026-06

- Added system theme support, PWA assets, node freshness indicators, and route
  elevation profiles.
- Hardened WebSocket, MQTT, retention, observer, and graceful-shutdown behavior.
- Expanded decoder, resolver, and map-layer tests.
- Improved OpenFreeMap/3D performance, palette behavior, label stability, and
  live-map rendering pressure.
- Added lint/audit/vulnerability checks and improved CI release hygiene.

## 2.6.x - 2026-06

- Released the world-ready operations baseline while keeping the hosted Canada
  deployment Canada-scoped through configuration.
- Added worldwide/private broker support with configurable regions, bounds, and
  synthetic fixtures.
- Improved Packets and Chat workspace presentation, route replay, GIF export,
  public-safe search, and NetGraph usability.
- Reduced large-database pressure by using sanitized projected packet-path
  tables where available.
- Updated package smoke, release checks, operator documentation, and image
  publishing workflow.

## 2.5.x - 2026-05 to 2026-06

- Built the Packets, VCR, map-control, packet-path projection, public privacy,
  and performance foundations that later shipped as the 2.6 world-ready line.
- Added public-safe packet browsing, route replay, map layer controls, render
  quality controls, and OpenFreeMap/3D rendering improvements.
- Added background packet-path projection/backfill/search indexing, plus
  public-safe health/readiness counters for operators.
- Reworked live-map animation pacing, cache usage, database pressure, and
  package smoke so larger deployments remain responsive.
- Detailed 2.5.x patch entries were intentionally consolidated because they
  were implementation history rather than current operator documentation.

## 2.4.x - 2026-05

- Added public-safe Packets browsing, true-path replay, expanded map controls,
  route highlighting, and NetGraph.
- Introduced OpenFreeMap 3D, terrain/hillshade tuning, Three.js custom layers,
  and early guide/changelog UI.
- Added published-image metadata, OCI labels, synthetic fixture packaging, and
  GHCR release workflow support.

## 2.3.x - 2026-05

- Added public-safe performance and live-confidence views for operators.
- Added repeatable local and live smoke checks for health, readiness, public
  APIs, WebSocket hello, deployment metadata, and bundled diagnostics.
- Improved release-soak scripts and operator runbooks for production candidate
  validation.

## 2.2.x - 2026-05

- Added public-safe live-confidence states for packet ingest, public cache,
  routed pulse motion, observer burst motion, and overall map freshness.
- Expanded `mc-diagnose` with mappability, coordinate, region, and label truth
  fields without exposing a public debug API.
- Hardened reconnect recovery, pending queues, visibility pause behavior, and
  public runtime diagnostics.

## 2.1.x - 2026-05

- Added readiness checks beside liveness, with public-safe cache, DB, static
  asset, MQTT, WebSocket, version, build, and API latency signals.
- Reduced VCR and public-state database pressure through cached lookup indexes
  and bounded reads.
- Improved frontend reconnect recovery, source-update batching, VCR queue caps,
  and browser-local performance counters.
- Reworked the map chrome with a compact VCR, bottom action dock, theme/palette
  controls, linked release/build metadata, and improved mobile layout.

## 1.x - Initial Public Map

- Launched the Dockerized public MeshCore MQTT live map with fixture replay,
  privacy-safe public APIs, route animation, clusters, observer bursts, message
  bubbles, and production documentation.
- Added MeshCore route-copy support, phonebook connectivity, route plotting,
  selected-node message history, live follow, PacketTV, and early map
  performance improvements.
