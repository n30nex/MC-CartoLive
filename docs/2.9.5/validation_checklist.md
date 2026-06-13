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

- [x] Focused Map Studio, style registry, map settings, and 3D tests pass.
- [x] Map Settings shows Map Studio, OpenFreeMap 3D, Offline PMTiles, and 3D
  And RF controls.
- [x] The top Layers button enters OpenFreeMap 3D from the default map and keeps
  the active state tied to 3D-capable styles.
- [x] OpenFreeMap 3D, Topo RF, Accessibility, NOC, and Low Bandwidth profiles
  apply the expected browser-local layer defaults.
- [x] Offline PMTiles and Field Offline profiles render a usable fallback when
  no archive URL is configured.
- [x] 3D role towers, signal beacons, minimal pins, route arc height, building
  opacity, and terrain lift remain configurable without exposing private data.

## Package Gates

- [x] Podman image build passes for `ghcr.io/n30nex/mc-cartolive:2.9.5`.
- [x] Package smoke passes against the Podman image using `--host 172.25.129.67`.
- [x] Public privacy scan passes against packaged synthetic and world fixtures.
- [x] Package browser smoke passes against `http://172.25.129.67:18184`.

## Deployment Gates

- [ ] Pushed commit is deployed on the Canada droplet.
- [ ] `/healthz` reports version `2.9.5`.
- [ ] Live smoke passes against `https://carto.canadaverse.org`.
- [ ] Live browser smoke passes against `https://carto.canadaverse.org`.

## Notes

- Map Studio remains frontend-only and public-safe.
- No database migration is required.
- PMTiles URLs are optional build-time inputs; blank values use local fallback
  styles for the offline profiles.
