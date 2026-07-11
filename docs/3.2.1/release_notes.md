# MC-CartoLive 3.2.1 Release Notes

MC-CartoLive 3.2.1 is a stability patch for continuous public traffic flow,
bounded SQLite work, and a fail-closed world/Canada release path. It is an
additive upgrade from 3.2.0 and keeps public privacy and route-truth rules
unchanged.

## Live-flow fixes

- The browser now treats public event sequence numbers as strictly increasing
  cursors, not gap-free counters. SQLite may legitimately leave holes when a
  deduplicated insert consumes an AUTOINCREMENT value; those holes no longer
  clear the animation queue or trigger recovery storms.
- Explicit WebSocket lag, reconnect, queue overflow, and server reset still
  use durable HTTP backfill or a complete public-state refresh.
- Non-durable fallback events use an unsequenced live envelope. Browsers can
  render the event without advancing or corrupting their durable resume cursor.
- The default, unmodified Watch view shows packet comets and cluster activity
  at the initial low zoom. Stored unmodified Watch settings migrate once;
  customized operator choices are preserved.
- Bootstrap/full-state races preserve the complete node and route topology
  while retaining newer live events.
- Long-running map dedupe trackers are capacity/TTL bounded, queued GeoJSON
  source work is disposed with its map, and route freshness is re-evaluated
  without forcing high-frequency redraws.
- Timeline/VCR and RF Replay Studio are removed, so historical playback can no
  longer replace the current live stream. Direct sanitized packet-path
  animation remains available from the Packets surface without pausing current
  live traffic.

## Backend stability

- Storage warning and primary-queue pressure no longer pause the only derived
  projection worker. This prevents accepted observations from filling the
  derived queue while map work is frozen; critical filesystem pressure remains
  the fail-safe pause condition.
- Historical packet-path and route-summary backfills are serialized, delayed
  until a quiet live window, and processed in smaller bounded batches so they
  cannot monopolize the single SQLite writer during startup.
- Public cache reconciliation is protected from overwriting concurrent live
  mutations.
- Production continues to use seven-day observation retention and 24-hour
  public-event retention. The hosted database remains schema 32000.

## Release and operations

- Desktop and mobile browser smoke runs on pull requests and protected-main
  pushes and is required before candidate creation. Its follow-on privacy scan
  honors bounded server `Retry-After` responses without weakening forbidden-field
  checks.
- Candidate and release workflows derive the release branch and documentation
  directory from `VERSION`; the one-off 3.2.0 publisher is retired.
- One source commit produces two attested multi-platform images. The `world`
  build is promoted to `3.2.1`, `3.2`, `sha-<main-sha>`, and `latest`; the
  Canada build is promoted to `3.2.1-canada`, `3.2-canada`,
  `sha-<main-sha>-canada`, and `latest-canada` and is the only image deployed
  to `carto.canadaverse.org`.
- Multi-platform identity is verified from registry manifests/configs rather
  than the local Docker pull cache.
- The post-release audit retains only `CAP_DAC_READ_SEARCH`, allowing its
  read-only checks to traverse the protected database directory. Readiness
  identity is checked against the recorded immutable deployment.
- Live smoke reads the loopback-only metrics listener over SSH. Soak checks
  require active public sequence/WebSocket progress when MQTT traffic is
  advancing.

## Compatibility

- No existing public endpoint or sanitized field is removed.
- Public event `seq` remains a durable monotonic cursor when present; consumers
  must allow gaps. An omitted `seq` identifies a live-only fallback and must not
  advance a durable cursor.
- The production SQLite writer remains a single connection. The tested
  production lock wait is 750 ms inside the five-second primary ingest budget.
- Upgrade the hosted 3.2.0 database in preserved mode. Do not use the explicit
  destructive fresh-database option for this patch.

See [validation](validation_checklist.md),
[upgrade and rollback](upgrade-and-rollback.md), and
[the 3.2.0 erratum](../3.2.0/errata.md).
