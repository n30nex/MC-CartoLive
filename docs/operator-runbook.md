# MC-CartoLive 3.2 Operator Runbook

## Capacity first

On the production droplet, collect evidence before cleanup:

```bash
cd /opt/MC-CartoLive
curl -fsS http://127.0.0.1:39476/readyz
docker inspect meshcore-canada-live-map --format '{{json .State}} {{.Image}}'
git status --short --branch
df -h /
docker system df
```

Confirm no build is active, then reclaim only unused BuildKit cache:

```bash
docker builder prune --all --force
df -h /
curl -fsS http://127.0.0.1:39476/readyz
```

Do not run the old build/reset deploy path and do not copy the multi-gigabyte DB
on a full filesystem. Require approximately 9 GiB free before release
preparation. The 3.2 audit reclaimed 9.582 GiB while leaving the active DB and
service untouched; remeasure instead of assuming that evidence is still fresh.

## Digest deployment

For a normal non-destructive upgrade:

```bash
bash scripts/deploy.sh \
  --image ghcr.io/n30nex/mc-cartolive@sha256:<candidate> \
  --previous-image ghcr.io/n30nex/mc-cartolive@sha256:<previous> \
  --expected-git-sha <full-release-sha>
```

For the one authorized hosted 3.2.0 fresh start, use the command in
[upgrade-and-rollback](3.2.0/upgrade-and-rollback.md). It requires the explicit
destruction token and starts rollback with another empty database.

From Windows:

```powershell
.\scripts\deploy-live.ps1 `
  -Image 'ghcr.io/n30nex/mc-cartolive@sha256:<candidate>' `
  -PreviousImage 'ghcr.io/n30nex/mc-cartolive@sha256:<previous>' `
  -FreshDatabase `
  -FreshDatabaseConfirmation DELETE-MC-CARTOLIVE-PRODUCTION-DATA `
  -ExpectedVersion 3.2.0 -ExpectedGitSha <full-sha>
```

## Smoke and release evidence

```bash
scripts/release-check.sh
node scripts/package-smoke.mjs \
  --image ghcr.io/n30nex/mc-cartolive@sha256:<candidate> --version 3.2.0 --pull
```

```powershell
.\scripts\live-smoke.ps1 -BaseUrl https://carto.canadaverse.org `
  -ExpectedVersion 3.2.0 -ExpectedGitSha <full-sha> -DiagnoseRegion YTR
```

Always check event reset, bootstrap/state, WebSocket hello, privacy, compiled
identity, Docker restart/OOM state, and disk space.

## Watchdog

```bash
install -m 0755 scripts/mc-cartolive-watchdog.sh /opt/MC-CartoLive/scripts/
install -m 0644 deploy/systemd/mc-cartolive-watchdog.default /etc/default/mc-cartolive-watchdog
install -m 0644 deploy/systemd/mc-cartolive-watchdog.service /etc/systemd/system/
install -m 0644 deploy/systemd/mc-cartolive-watchdog.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mc-cartolive-watchdog.timer
```

The watchdog waits for three consecutive recoverable failures and permits at
most two restarts per rolling six hours, with 10/20-minute cooldowns. It can
restart a dead process, failed cache, DB-unavailable state, or lost MQTT
session. It does not restart for quiet RF, `fresh_start`, `warming`, or storage
pressure.

```bash
systemctl list-timers mc-cartolive-watchdog.timer
tail -n 100 /var/log/mc-cartolive-watchdog.log
cat /var/lib/mc-cartolive-watchdog/state.env
```

## Storage and retention

```text
DATA_RETENTION_DAYS=7
PUBLIC_EVENT_RETENTION_HOURS=24
ALLOW_UNBOUNDED_RETENTION=false
```

Do not disable retention to relieve contention. Investigate writer queue age,
busy/full counters, WAL size, optional projections, and disk alerts. Automatic
maintenance is bounded and incremental; never run live full `VACUUM` or full
`ANALYZE`.

```bash
sqlite3 data/meshcore-live.db 'PRAGMA quick_check;'
sqlite3 data/meshcore-live.db 'PRAGMA foreign_key_check;'
sqlite3 data/meshcore-live.db 'PRAGMA user_version;'
du -h data/meshcore-live.db*
```

## Soak

```bash
BASE_URL=https://carto.canadaverse.org \
  DURATION_MINUTES=1440 INTERVAL_SECONDS=60 scripts/soak-check.sh
```

Normal quiet motion is not failure. Stop promotion for public 5xx, cache/session
loss, OOM/restart, `SQLITE_FULL`, sustained busy/queue pressure, privacy output,
or metadata mismatch. Complete day-8/day-14 checks from the 3.2 validation
checklist.

## Diagnose public inclusion

```bash
docker exec meshcore-canada-live-map \
  /app/mc-diagnose --db /app/data/meshcore-live.db \
  --region YTR --public-regions "$PUBLIC_REGIONS"
```

Public-safe diagnostic reasons include `mappable`, `missing_coords`,
`zero_coords`, `outside_bounds`, and the legacy name `iata_filtered`. Never
expose the raw packet/key material behind a diagnosis.

## Incident priorities

1. Preserve service safety and secrets.
2. Check real readiness, bootstrap/state freshness, container state, disk/WAL,
   and queue counters.
3. Stop optional projection/propagation work before changing truth or privacy
   controls.
4. Roll back by immutable digest; never reset branches or build on the droplet.
5. Treat data deleted by the authorized fresh cutover as unrecoverable.
