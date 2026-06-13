# MC-CartoLive 2.9.5 Validation Checklist

Date: 2026-06-13

## Local Gates

- [x] `cd backend && go test ./...`
- [x] `cd web && npm test -- --run` - 64 files, 274 tests
- [x] `cd web && npm run build`
- [x] `node scripts/check-version-sync.mjs`
- [x] `git diff --check`
- [x] `node --check scripts/browser-smoke.mjs`

## UI Gates

- [x] Focused Map Studio, style registry, map settings, LinkBar, and layer tests
  pass.
- [x] Map Settings shows Clean Live, Terrain/Topo, 3D, and Low Bandwidth mode
  cards first.
- [x] The main toolbar shows only Live, Focus, Routes, Map, and More.
- [x] Classic, NOC, Accessibility, and standard OpenFreeMap styles stay flat by
  default; Topo RF and OpenFreeMap 3D enable terrain by default.
- [x] Flat maps do not apply height color-relief tint; Topo RF remains the only
  color-relief terrain profile.
- [x] Clean Live defaults keep routes/clusters/terrain/propagation analysis off
  while live packets, labels, activity heat, nodes, trails, observer bursts,
  message bubbles, buildings, and configured weather clouds are on.
- [x] Weather clouds stay hidden before detail zoom and remain unavailable when
  no weather API key is configured.
- [x] Offline PMTiles and Field Offline profiles render a usable fallback when
  no archive URL is configured.
- [x] 3D role towers, signal beacons, minimal pins, route arc height, building
  opacity, and terrain clarity remain configurable from Advanced without
  exposing private data.

## Package Gates

- [x] Podman image build passes for `ghcr.io/n30nex/mc-cartolive:2.9.5`.
- [x] Package smoke passes against the Podman image using `--host 172.25.129.67`.
- [x] Public privacy scan passes against packaged synthetic and world fixtures.
- [x] Package browser smoke passes against `http://172.25.129.67:18184`.

## Deployment Gates

- [x] Pushed commit is deployed on the Canada droplet.
- [x] `/healthz` reports version `2.9.5`.
- [x] Live smoke passes against `https://carto.canadaverse.org`.
- [x] Live browser smoke passes against `https://carto.canadaverse.org`.

## Notes

- Map Studio remains frontend-only and public-safe.
- No database migration is required.
- PMTiles URLs are optional build-time inputs; blank values use local fallback
  styles for the offline profiles.
- Droplet cleanup retained only the latest completed SQLite backup and cleared
  Docker build cache after deploy.
