# MC-CartoLive 2.6.3 to 2.6.6 Roadmap

This roadmap keeps `2.6.2` as the current stable world-ready baseline and
moves the next patch train toward a stronger public experience. The priority is
public-facing polish first, then 3D performance, then RF terrain analysis, then
deeper propagation-event research.

## Summary

- `2.6.3` is UI/UX refinement: cleaner map chrome, clearer route/share flows,
  better mobile ergonomics, and less visual noise.
- `2.6.4` is OpenFreeMap 3D performance: reduce frame cost, object churn, and
  route/comet overhead; evaluate alternate render paths only if Three.js custom
  layers cannot meet the smoothness target.
- `2.6.5` is elevation, topography, and line-of-sight: add terrain-aware route
  context and public-safe pathway LOS/profiling on the 3D map.
- `2.6.6` is propagation-event research: explore solar, geomagnetic,
  tropospheric, time-of-day, and burst-pattern correlations with verified long
  distance MeshCore routes.

## 2.6.3 - Public UI/UX Refinement

Goal: make the existing 2.6 public experience feel cleaner, easier to explain,
and easier to use on desktop and mobile without adding new backend schemas.

- Tighten the default map chrome so first-load view emphasizes live map motion,
  route clarity, and the bottom live clock over panels and secondary controls.
- Refine Packets, Chat, NetGraph, VCR, route plotting, and Route GIF entry
  points so each page has one obvious primary action and minimal repeated
  instructional copy.
- Improve mobile sheet behavior for Packets, Chat, VCR, palette picker, and Map
  Settings so vertical screens have no clipped controls and map touch gestures
  remain accessible.
- Polish route/share flows: selecting a packet route should fit the route,
  expose replay/export actions, and keep the map state understandable after the
  panel closes.
- Keep privacy boundaries unchanged: no raw packet hashes, raw path hex, full
  public keys, resolver debug fields, broker secrets, or private payloads.

Acceptance:

- Desktop and 390px mobile browser smoke show no overlapping or clipped chrome.
- Packets route select, Replay, Route GIF export, Chat filters, NetGraph close,
  VCR open/close, and map settings all remain usable.
- Frontend tests cover any changed panel, route action, and mobile layout state.

## 2.6.4 - OpenFreeMap 3D Performance Pass

Goal: make the 3D view smoother on modest clients and the hosted 1 GB VPS shape
while preserving current 3D visual features.

- Profile the current Three.js/MapLibre custom layer for frame time, object
  counts, route arc geometry, comet count, observer glow count, and rebuild
  frequency.
- Reduce churn by pooling/reusing route arcs, node model meshes, comet meshes,
  trail materials, and observer glow objects where practical.
- Make geometry budgets adaptive by zoom, render quality, viewport size, and
  interaction state; selected, replayed, hovered, and live routes stay higher
  priority than idle routes.
- Batch or defer expensive rebuilds during map movement, theme changes, and
  panel toggles; preserve existing source-signature behavior.
- Explore alternate rendering paths only as a documented spike if the existing
  Three.js custom layer cannot meet smoothness targets: examples include
  instanced meshes, GPU-friendly line/ribbon geometry, or a separate optimized
  overlay renderer.

Acceptance:

- 3D mode remains visually equivalent or better in dense Canada views.
- Hidden-tab pause/resume, OpenFreeMap toggle on/off, and style reloads dispose
  resources cleanly.
- Local diagnostics or tests prove panel/theme/VCR changes do not rebuild 3D
  geometry unnecessarily.

## 2.6.5 - Elevation, Topography, And Pathway Line Of Sight

Goal: make 3D routes more RF-explainable by adding terrain/topography context
and public-safe line-of-sight analysis for true route pathways.

- Use configured terrain/elevation sources to sample elevation along selected
  routes, plotted routes, packet replay paths, and focused pathway segments.
- Add a compact route profile surface for selected pathways showing endpoints,
  hop distance, approximate terrain profile, obstruction zones, and whether the
  sampled path looks visually clear or terrain-blocked.
- Render selected 3D pathways with terrain-aware arc styling and optional LOS
  color hints without implying that unverified links are valid.
- Keep LOS as analysis context for already verified public RF paths only; do
  not infer routes from coordinates, terrain, or proximity.
- Document operator terrain-source configuration, fallback behavior, caching
  expectations, and the limitations of terrain-derived LOS.

Acceptance:

- Selected route and packet replay paths can show elevation/LOS context in 3D.
- Terrain failures degrade gracefully to normal route rendering.
- Tests cover elevation sampling normalization, LOS classification guardrails,
  and privacy-safe public output.

## 2.6.6 - Propagation Event And Solar Weather Research

Goal: research whether verified long-distance route bursts correlate with
solar, geomagnetic, tropospheric, time-of-day, or directional propagation
conditions, then define a safe product path.

- Research candidate public data sources for solar flux, Kp/geomagnetic
  activity, auroral indicators, weather/tropospheric ducting proxies, time of
  day, sunrise/sunset, and regional atmospheric conditions.
- Define a local/offline analysis pipeline that correlates only sanitized
  public route events with propagation context; no private MQTT payloads or raw
  identifiers are exposed.
- Classify verified long-distance route events by distance, duration, burst
  density, directional behavior, bidirectional vs monodirectional evidence, and
  region/time window.
- Prototype public-safe map highlighting for exceptional verified events, but
  keep the first research release focused on evidence quality and operator
  explanation instead of public alerts.
- Produce a research note with data-source reliability, rate limits, licensing,
  uncertainty, and which signals are safe enough for a later public feature.

Acceptance:

- A documented research report identifies which propagation signals are useful,
  legal, stable, and operationally safe.
- Any prototype remains opt-in and does not change existing public API schemas.
- Long-distance highlighting is based on verified public route evidence, not
  inferred RF paths.

## Common Release Gates

- `cd backend && go test ./...`
- `cd web && npm test -- --run`
- `cd web && npm run build`
- `docker compose build`
- Package smoke for published images when packaging changes are touched.
- Live smoke against `https://carto.canadaverse.org` before calling a deployed
  patch complete.
- Desktop and 390px mobile browser smoke for any public UI change.
- Privacy regression checks for public state, history, packets, chat, NetGraph,
  VCR, Route GIF, health/readiness, and WebSocket payloads.

## Assumptions

- `2.6.2` remains the stable baseline until the next patch is implemented.
- Hosted Canada remains Canada-scoped; packaged installs remain worldwide by
  default.
- The 2.6.x line keeps public API compatibility unless a future major release
  explicitly changes it.
- Elevation, LOS, and propagation features are explanatory overlays for already
  verified RF routes, not route-validation shortcuts.
- Solar/weather propagation work in `2.6.6` is research-first and may produce a
  later implementation plan rather than a fully public feature in the same
  patch.
