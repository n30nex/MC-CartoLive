# MC-CartoLive 3.1.0 Release Notes

3.1.0 is an end-to-end production overhaul. It keeps the single-container Go
backend, embedded React frontend, SQLite data volume, and public API/privacy
boundary stable while refreshing frontend tooling, map rendering performance,
UI maintainability, release documentation, and deployment workflow.

## Highlights

- Fixed the frontend npm audit findings with lockfile-safe dependency updates.
- Moved Vite chunk configuration to Vite 8/Rolldown `codeSplitting.groups`
  while preserving dedicated React, MapLibre, Three, D3 force, GIF export,
  icons, and vendor chunks.
- Added stable caller signatures for high-frequency MapLibre `setData` callers
  so repeated route, node, heatmap, analysis, and propagation effects can skip
  full GeoJSON serialization when inputs are unchanged.
- Added a browser-worker GeoJSON transform path for route and heatmap sources
  with main-thread fallback and public-safe performance counters.
- Split major stylesheet surfaces into imported files for map shell,
  status/chrome, map settings, visitor guide, and selection/phonebook UI.
- Tightened Map Settings hierarchy, live deploy evidence copy, and draggable
  panel focus/keyboard affordances.
- Added `scripts/deploy-live.ps1` as the Windows workstation wrapper around the
  documented droplet deploy script and live smoke check.

## Compatibility

- Public API DTOs remain backward compatible.
- No live secrets, broker credentials, raw packets, SQLite data, WAL/SHM files,
  private keys, or `data/config.yaml` are added or changed.
- Existing `.env` files remain compatible; the committed defaults now advertise
  `APP_VERSION=3.1.0`.
- MapLibre `setData` still runs on the main thread; the worker only prepares
  GeoJSON payloads before the source update.
