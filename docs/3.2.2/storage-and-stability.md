# 3.2.2 Storage And Stability

SQLite remains schema `32000` with one writer connection and two read
connections. Production retention remains seven days for observations and 24
hours for durable public events.

## Coordinated writes

Primary and live-core work alternate while both are waiting. Background work
runs only when both live lanes are empty. Retention/backfill is sliced to at
most 100 rows and yields as soon as live work arrives.

Primary writes contain the packet, observation, and observer count. Live-core
writes contain resolution, the idempotent edge, and one ordered activity/pulse
event batch. Search and route-summary projections are recoverable background
work sourced from durable rows.

Transient busy/deadline failures retain the same `ingestID` and retry until
success or application shutdown with backoff capped at two seconds. Increasing
SQLite timeouts, restoring multiple writers, or enlarging queues is not the
3.2.2 contention strategy.

## Audit posture

The minute-level systemd job runs `runtime-health-check.sh`, which reads readiness,
metrics, container state, and filesystem state without opening SQLite.
`post-release-audit.sh` performs the full five-minute integrity gate on a consistent
SQLite `.backup` written to `/mnt/mc-cartolive-audit-snapshots`, which must be a
separate mounted filesystem with enough temporary capacity. The copy is hashed,
checked, and removed after aggregate evidence is written.
