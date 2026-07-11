# 3.2.1 Storage And Stability

The supported public posture remains seven days of observations and 24 hours
of durable public events. Compact current route summaries are retained
separately. Public mode remains fail-closed if unbounded retention is enabled.

## Live writer priority

SQLite uses one writer connection. Primary observation ingest has priority;
resolver, route, public-event, cache projection, backfill, pruning, and
maintenance must stay bounded around it.

- Storage `warn` does not pause the sole derived projection worker. Pausing it
  would fill the queue while primary observations continued and permanently
  lose map projection.
- Storage `critical` may pause derived writes while the operator creates space.
- Historical backfills wait for empty live queues, run sequentially, and use
  small transactions with a quiet interval between batches.
- Production packet-path backfill may remain disabled when no upgrade recovery
  is required.
- The tested lock wait is 750 ms. Retry/backoff remains inside the five-second
  primary ingest deadline.

## Vacuum and preserved databases

Fresh schema-32000 databases use `PRAGMA auto_vacuum=INCREMENTAL`. Operators
must inspect `PRAGMA auto_vacuum`, `freelist_count`, page count, WAL size, and
free filesystem space before expecting incremental vacuum to return space.
Changing an existing `auto_vacuum=NONE` database requires an offline full
`VACUUM`; it is not attempted in the live hot path.

The hosted database already reports incremental auto-vacuum. Normal 3.2.1
deployment preserves it and does not perform a destructive fresh start.

## Pressure response

At warning pressure, stop optional backfills/enrichment first and keep live
projection draining. At critical pressure, preserve the database, stop
nonessential writers, verify the off-host copy, and reclaim only known-safe
host artifacts. The watchdog is a bounded recovery safety net, not a substitute
for clearing persistent disk or writer contention.
