# MC-CartoLive 2.8.1 Master Plan

## Release Scope

2.8.1 is the propagation and operations UI release. It ships from the current
2.8.0 production baseline and keeps the 2.8.0 release evidence in
`docs/2.8.0/` as historical proof.

## Completed Changes

- Added public-safe propagation classification for already-public
  high-confidence RF paths from `public_packet_paths`.
- Added `/api/v1/public/propagation` with weather/solar summaries, cautious
  classification labels, public route segments, and replay windows.
- Added SQLite persistence for propagation weather snapshots and public-safe
  propagation events, with retention pruning.
- Added Open-Meteo weather-model context and NOAA SWPC solar context. Solar
  conditions are context only, not proof of tropospheric propagation.
- Added frontend propagation types, API sanitizer, map overlay source/layers,
  StatusBar summary, and a compact propagation drawer with focus/replay
  actions.
- Changed first-run map defaults so Known Pathways are off by default while all
  other expected live layers remain on. Stored user preferences are preserved.
- Added a prominent top action toggle for Known Pathways with green/on and
  red/off states.
- Faded weather clouds out by the detail zoom threshold so routes and labels
  appear after a "zoom through clouds" transition.
- Replaced DOM-projected node labels with MapLibre symbol labels anchored to
  node geometry.
- Repaired DEM terrain with separate terrain and hillshade raster-dem sources,
  actual MapLibre terrain toggling, and restrained hillshade.
- Redesigned Chat into a denser operations-style panel with sticky header,
  search/filter chips, compact stats, richer row context, and improved empty
  states.

## Public Safety Rules

- Propagation events only annotate route data already safe for public display.
- No raw path hex, full public keys, observer keys, packet hashes, raw payloads,
  resolver debug reasons, or broker internals are exposed.
- Labels remain probabilistic: `Tropo possible` or `Long-distance event`.
- Weather evidence is used as support for a score, never as confirmed causation.

## Validation Plan

- `cd backend && go test ./...`
- `cd web && npm test -- --run`
- `cd web && npm run build`
- `node scripts/check-version-sync.mjs`
- `node scripts/check-public-privacy.mjs http://127.0.0.1:39476`
- `podman build --format docker -t mc-cartolive-meshcore-live-map:2.8.1 .`
- `CONTAINER_RUNTIME=podman` release/package smoke.
- Codex in-app Browser smoke at `http://127.0.0.1:39476/`, `#/chat`, map
  settings, Known Pathways toggle, propagation drawer, cloud fade, desktop
  `1920x1080`, and mobile `390x844`.

## Release Status

The 2.8.1 work was merged into the production release line and carried forward
through the 2.8.2 and 2.9.0 deployments. Current production validation belongs
in the latest release checklist.
