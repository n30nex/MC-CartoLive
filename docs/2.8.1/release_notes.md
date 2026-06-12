# MC-CartoLive 2.8.1 Release Notes

## Highlights

- Propagation insights now identify public long-distance route events and show
  cautious weather-supported context.
- The new propagation drawer lists recent public events and can focus or replay
  the public RF path on the map.
- Known Pathways are off by default for first-time visitors so live traffic,
  comets, and trails are easier to see on load.
- A top toolbar Known Pathways button glows green when route history is on and
  red when it is off.
- Weather clouds fade away before the detail route/label layer appears.
- Node labels are now MapLibre symbol labels anchored to node geometry, reducing
  visible jitter during zoom, pan, and tilt.
- The terrain heightmap toggle now enables actual MapLibre terrain using
  terrarium DEM tiles and a separate hillshade source.
- Chat has a clearer operations layout with compact stats, filters, and route
  context chips.

## Data Sources

- Open-Meteo weather model data supplies route-midpoint surface and
  pressure-level context where available.
- NOAA SWPC Kp/F10.7 solar data is displayed as environmental context only.
- NOAA HRRR and READY references remain the research basis for future direct
  model integrations where operational access and rate limits are appropriate.

## Operator Notes

- New config defaults:
  - `PROPAGATION_ENABLED=true`
  - `PROPAGATION_MIN_DISTANCE_KM=75`
  - `PROPAGATION_FETCH_INTERVAL_SECONDS=900`
  - `PROPAGATION_EVENT_RETENTION_DAYS=30`
- Public API added: `GET /api/v1/public/propagation?from&to&limit&cursor`.
- Package and local validation should use Podman unless the target host is a
  Docker-only deployment.
- Keep 2.8.0 evidence in `docs/2.8.0/`; 2.8.1 release evidence belongs in this
  directory or future completion notes.
