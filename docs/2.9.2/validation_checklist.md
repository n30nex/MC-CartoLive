# MC-CartoLive 2.9.2 Validation Checklist

## Backend And Public API

- [x] Durable public event table and indexes migrate on SQLite startup.
- [x] Public events carry monotonic `seq` values and page with a resumable
  cursor.
- [x] `/api/v1/public/events` returns public-safe backfill data.
- [x] `/api/v1/public/viewport`, `/api/v1/public/noc`,
  `/api/v1/public/coverage`, `/api/v1/public/los/profile`,
  `/api/v1/public/schema`, and the public integration summary route are
  registered behind feature flags.
- [x] Public WebSocket hello/lagged/event envelopes expose `latestSeq` without
  raw packet, key, payload, or resolver internals.
- [x] Public WebSocket resume/subscription behavior is feature-gated.
- [x] Public DTOs remain separate from internal packet/observer structs.

## Frontend

- [x] Public state tracks `latestSeq` and de-duplicates durable events.
- [x] Reconnect and lagged paths backfill through `/api/v1/public/events` before
  falling back to full public state.
- [x] WebSocket scoped subscription messages remain opt-in.
- [x] App shell caches the last public snapshot for stale/offline fallback.
- [x] Compact NOC summary is visible by default in normal chrome mode.
- [x] Route quality buckets use only public route DTO fields.
- [x] Style registry, PMTiles hook, overlay registry, and worker-transform
  foundations are covered by tests.
- [x] In-app release highlights identify 2.9.2.

## Release Gates

- [x] `cd backend && go test ./...`
- [x] `cd backend && go tool govulncheck ./...`
- [x] `cd web && npm audit --audit-level=high`
- [x] `cd web && npm test -- --run`
- [x] `cd web && npm run build`
- [x] `node scripts/check-version-sync.mjs`
- [x] `node scripts/public-schema-check.mjs`
- [x] `node scripts/check-public-privacy.mjs http://127.0.0.1:39477` against
  synthetic fixture replay.
- [x] Production Compose rebuild on the droplet.
- [x] Live smoke after droplet deploy.
- [x] Deployed public privacy scan.

## Local Evidence

- Backend Go suite passed on 2026-06-12.
- `govulncheck` found no called Go vulnerabilities on 2026-06-12.
- Frontend Vitest passed on 2026-06-12: 61 files, 262 tests.
- Production frontend build passed with Vite 8.0.16 on 2026-06-12.
- npm audit reported zero vulnerabilities after the Vite 8/esbuild update.
- Static schema gate passed for `VERSION=2.9.2`.
- Version sync passed for `2.9.2`.
- Public privacy scan passed against a fixture-backed local server at
  `http://127.0.0.1:39477`.
- Local Docker was unavailable and local Podman disconnected during image build
  after frontend `npm ci`; final container evidence came from the production
  Compose rebuild.

## Deployment

- [x] `main` pushed to GitHub.
- [x] 2.9.2 deployed to the droplet.
- [x] Live smoke run against `https://carto.canadaverse.org`.
- [x] Deployed public privacy scan passed.

## Deployed Evidence

- Production deploy completed through `scripts/deploy.sh` on the Canada
  droplet from pushed `main`.
- Docker Compose rebuilt the image on the droplet and replaced the running
  container.
- Public health and readiness reported version `2.9.2`, ready state, fresh
  public cache, and expected Git metadata.
- Live smoke passed against `https://carto.canadaverse.org`: public state,
  history, packets, chat, WebSocket hello, Docker health, and `mc-diagnose`
  for region `YTR`.
- Deployed public privacy scan passed at `https://carto.canadaverse.org`,
  including the new 2.9.2 public endpoints and `/ws/public`.
