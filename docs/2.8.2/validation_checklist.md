# MC-CartoLive 2.8.2 Validation Checklist

## Frontend

- [x] Defaults keep `terrainHeightmap` and `propagationInsights` off.
- [x] Legacy 2.8.1 settings migrate terrain and propagation off once.
- [x] StatusBar renders no propagation event counter.
- [x] Map Settings can still toggle terrain and propagation and open
  propagation history.
- [x] Flat maps hide hillshade by default; dark terrain hillshade is subdued.
- [x] Mobile `390x844` shows the bottom dock, opens the sheet, and keeps map
  settings reachable without horizontal overflow.

## Release Gates

- [x] `cd backend && go test ./...`
- [x] `cd web && npm test -- --run`
- [x] `cd web && npm run build`
- [x] `node scripts/check-version-sync.mjs`
- [x] `node scripts/check-public-privacy.mjs http://127.0.0.1:39476`
- [x] `podman build --format docker -t mc-cartolive-meshcore-live-map:2.8.2 .`
- [x] Podman package smoke.
- [x] Codex in-app Browser desktop and mobile smoke.

## Local Evidence

- Focused frontend tests passed for map settings, StatusBar, MapSettingsDrawer,
  and map layer/style defaults.
- Full backend test suite passed.
- Full frontend Vitest suite passed: 56 files, 244 tests.
- Production frontend build passed.
- Version sync passed for `2.8.2`.
- Podman package smoke passed for synthetic and world fixtures.
- Local public privacy scan passed at `http://127.0.0.1:39476`.
- Codex in-app Browser verified desktop and mobile defaults, mobile controls,
  propagation history, and no console errors.

## Deployment

- [ ] Merge validated feature branch into `main`.
- [ ] Push `main` to GitHub.
- [ ] Delete the feature branch if it is no longer needed.
- [ ] Deploy 2.8.2 to the droplet.
- [ ] Run live smoke and record deployed version, Git SHA, and ready status.
