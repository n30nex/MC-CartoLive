# Changelog

This changelog records the public release history at a useful level of detail.
Detailed patch-by-patch investigation notes and temporary planning material live
in Git history, not in the active documentation set.

## 3.2.1 - 2026-07-11

- Restored continuous public traffic flow by accepting sparse monotonic event
  cursors, preserving durable reconnect semantics, and rendering unsequenced
  fallback events without corrupting the resume cursor.
- Restored visible low-zoom Watch motion with live comets and cluster activity,
  including a migration for unmodified saved map settings.
- Kept derived projection moving through storage-warning and primary-queue
  pressure, and serialized quiet-window-gated historical backfills so optional
  recovery work cannot monopolize the single SQLite writer.
- Hardened public cache reconciliation and live fallback behavior against
  concurrent updates and persistence failures.
- Bounded long-running map dedupe state, disposed queued map-source work on
  teardown, and periodically refreshed route freshness without redraw churn.
- Removed the Timeline/VCR and RF Replay Studio surfaces so historical playback
  can no longer replace the current live stream. Direct packet-path map
  animation remains available from sanitized packet records without pausing
  current traffic.
- Made desktop/mobile browser smoke and active-flow soak fail-closed release
  evidence; made the privacy scanner honor bounded `Retry-After` responses after
  browser load; repaired the sandboxed post-release audit and remote metrics path.
- Replaced 3.2.0-specific/one-off release automation with version-derived,
  immutable dual-image publication: generic world tags and separate Canada
  tags/digest for the hosted droplet.
- Added truthful 3.2.0 errata, 3.2.1 release/rollback/storage/security/API/load
  documentation, and exact world/Canada release-manifest evidence.

## 3.2.0 - 2026-07-10

- Added RF Replay Studio, compact/accessibility-focused controls, reduced-motion
  route stories, privacy-safe deep links, and on-demand client export.
- Added compact bootstrap, viewport clusters, reset-safe public event cursors,
  and public-safe MQTT session/dataset/storage health fields while preserving
  existing endpoint compatibility.
- Added schema version 32000, seven-day observations, 24-hour public events,
  incremental SQLite maintenance, optimized event queries, and fail-closed
  public handling for unbounded retention.
- Updated Go to 1.25.12 and the audited React/Vite/Vitest/Playwright dependency
  set; expanded race, vulnerability, privacy, browser, supply-chain, and
  deployment contract gates.
- Compiled release identity into the artifact and replaced production host
  builds/branch resets with immutable digest deployment and rollback.
- Added data-preserving hosted cutover evidence, optional fresh-database
  controls, bounded watchdog,
  multi-platform candidate promotion, release manifest, deployment archive,
  OpenAPI, SPDX SBOM, checksums, provenance, and operator documentation.
- Folded the unreleased 3.1 candidate work into 3.2.0. No 3.1 release tag is
  required or supported as an upgrade waypoint.

## Unreleased 3.1 candidate (folded into 3.2.0)

This candidate was never tagged or published. Its changes ship as part of
3.2.0 and must not be treated as a supported upgrade waypoint.

- Refreshed frontend dependency lockfile state with `npm audit fix` and kept the
  public API/schema boundary stable.
- Replaced Vite manual chunking with Vite 8/Rolldown `codeSplitting.groups`
  while preserving the React, MapLibre, Three, D3 force, GIF export, icons, and
  vendor chunk intent.
- Added caller-provided MapLibre source-data signatures and worker-backed route
  and heatmap GeoJSON transforms with main-thread fallback and performance
  counters.
- Split major map shell, status/chrome, map settings, visitor-guide, and
  selection/phonebook CSS surfaces into imported files.
- Tightened Map Settings hierarchy, live deployment evidence copy, and draggable
  panel keyboard/focus affordances.
- Added 3.1.0 release validation notes and a Windows live-deploy wrapper for the
  documented droplet smoke path.

## 3.0.2 - 2026-06-14

- Added shared frontend loading primitives for branded spinners, loading blocks,
  skeleton rows, and stable busy button labels.
- Replaced abrupt workspace and data-load waits with contextual animated loading
  states across lazy panels, Packets, Chat, propagation history, NetGraph, route
  GIF export, replay/Laser Show, live status, and solar conditions.
- Kept loading motion subtle and reduced-motion-aware while reusing the existing
  v3 asset-pack loading mark and lucide spinner icon.
- Updated focused loading tests, release metadata, OpenAPI version metadata, and
  docs for the 3.0.2 frontend-only polish patch.
- Added an operational retention update: raw packet/history/search data defaults
  to seven days, public search windows are capped to seven days, and compact
  public route summaries preserve the latest route graph as the live database is
  pruned.

## 3.0.1 - 2026-06-14

- Reworked the live-map shell around four public modes: Watch, Explore,
  Terrain, and Studio, with advanced layer/style controls kept behind the map
  drawer.
- Replaced the mobile control dock with an app-style tabbar for Map, Packets,
  Nodes, Chat, and More while keeping routed workspace URLs stable.
- Collapsed separate Live/Focus controls into one calmer Follow action for
  recent routed activity.
- Added unified snackbars, branded loading feedback, and reduced-motion-aware
  motion polish for copy/share/export/loading states.
- Reduced runtime churn with public snapshot identity guards, incremental
  route-pulse rebalancing, heatmap gating, active heatmap candidates, and
  duplicate MapLibre source-data suppression.
- Updated browser smoke expectations, tests, release metadata, and docs for the
  3.0.1 smooth-shell patch.

## 3.0.0 - 2026-06-13

- Promoted the v3 public presentation across Map, Packets, Chat, Node List,
  NetGraph, Labs Waterfall, route replay, and OpenFreeMap 3D/topographic
  surfaces while keeping public DTOs stable.
- Added a manifest-driven v3 image asset pack system with optional OpenAI Image
  API/Batch API generation scripts, deterministic post-processing, and a
  committed runtime asset tree.
- Shipped `world` and `canada` asset presets for app icons, favicons, PWA
  manifests, social/release art, top-bar marks, node roles, packet classes,
  map/layer thumbnails, workspace empty states, Waterfall backdrops, and motion
  effect sprites.
- Added `VITE_APP_ASSET_PACK` across Vite, Docker, Compose, `.env.example`, and
  the Setup workspace. The default GHCR/easy-deploy image uses `world`; the
  hosted Canada build uses `canada`.
- Wired the asset registry into branding, LinkBar, Legend/packet visuals, node
  role visuals, map settings thumbnails, PacketAnimator, OpenFreeMap 3D comets,
  Packet/Node workspaces, route GIF overlays, and Labs Waterfall assets.
- Added `scripts/check-asset-pack.mjs` to validate manifest records, static
  target files, PNG dimensions, and pack-local PWA manifests.
- Updated release metadata, README screenshots, docs index, operator notes, and
  validation checklist for the 3.0.0 world/Canada asset-pack release.

## 2.9.6 - 2026-06-13

- Collapsed Labs to a single Packet Waterfall experience at `#/lab/waterfall`,
  with old experiment URLs redirecting to the Waterfall route.
- Added generated cinematic RF-waterfall and mist artwork under
  `web/public/labs/waterfall/` for the new Labs stage.
- Rebuilt the Waterfall canvas with falling packet streams, payload lanes,
  route ribbons, splashes, message sparkles, mist, and live intensity overlays.
- Replaced the old multi-experiment toolbar with browser-local Waterfall
  controls for volume, motion, density, time window, payload focus, reduced
  motion, and reset.
- Upgraded opt-in Web Audio with packet bell, glass pad, shimmer, and bass swell
  voices through a compressed master output so faster packet bursts become more
  musical.
- Updated Labs tests, LinkBar release highlights, browser smoke, release
  metadata, and operator documentation for the single-Waterfall release.

## 2.9.5 - 2026-06-13

- Added Map Studio to Map Settings with Classic, OpenFreeMap Dark/Light,
  Positron, Liberty, Fiord, OpenFreeMap 3D, Topo RF, NOC Wallboard, Offline
  PMTiles, Field Offline, Accessibility, and Low Bandwidth style profiles.
- Added browser-local basemap dimming, label-density, terrain-lift,
  building-opacity, node-model-scale, antenna-height, route-arc-height, and
  3D node-model style controls.
- Added optional PMTiles protocol support for operator-supplied offline basemaps
  with graceful local fallback when no archive URL is configured.
- Reworked the toolbar basemap button into a quick cycle for Classic Dark,
  OpenFreeMap 3D, Topo RF, NOC Wallboard, and Low Bandwidth, while keeping the
  full style catalog in the drawer.
- Upgraded 3D node rendering with role towers, signal beacons, minimal pins,
  selected/path focus columns, route arc height control, and terrain-aware
  placement.
- Updated focused frontend tests, browser-smoke expectations, release metadata,
  PMTiles configuration, and operator documentation for the map-customization
  release.

## 2.9.4 - 2026-06-13

- Promoted Labs into routed experiment pages under `#/lab/*`, with a top-bar
  Labs dropdown for RF Synth, Packet Waterfall, Live Sequencer, Route Organism,
  RF Constellation, Propagation Aurora, Packet DJ Booth, Network Weather Radar,
  and Message Fireflies.
- Reworked Labs as a fullscreen workbench by default, with responsive
  experiment cards, signal context, cue chips, inspector metrics, and
  unclipped canvas sizing across desktop and mobile browser-smoke viewports.
- Fixed the Open Node List control by routing it to `#/nodes` and replacing the
  old panel with a searchable, filterable, fullscreen public node browser.
- Added per-experiment accent styling and canvas polish while keeping all Labs
  inputs derived from existing sanitized public state.
- Fixed the weather cloud overlay so it stays subtle, desaturated, and fully
  fades before detail-mode zoom instead of tinting the default map.
- Updated focused Labs, top-bar, zoom/weather, browser-smoke, release metadata,
  and operator documentation for the polish release.

## 2.9.3 - 2026-06-13

- Added the `#/lab` workspace with RF Synth, Packet Waterfall, Live Sequencer,
  Route Organism, RF Constellation, Propagation Aurora, Packet DJ Booth,
  Network Weather Radar, and Message Fireflies experiments.
- Added opt-in browser Web Audio sonification for public packet events, with
  volume control, mute state, and autoplay-safe user activation.
- Added public-safe lab selectors/metrics that derive all audio and visual
  inputs from existing sanitized frontend state.
- Added Labs navigation beside Packets, NetGraph, and Chat in the top project
  bar, with docked and fullscreen workspace presentation support.
- Added focused Labs helper/component tests and release documentation.

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
