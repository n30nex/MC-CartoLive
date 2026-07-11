# MC-CartoLive 3.2.1 Operator Runbook

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

The release candidate is identified by the complete tuple
`<merge-sha>, <candidate-workflow-run-id>, <run-attempt>, <world-digest>,
<canada-digest>`. Candidate workflow reruns publish distinct
`candidate-<sha>-<run-id>-<attempt>-world` and
`candidate-<sha>-<run-id>-<attempt>-canada` tags and
`release-candidate-<sha>-<run-id>-<attempt>` artifacts. Download the chosen
artifact and deploy its Canada digest; do not choose the newest artifact and
do not deploy a mutable `sha-*` alias. Candidate authorization itself fails unless
the exact merged release-branch head already has canonical full performance
proof.

For a normal non-destructive upgrade:

```bash
MC_CARTOLIVE_REQUIRE_PRIVACY_SCAN=1 bash scripts/deploy.sh \
  --image ghcr.io/n30nex/mc-cartolive@sha256:<candidate> \
  --previous-image ghcr.io/n30nex/mc-cartolive@sha256:<previous> \
  --expected-git-sha <full-release-sha>
```

The hosted 3.2.1 release uses this non-destructive path after a verified
off-root-disk backup and migration rehearsal. Do not pass the fresh-database
flags; see [upgrade-and-rollback](3.2.1/upgrade-and-rollback.md).

From Windows:

```powershell
.\scripts\deploy-live.ps1 `
  -Image 'ghcr.io/n30nex/mc-cartolive@sha256:<candidate>' `
  -PreviousImage 'ghcr.io/n30nex/mc-cartolive@sha256:<previous>' `
  -ExpectedVersion 3.2.1 -ExpectedGitSha <full-sha>
```

## Smoke and release evidence

```bash
scripts/release-check.sh
node scripts/package-smoke.mjs \
  --image ghcr.io/n30nex/mc-cartolive@sha256:<canada-candidate> \
  --version 3.2.1 --asset-pack canada --pull
```

```powershell
.\scripts\live-smoke.ps1 -BaseUrl https://carto.canadaverse.org `
  -ExpectedVersion 3.2.1 -ExpectedGitSha <full-sha> -DiagnoseRegion YTR `
  -SshTarget root@134.122.45.228
```

Always check event reset, bootstrap/state, WebSocket hello, privacy, compiled
identity, Docker restart/OOM state, and disk space.

After the 30-minute soak, create the annotated release tag with
`Candidate-Run-Id`, `Candidate-Run-Attempt`, `Candidate-World-Digest`,
`Candidate-Canada-Digest`, and
`Candidate-Deployed-At` trailers as
shown in [upgrade and rollback](3.2.1/upgrade-and-rollback.md). The Canada digest must
come from `/var/lib/mc-cartolive-deploy/current.env` and match the running
container; the same record captures the candidate run ID, run attempt, and
run-specific tag from OCI labels verified before cutover. Promotion uses that
  exact run-specific artifact and both digests. It publishes world tags `3.2.1`,
  `3.2`, `sha-<merge-sha>`, and `latest`, plus Canada tags `3.2.1-canada`,
  `3.2-canada`, `sha-<merge-sha>-canada`, and `latest-canada`, and a standalone
  `ROLLBACK.md` asset.

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
session. Quiet RF, `fresh_start`, or `warming` alone never cause a restart, and
storage pressure always suppresses one; those dataset states do not mask a
separately confirmed process, cache, database, or MQTT-session failure.

Recovery decisions use the stable `/readyz` reason codes rather than detailed
public telemetry. Before any restart, the watchdog independently checks the
configured data filesystem and refuses recovery at 20% free or less. It also
reads at most 200 container log lines from the previous 15 minutes, with a
10-second command ceiling, and suppresses restart for `SQLITE_FULL`, “database
or disk is full,” or “no space left on device.” A failed filesystem or bounded
log probe is fail-closed. Raw container logs are never copied into the watchdog
log.

```bash
systemctl list-timers mc-cartolive-watchdog.timer
tail -n 100 /var/log/mc-cartolive-watchdog.log
cat /var/lib/mc-cartolive-watchdog/state.env
df -h /opt/MC-CartoLive/data
```

## Automated 3.2.1 release audits

Install the post-release audit beside the watchdog before cutover. It is an
hourly, persistent timer; each deployment is keyed by its
immutable digest, Git SHA, and deployment timestamp, so restarting the timer or
re-running a completed phase cannot duplicate or overwrite evidence.

```bash
apt-get install -y curl jq sqlite3 util-linux coreutils
install -m 0755 scripts/post-release-audit.sh /opt/MC-CartoLive/scripts/
install -m 0644 deploy/systemd/mc-cartolive-release-audit.default /etc/default/mc-cartolive-release-audit
install -m 0644 deploy/systemd/mc-cartolive-release-audit.service /etc/systemd/system/
install -m 0644 deploy/systemd/mc-cartolive-release-audit.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mc-cartolive-release-audit.timer
```

The 24-hour phase checks readiness, the loopback-only metrics listener, SQLite
quick/foreign-key integrity, schema identity, queue and error counters, and the
container/watchdog. A preserved database requires at least 9 GiB and 20% free;
a destructive fresh start retains its 25 GiB gate. Day 8 additionally enforces
seven days plus six hours for observations, 25 hours for public events, and a
WAL below 256 MiB, then atomically records the database-plus-WAL baseline. Day
14 repeats retention/WAL checks and requires growth from that day-8 baseline to
be strictly below 10%. Each SQLite command has a 120-second ceiling.

```bash
systemctl list-timers mc-cartolive-release-audit.timer
systemctl status mc-cartolive-release-audit.service
find /var/log/mc-cartolive-release-audit -maxdepth 1 -type f -name '*.json' -ls
jq '{phase,passed,errors,release,database,filesystem,ingest,process,watchdog}' \
  /var/log/mc-cartolive-release-audit/*.json
```

Successful phases are immutable in normal operation. A failed phase writes one
replaceable `latest-failure` file and is retried on the next hourly activation.
The evidence contains aggregate ages, sizes, counters, and immutable release
identity only—never rows, packet/key material, `.env`, or `data/config.yaml`.

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
or metadata mismatch. Complete day-8/day-14 checks from the 3.2.1 validation
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
5. Keep the pre-upgrade block-volume backup until the 24-hour audit is green;
   treat explicitly fresh-deleted data as unrecoverable.
