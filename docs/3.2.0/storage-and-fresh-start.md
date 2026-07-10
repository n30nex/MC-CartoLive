# 3.2.0 Storage, Preservation, And Fresh-Start Policy

## Hosted cutover contract

The hosted `carto.canadaverse.org` 3.2.0 release preserves the running SQLite
database. Before the maintenance window, create and verify a transactionally
consistent backup on separate block storage and rehearse schema 32000 migration
against a copy. Keep the pre-upgrade backup through the 24-hour audit.

During cutover, stop the watchdog and writer, preserve `.env` and
`data/config.yaml`, remove stale release-identity overrides, enforce the locked
seven-day/24-hour retention policy, and deploy without `--fresh-database`.
The additive migration must preserve rows, pass integrity/privacy checks, and
record `MC_CARTOLIVE_DATABASE_MODE=preserved` before the watchdog returns.

The optional destructive mode remains fail-closed and is not part of the
hosted 3.2.0 release. It requires both:

```text
--fresh-database
--confirm-fresh-database DELETE-MC-CARTOLIVE-PRODUCTION-DATA
```

In destructive mode, the deploy script discovers the selected image's numeric
runtime user and group in a network-isolated helper container, then assigns
only the bounded `data/` directory to that identity with mode `0750`. The same
step runs for an empty-database rollback. This preserves `data/config.yaml`
while allowing a non-root image to create SQLite files on a clean host.

Normal rollback starts the previous digest against the preserved, additively
migrated database. Disaster recovery restores the verified block-volume backup
before starting either digest.

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
database and require at least 9 GiB free and less than 75% root usage. A
preserved deployment keeps its recovery copy on separate block storage and the
24-hour audit requires at least 9 GiB plus 20% free on the live filesystem.
Destructive mode still checks that deletion can yield at least 25 GiB, verifies
that space after deletion, and requires root usage below 25% before starting
the candidate.

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
