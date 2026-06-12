# MC-CartoLive 2.8.1 Validation Checklist

## Backend

- [x] `cd backend && go test ./...`
- [x] Migration tests cover propagation tables.
- [x] Classifier tests cover short-path ignore, low-confidence long-distance
  events, weather-supported `Tropo possible`, burst scoring, stale/missing
  weather fallback, and public-safe serialization.
- [x] `/api/v1/public/propagation` tests cover pagination, time windows,
  retention, and forbidden-field scans.

## Frontend

- [x] `cd web && npm test -- --run`
- [x] `cd web && npm run build`
- [x] Map tests cover cloud/detail boundaries, MapLibre node labels, propagation
  layers, terrain DEM sources, Known Pathways defaults, and settings toggles.
- [x] Chat tests cover render, filters, loading, empty, and error states.

## Release Gates

- [x] `node scripts/check-version-sync.mjs`
- [x] `node scripts/check-public-privacy.mjs http://127.0.0.1:39476`
- [x] `podman build --format docker -t mc-cartolive-meshcore-live-map:2.8.1 .`
- [x] `CONTAINER_RUNTIME=podman` package/release smoke.
- [x] Codex in-app Browser smoke:
  - [x] `http://127.0.0.1:39476/`
  - [x] `#/chat`
  - [x] map settings drawer
  - [x] Known Pathways red/off and green/on states
  - [x] propagation drawer focus/replay
  - [x] cloud fade before detail labels/routes
  - [x] terrain heightmap toggle
  - [x] desktop `1920x1080`
  - [x] mobile `390x844`

## Release Evidence

- Full PowerShell release gate passed with `CONTAINER_RUNTIME=podman`,
  `-SkipContainerBuild`, and package smoke against
  `mc-cartolive-meshcore-live-map:2.8.1`.
- `govulncheck` found no called vulnerabilities.
- `npm audit --audit-level=high` found zero vulnerabilities.
- Package smoke passed for synthetic and world fixtures.
- Local public privacy scan passed for `http://127.0.0.1:39476`.

## Deployment

- [x] Release branch merged into `main`.
- [x] `main` pushed to GitHub.
- [x] Feature branch deleted after merge.
- [x] Release line deployed to the droplet.
- [x] Carry 2.8.1 validation forward into the 2.8.2 and 2.9.0 deployed
  baselines.
