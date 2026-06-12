# MC-CartoLive 2.8.0 Release Evidence

Date: 2026-06-11

Version under test: `2.8.0`

## Local Gates

The 2.8.0 release gate passed after the service-worker, Packets, Chat,
NetGraph, CSP, migration, privacy, browser-smoke, and deployment-script fixes.

Validated surfaces:

- `node scripts/check-version-sync.mjs`
- `cd backend && go test ./...`
- Go vulnerability scan
- `cd web && npm ci`
- `cd web && npm test -- --run`
- `cd web && npm run build`
- Podman image build
- packaged synthetic and world fixture smoke
- local public privacy scan
- browser smoke at desktop `1920x1080` and mobile `390x844`
- `git diff --check`

## Browser Smoke

Browser smoke covered:

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
- service-worker disabled check
- `.panel-error`, page error, and console error checks

## Runtime Evidence

The local release container reported healthy readiness, public state readiness,
static frontend readiness, nonzero fixture packets/nodes/routes, and service
worker registration disabled by default.

## Production Evidence

Production checks on 2026-06-11 confirmed `carto.canadaverse.org` serving
version `2.8.0` from `main`.

Validated live surfaces:

- `/healthz`
- `/readyz`
- `/api/v1/public/state`
- `/api/v1/public/packets`
- `/api/v1/public/chat`
- in-app browser smoke for `/`, `#/setup`, `#/packets`, `#/chat`, and
  `#/netgraph`
- deployed public privacy scan

Detailed temporary investigation notes, task cards, and draft planning material
were removed from the active docs tree during the 2.9.0 documentation cleanup.
They remain available in git history.
