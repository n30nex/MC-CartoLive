# MC-CartoLive 3.1.0 Validation Checklist

> **Historical only:** 3.1.0 was never released. This checklist records the
> abandoned candidate and must not be used for deployment; use the 3.2.0
> validation and fresh-start procedure instead.

## Local Gates

- [x] `cd backend && go test ./...`
- [x] `cd backend && go tool govulncheck ./...`
- [x] `cd web && npm test -- --run`
- [x] `cd web && npm run build`
- [x] `cd web && npm audit --json`
- [x] `node scripts/check-version-sync.mjs`
- [x] `node scripts/public-schema-check.mjs`
- [x] `node scripts/check-asset-pack.mjs`
- [x] `node scripts/check-frontend-budget.mjs`
- [x] `git diff --check`
- [x] Full frontend suite: 69 files, 304 tests.
- [x] `npm audit --json`: zero vulnerabilities.
- [x] `govulncheck`: zero called Go vulnerabilities.

## Focused Coverage

- [x] `cd web && npm test -- --run src/map/sourceDataQueue.test.ts src/workers/geojsonWorkerClient.test.ts src/components/ChromePanel.test.tsx src/components/MapSettingsDrawer.test.tsx src/components/PerfPanel.test.tsx`
- [x] Focused suite: 5 files, 15 tests.
- [x] Frontend build emitted the expected worker and vendor chunks, including
  `geojson.worker`, `react-vendor`, `maplibre`, `three`, `d3-force`,
  `gif-export`, `icons`, and `vendor`.

## Package And Browser Smoke

- [x] `podman build --format docker -t mc-cartolive-local:3.1.0 .`
- [x] `node scripts/package-smoke.mjs --runtime podman --image mc-cartolive-local:3.1.0 --version 3.1.0`
- [x] Package smoke passed synthetic and world fixture scenarios, including
  built-in public privacy scans.
- [x] Fixture container on `127.0.0.1:39476` reached ready state for
  browser validation setup.
- [x] Browser smoke intentionally stopped after operator requested no further
  smoke runs on this workstation. Before stop, all scenarios passed except
  desktop live-map, which timed out clicking the replay-speed control.
- [x] Dedicated `node scripts/check-public-privacy.mjs http://127.0.0.1:39476`
  skipped with browser smoke; privacy coverage came from package-smoke scans.

## Deployment

- [ ] Push validated `origin/main`.
- [ ] `.\scripts\deploy-live.ps1 -BaseUrl https://carto.canadaverse.org -SshTarget root@134.122.45.228 -KeyPath "$env:USERPROFILE\.ssh\neonx" -ExpectedVersion 3.1.0 -DiagnoseRegion YTR`
- [ ] Workstation-constrained deploy command:
  `.\scripts\deploy-live.ps1 -BaseUrl https://carto.canadaverse.org -SshTarget root@134.122.45.228 -KeyPath "$env:USERPROFILE\.ssh\neonx" -ExpectedVersion 3.1.0 -DiagnoseRegion YTR -SkipSmoke`
- [ ] Confirm live `/healthz`, `/readyz`, public state, WebSocket hello, remote
  container health, expected Git SHA, and `mc-diagnose` output.

## Privacy

- [x] Public API/schema checks preserve the existing privacy boundary.
- [x] Public privacy scans find no raw packet hashes, raw hex, full keys,
  resolver debug fields, broker credentials, channel secrets, or operator
  config in public JSON.
- [ ] Deployment output does not print live `.env`, SQLite, WAL/SHM, private
  keys, broker credentials, channel secrets, or `data/config.yaml`.
