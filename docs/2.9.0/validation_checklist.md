# MC-CartoLive 2.9.0 Validation Checklist

## Frontend

- [x] Defaults keep `terrainHeightmap`, `propagationInsights`, and Known
  Pathways off for new visitors.
- [x] 2.8.2 saved terrain and propagation choices are preserved during the
  settings schema v3 bump.
- [x] Map Settings exposes Live, Clean, Analysis, and 3D layer presets.
- [x] Map Settings groups layers as Base, Live, Routes, Analysis, and Visuals.
- [x] First-visit orientation is local-only and dismissible.
- [x] Shortcut Help includes visitor orientation and keyboard shortcuts.
- [x] SelectionDrawer renders public-safe node and route summary metrics.
- [x] Top-bar changelog highlights 2.9.0, 2.8.2, and 2.8.1.

## Release Gates

- [x] `cd backend && go test ./...`
- [x] `cd web && npm test -- --run`
- [x] `cd web && npm run build`
- [x] `node scripts/check-version-sync.mjs`
- [x] `node scripts/check-public-privacy.mjs http://127.0.0.1:39476`
- [x] `podman build --format docker -t mc-cartolive-meshcore-live-map:2.9.0 .`
- [x] Podman package smoke.
- [x] Codex in-app Browser desktop and mobile smoke.

## Local Evidence

- Focused frontend tests passed for map settings, MapSettingsDrawer, LinkBar,
  VisitorGuide, ShortcutHelp, and SelectionDrawer.
- Full backend test suite passed.
- Full frontend Vitest suite passed: 58 files, 251 tests.
- Production frontend build passed.
- Version sync passed for `2.9.0`.
- Podman image build passed for `mc-cartolive-meshcore-live-map:2.9.0`.
- Podman package smoke passed for synthetic and world fixtures, including
  privacy scans.
- Local public privacy scan passed at `http://127.0.0.1:39476`.
- Codex in-app Browser smoke verified:
  - desktop app title/version, visible map canvas, no panel errors, no
    horizontal overflow, settings presets/groups, Known Pathways toggle, and
    refreshed help/orientation
  - mobile `390x844` bottom dock, reachable settings, hidden desktop top
    actions, Known Pathways off, presets/groups, More sheet, no panel errors,
    no horizontal overflow, and no console errors
- The local production index contains no service-worker registration when
  `VITE_ENABLE_SERVICE_WORKER=false`.

## Deployment

- [ ] Merge validated feature branch into `main`.
- [ ] Push `main` to GitHub.
- [ ] Delete the feature branch if it is no longer needed.
- [ ] Deploy 2.9.0 to the droplet.
- [ ] Run live smoke and record deployed version, Git SHA, and ready status.

## Deployment Evidence

- Pending.
