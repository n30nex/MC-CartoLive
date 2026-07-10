# 3.2.0 Storage And Fresh-Start Policy

## Hosted cutover contract

The hosted `carto.canadaverse.org` 3.2.0 release has no historical-data
recovery path. During the authorized maintenance window:

- stop the writer/container and watchdog first
- preserve `.env` and `data/config.yaml`
- remove stale `APP_VERSION`, `GIT_SHA`, `BUILD_TIME`, `VITE_GIT_SHA`, and
  `VITE_BUILD_TIME` lines from `.env`
- replace stale retention overrides with the locked seven-day/24-hour policy
- permanently delete `data/meshcore-live.db`, `-wal`, and `-shm`
- permanently delete all contents of the dedicated `backups/` directory
- boot schema 32000 with MQTT disabled and prove zero packet, node, observer,
  route, and event rows before enabling the preserved production MQTT setting

`scripts/deploy.sh` implements those boundaries. It validates canonical paths,
rejects symlinked data/backup directories, requires immutable candidate and
rollback digests, and refuses destructive mode unless it receives both:

```text
--fresh-database
--confirm-fresh-database DELETE-MC-CARTOLIVE-PRODUCTION-DATA
```

After deletion, the deploy script discovers the selected image's numeric
runtime user and group in a network-isolated helper container, then assigns
only the bounded `data/` directory to that identity with mode `0750`. The same
step runs for an empty-database rollback. This preserves `data/config.yaml`
while allowing a non-root image to create SQLite files on a clean host.

Rollback restores the previous application digest against another new empty
database. It does not restore the deleted history.

## Retention after cutover

Production fixes these values in its Compose contract:

```text
DATA_RETENTION_DAYS=7
PUBLIC_EVENT_RETENTION_HOURS=24
ALLOW_UNBOUNDED_RETENTION=false
```

Raw observations, packet/history/search projections, observer status, and
other bounded history are pruned in small batches. Compact latest-route
summaries may outlive raw history but contain only the public-safe fields needed
to draw the current network.

A negative observation retention value is rejected in public mode unless the
development override is explicit. Even with that override, readiness remains
fail-closed so an accidentally unbounded public deployment cannot look healthy.

## SQLite maintenance

- Fresh databases enable incremental auto-vacuum before schema creation.
- Startup runs `PRAGMA optimize=0x10002`; routine maintenance runs bounded
  `PRAGMA optimize` and incremental reclamation.
- Production never performs an automatic full `VACUUM` or full `ANALYZE`.
- Schema migrations are transactional and recorded in `schema_migrations` and
  `PRAGMA user_version`.
- WAL, busy/full errors, writer queue age, queue depth, duplicates, and drops
  are operational signals. Do not hide pressure by increasing retry timeouts.

## Capacity gates

Before release work, reclaim unused BuildKit cache without touching the running
database and require at least 9 GiB free and less than 75% root usage. Before
destructive cutover, the deploy script checks that current free space plus the
database/backup footprint can yield at least 25 GiB. It checks the real free
space again after deletion and separately requires root usage to be strictly
below 25% before starting the candidate. The minimum free-space threshold
cannot be configured below 25 GiB in destructive mode.

After release:

- WAL should remain below 256 MiB in steady operation.
- On day 8, the oldest observation should be no older than seven days plus the
  maintenance allowance; public events should be no older than 25 hours.
- Database plus WAL growth from day 8 to day 14 should remain below 10% under a
  comparable traffic rate.
- Any `SQLITE_FULL`, sustained busy storm, application queue drop, or critical
  storage state is a release incident. The watchdog deliberately does not
  restart for storage pressure.

## Automated evidence

`mc-cartolive-release-audit.timer` runs hourly and records each due phase once.
It reads the root-owned deploy identity from
`/var/lib/mc-cartolive-deploy/current.env`, but never sources `.env` and never
copies live rows. Read-only SQLite commands are limited to 120 seconds and
return only integrity status, schema version, oldest timestamps, and file
sizes. Results are mode `0600` JSON under
`/var/log/mc-cartolive-release-audit/`.

The day-8 database-plus-WAL measurement is stored atomically under
`/var/lib/mc-cartolive-release-audit/`. A day-14 audit fails closed if that
baseline is absent or invalid; it does not invent a late baseline. Failed
phases retain a single privacy-safe `latest-failure` result and retry hourly.
See the [operator runbook](../operator-runbook.md#automated-32-release-audits)
for installation and inspection commands.
