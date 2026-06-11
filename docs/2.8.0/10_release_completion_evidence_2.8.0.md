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
| Container build/run | local container image run -> readiness healthy; local helpers now prefer `podman` when available |
| Runtime readiness | `GET http://localhost:39476/readyz` -> `ready: true`, `version: "2.8.0"` |
| Package smoke | `node scripts/package-smoke.mjs --runtime podman --image mc-cartolive-meshcore-live-map:latest --version 2.8.0` -> synthetic and world modes passed |
| Public privacy scan | `node scripts/check-public-privacy.mjs http://localhost:39476` -> pass |
| Browser smoke | `node scripts/browser-smoke.mjs --base-url http://localhost:39476` -> desktop 1920x1080 and mobile 390x844 passed |
| Whitespace check | `git diff --check` -> pass |
| Windows release gate | previous full gate passed with package smoke and browser smoke; after the Podman helper update, PowerShell parser validation passed. Local Playwright browser smoke was not rerun on this host. |

Follow-up Podman verification on 2026-06-11:

- `podman build --format docker -t mc-cartolive-meshcore-live-map:latest .`
  passed.
- `node scripts/package-smoke.mjs --runtime podman --image
  mc-cartolive-meshcore-live-map:latest --version 2.8.0` passed synthetic and
  world fixture modes.
- Synthetic package smoke: 5 packets, 8 nodes, 5 routes, 4 packet paths, 5 chat
  messages.
- World package smoke: 3 packets, 5 nodes, 2 routes, 3 packet paths, 3 chat
  messages.
- Public privacy scans passed for both temporary Podman containers.
- `node scripts/check-version-sync.mjs`, `node --check
  scripts/package-smoke.mjs`, `bash -n scripts/release-check.sh`,
  PowerShell parser validation for `scripts/release-check.ps1`, and
  `git diff --check` passed.

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

The local container reported:

- readiness: healthy
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

Public production checks on 2026-06-11 showed `carto.canadaverse.org` serving
`2.8.0` from the current `main` commit.

- Deployed branch: `main`
- Deployed SHA: `dbe176ea53ee6e23f719b06791382040586e2629`
- Previous SHA: operator confirmation required; not exposed by public health
  endpoints.
- DB backup file: operator confirmation required; not exposed by public health
  endpoints.
- `https://carto.canadaverse.org/healthz`: HTTP `200`, `ready: true`,
  `version: "2.8.0"`, `gitSha:
  "dbe176ea53ee6e23f719b06791382040586e2629"`, `mqttConnected: true`.
- `https://carto.canadaverse.org/readyz`: HTTP `200`, `ready: true`,
  `dbReady: true`, `staticReady: true`, `publicStateReady: true`.
- Public Packets: `https://carto.canadaverse.org/api/v1/public/packets?limit=5`
  returned HTTP `200`; in-app browser Packets page loaded 500 public packet
  paths on desktop and mobile.
- Public Chat: `https://carto.canadaverse.org/api/v1/public/chat?limit=5`
  returned HTTP `200`; in-app browser Chat page loaded public messages on
  desktop and mobile.
- Public privacy scan: `node scripts/check-public-privacy.mjs
  https://carto.canadaverse.org` -> pass.
- Browser smoke: Codex in-app browser checks passed for `/`, `#/setup`,
  `#/packets`, `#/chat`, and `#/netgraph` at desktop `1920x1080` and mobile
  `390x844`; no `.panel-error`, no browser error logs, no controlling service
  worker, and NetGraph canvas sizes were nonzero (`1898x958` desktop,
  `390x653` mobile).
- Operator: operator confirmation required.
