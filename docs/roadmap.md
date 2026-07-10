# MC-CartoLive Roadmap

## Current baseline

Version `3.2.0` is the supported reliability, fresh-storage, compact-bootstrap,
accessible UI, and RF Replay Studio baseline. Unreleased 3.1 work was folded
into 3.2; it is not an upgrade waypoint.

The supported shape remains one public-safe Go/React container with SQLite,
high-confidence RF routes only, immutable release identity, and no raw/private
broker material in public HTTP or WebSocket data.

## Active operations

- Keep the hosted Canada database inside its seven-day observation and 24-hour
  event windows.
- Prove queue, WAL, cache, MQTT session, disk, and watchdog behavior through the
  24-hour and day-8/day-14 gates.
- Keep production on the tested GHCR digest and prevent on-host builds or
  branch-reset rollback.
- Keep RF Replay Studio/export lazy so the normal live map remains inside its
  initial-load and memory budgets.
- Expand browser/accessibility coverage using synthetic public fixtures only.

## Later 3.x candidates

- TypeScript 7, plugin-react 6, jsdom 29, lucide 1, and Three 0.185 remain
  deferred until isolated compatibility work proves them.
- Evaluate a dedicated authenticated operator telemetry listener if loopback
  metrics no longer meet operating needs.
- Add coarse public coverage/import tools and offline terrain fixtures without
  weakening route confidence or privacy.
- Continue decomposing map runtime modules when a behavior change provides a
  measurable performance or testability benefit.

## Permanent non-goals

- no guessed or ambiguous RF routes
- no public raw packet hashes, payload/path hex, full keys, resolver reasons,
  broker credentials, channel secrets, or operator configuration
- no public admin/debug surface without a separate authenticated design
- no unbounded retention on a public deployment that reports ready
