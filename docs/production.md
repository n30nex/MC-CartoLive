# Production Deployment

## Supported shape

MC-CartoLive ships as one non-root container containing the Go service and
embedded frontend. SQLite lives under `/app/data`. The hosted service uses:

- an immutable multi-platform GHCR digest
- `docker-compose.production.yml` with no `build` section
- loopback diagnostics on `127.0.0.1:39476`
- port 80 restricted to Cloudflare sources by a DigitalOcean Cloud Firewall
- HTTPS and browser origin at `https://carto.canadaverse.org`
- the bounded systemd watchdog and privacy-safe post-release audit timer under
  `deploy/systemd/`

Do not build on the 1 GB production droplet. Local `docker-compose.yml` remains
the developer build/fixture path.

## Published artifact

The release manifest binds application version, source SHA, image digest,
schema version, build time, and platforms. Prefer the full digest from that
manifest:

```bash
export MC_CARTOLIVE_IMAGE='ghcr.io/n30nex/mc-cartolive@sha256:<digest>'
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml up -d --no-build
```

Generic tags `3.2.1`, `3.2`, `sha-<main-sha>`, and `latest` identify the world
asset pack. Canada tags are `3.2.1-canada`, `3.2-canada`,
`sha-<main-sha>-canada`, and `latest-canada`. Deployment and rollback
automation reject every tag and require the Canada image by full digest for
`carto.canadaverse.org`.

## Private configuration

Copy `.env.example` to `.env` and set at minimum:

```text
PUBLIC_MODE=true
PUBLIC_BASE_URL=https://carto.canadaverse.org
MQTT_ENABLED=true
MQTT_USERNAME=<private>
MQTT_PASSWORD=<private>
FIXTURE_REPLAY_PATH=
MAP_REGION_PRESET=canada
```

Do not add `APP_VERSION`, `GIT_SHA`, `BUILD_TIME`, `VITE_GIT_SHA`, or
`VITE_BUILD_TIME`; published identity is compiled and attested. Never place a
secret in a `VITE_*` variable because Vite variables are browser-visible.

Production Compose fixes seven-day observations, 24-hour public events, and
disables unbounded retention. Each SQLite lock wait is 750 ms inside the single
five-second primary-ingest budget.

## First-party 3.2.1 upgrade

The hosted release preserves and transactionally migrates the existing SQLite
database. Before cutover, quiesce the writer and create a verified SQLite copy
on separate block storage, snapshot it, and rehearse the migration against the
volume copy. Follow
[the exact upgrade/rollback procedure](3.2.1/upgrade-and-rollback.md) and
[storage policy](3.2.1/storage-and-stability.md).

Deploy without `--fresh-database`; that flag and its deletion token remain an
explicit recovery/operator tool, not the hosted 3.2.1 procedure. Migrations are
forward-only, additive, and transactional. Node.js 18 or newer is staged for
the bundled credential-free privacy/WebSocket validation.

The original hosted 3.2.0 cutover started a fresh schema-32000 database; later
candidate deploys preserved it. The supported 3.2.1 upgrade preserves that
running database. See the [3.2.0 erratum](3.2.0/errata.md).

## Readiness and dataset warming

- `/healthz` is cheap liveness plus a coarse sanitized dependency summary; its
  `ready` field is informational, while `/readyz` is the authoritative
  fail-closed serving gate.
- `/readyz` covers database/static/cache/session/writer state and reports
  only sanitized readiness booleans/states/reasons plus compiled release
  identity; queue and ingest details remain loopback metrics only.
- `/api/v1/public/bootstrap` is the compact first-view contract.
- A new DB can be ready with `datasetState=fresh_start` or `warming`; it becomes
  `live` after real observations populate public state.
- Queue drops and write/full failures are process-scoped fail-closed counters;
  they clear only after an operator investigates and restarts the process.
  Idempotent duplicate suppressions are informational and never make readiness
  fail by themselves.
- The main listener always returns 404 for `/metrics`. Detailed metrics use the
  dedicated listener (`127.0.0.1:9090` bare metal; host loopback port `39090`
  under Compose).

`PUBLIC_BASE_URL` must exactly match the browser origin for WebSocket origin
checks. Forwarded headers are ignored unless both `TRUST_PROXY_HEADERS=true` and
`TRUSTED_PROXY_CIDRS` explicitly trust the immediate proxy.

## Network and monitoring

Install firewall/alerts before treating a deployment as complete. The required
rules and thresholds are in
[3.2.1 security and operations](3.2.1/security-and-operations.md). Keep SSH
key-only, verify a second session before restricting source ranges, and never
publish port 39476.

## Verification

```bash
curl -fsS http://127.0.0.1:39476/healthz
curl -fsS http://127.0.0.1:39090/metrics
curl -fsS http://127.0.0.1:39476/readyz
curl -fsS http://127.0.0.1:39476/api/v1/public/bootstrap
curl -fsS 'http://127.0.0.1:39476/api/v1/public/events?afterSeq=0&limit=25'
node scripts/check-public-privacy.mjs http://127.0.0.1:39476 \
  --origin https://carto.canadaverse.org
node scripts/websocket-flow-probe.mjs \
  --url https://carto.canadaverse.org \
  --origin https://carto.canadaverse.org --timeout-ms 60000 --require-event
```

The event request must return HTTP 200 with `resetRequired=true`. Run
the Node scanner on the host before finalizing deployment; it has no npm
dependencies and requires the first WebSocket frame to be `hello`. Run
`scripts/live-smoke.ps1` from the operator workstation for public URL,
WebSocket, Docker, metadata, and diagnostic evidence.

See the [operator runbook](operator-runbook.md) for cache reclamation, watchdog,
soak, diagnosis, and incident behavior.
