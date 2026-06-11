# 10 - 2.8.0 Release Completion Evidence

Date: 2026-06-11

Branch under test: `dev/deepseek-v4`

Version under test: `2.8.0`

## Local Release Gate

All local release-blocking gates were rerun after the final service-worker,
Packets, Chat, NetGraph, CSP, browser-smoke, migration, and deploy-script
changes.

| Gate | Evidence |
|---|---|
| Version sync | `node scripts/check-version-sync.mjs` -> `version sync ok: 2.8.0` |
| Backend tests | `cd backend && go test ./...` -> pass |
| Go vulnerability scan | `cd backend && go tool govulncheck ./...` -> no called vulnerabilities |
| Frontend install/audit | `cd web && npm ci` and `npm audit --audit-level=high` -> 0 high vulnerabilities |
| Frontend tests | `cd web && npm test -- --run` -> 56 files, 238 tests passed |
| Frontend build | `cd web && npm run build` -> pass |
| Docker build/run | `docker compose up --build -d --remove-orphans` -> container healthy |
| Runtime readiness | `GET http://localhost:39476/readyz` -> `ready: true`, `version: "2.8.0"` |
| Package smoke | `node scripts/package-smoke.mjs --image mc-cartolive-meshcore-live-map:latest --version 2.8.0` -> synthetic and world modes passed |
| Public privacy scan | `node scripts/check-public-privacy.mjs http://localhost:39476` -> pass |
| Browser smoke | `node scripts/browser-smoke.mjs --base-url http://localhost:39476` -> desktop 1920x1080 and mobile 390x844 passed |
| Whitespace check | `git diff --check` -> pass |
| Windows release gate | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release-check.ps1 -BaseUrl http://localhost:39476 -SkipDocker -RunPackageSmoke -PackageSmokeImage mc-cartolive-meshcore-live-map:latest -RunBrowserSmoke -BrowserSmokeBaseUrl http://localhost:39476` -> pass |

## Browser Smoke Coverage

The browser smoke suite passed all required scenarios in both desktop and mobile
viewports:

- live map
- setup
- Packets
- Chat
- NetGraph
- map settings
- OpenFreeMap toggle
- theme and palette controls
- VCR controls and replay
- packet replay
- NetGraph canvas sizing
- service-worker disabled check
- global `.panel-error`, page error, and console error checks

Screenshots were written under `artifacts/browser-smoke/`.

## Runtime Evidence

The local Docker container reported:

- Docker health: healthy
- public map preset: `world`
- default bounds: `-85,-180,85,180`
- fixture packets: nonzero
- fixture nodes: nonzero
- fixture routes: nonzero
- public cache ready: true
- static frontend ready: true
- service worker disabled by default

## Notes

- `backend/go.mod` now requires Go `1.25.11`, which removes the standard-library
  vulnerability findings that appeared under the local `go1.25.1` toolchain.
- `scripts/release-check.ps1` was brought to parity with the shell release gate:
  it now runs `govulncheck`, `npm ci`, `npm audit`, public summary/solar/metrics
  checks, and uses the current local image name.
- `scripts/check-public-privacy.mjs` now scans `/metrics` and
  `/api/v1/public/solar`, and performs a dependency-free WebSocket privacy scan
  with an explicit browser-equivalent `Origin` header.
- `scripts/browser-smoke.mjs` ignores only paired 404s for known external
  MapLibre glyph PBFs and favicon, while continuing to fail unrecognized 404s.
- On this Windows host, `scripts/release-check.sh` could not be executed directly
  because only the WSL `bash.exe` launcher was present. The same gate was run
  natively and the PowerShell release checker was updated for parity.

## Production Evidence

Fill this section after the approved PR merge and droplet deployment:

- Deployed branch:
- Deployed SHA:
- Previous SHA:
- DB backup file:
- `https://carto.canadaverse.org/healthz`:
- `https://carto.canadaverse.org/readyz`:
- Public Packets:
- Public Chat:
- Browser smoke:
- Operator:
