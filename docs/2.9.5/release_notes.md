# MC-CartoLive 2.9.5 Release Notes

2.9.5 is the Map Studio release. It expands the public map from a small
dark/light/3D toggle into a browser-local style workspace with richer basemap
choices, offline tile hooks, and more configurable 3D RF presentation.
The latest 2.9.5 update also cleans up the first-view operator UI, keeps the
default dark map as a dimmed street map over black, and keeps flat street maps
free of terrain color tint by default.

## Highlights

- Added Map Studio to Map Settings with Classic Dark, Classic Light,
  OpenFreeMap Dark, OpenFreeMap Light, Positron, Liberty, Fiord, OpenFreeMap
  3D, Topo RF, NOC Wallboard, Offline PMTiles, Field Offline, Accessibility,
  and Low Bandwidth profiles.
- Added a toolbar quick cycle for the operational modes visitors are most likely
  to switch between: Classic Dark, OpenFreeMap 3D, Topo RF, NOC Wallboard, and
  Low Bandwidth.
- Replaced the long top action row with a compact `Live`, `Focus`, `Routes`,
  `Map`, and `More` toolbar. Workspaces now live under a `Workspaces` menu, and
  build/changelog/GitHub details moved under `About`.
- Tuned Clean Live defaults so new users start with routes and clusters off,
  labels/live packets/activity heat/nodes/trails/observer bursts/message
  bubbles/buildings on, terrain and propagation analysis off, and weather clouds
  on when configured.
- Changed flat map styles so Classic, NOC, Accessibility, and normal
  OpenFreeMap styles do not enable terrain by default. If terrain is manually
  enabled on those maps, it uses hillshade only; the height color tint is
  reserved for `Topo RF`.
- Added controls for basemap dimming, label density, terrain clarity, building
  opacity, node model style, node model scale, antenna height, and route arc
  height. Terrain clarity now balances mesh lift and hillshade without tinting
  flat street-map styles.
- Added optional PMTiles protocol support for operator-supplied offline basemaps
  while keeping graceful local fallback when no archive URL is configured.
- Upgraded 3D node models with role towers, signal beacons, minimal pins, focus
  columns for selected/path nodes, and terrain-aware placement.
- Updated browser smoke so Map Studio, OpenFreeMap 3D, Offline PMTiles, and the
  new 3D/RF controls are covered by release validation.

## Public Data Boundary

Map Studio is frontend-only and browser-local. It changes presentation, not the
public API shape. The new 3D models and route arcs still use sanitized public
nodes, public route endpoints, public route pulses, public map bounds, and
public timing data. They do not expose raw payloads, packet hashes, full keys,
raw path data, broker data, resolver debug, or private operator configuration.

## Operator Impact

- No database migration is required.
- No new backend public route is required.
- The `pmtiles` frontend dependency is bundled at build time.
- `VITE_PMTILES_BASEMAP_URL` and `VITE_PMTILES_TERRAIN_URL` are optional build
  inputs. Leave them blank unless an operator hosts compatible archives.
- Same-origin PMTiles URLs such as `/tiles/canada.pmtiles` are the simplest
  production option. External PMTiles hosts also need CSP allowance.
- Existing `PUBLIC_MODE=true` deployments keep the same public data boundary.
