# MC-CartoLive 3.2.2 Release Notes

MC-CartoLive 3.2.2 is a lossless live-flow stability patch. It keeps SQLite
schema `32000`, the 3.2 public privacy boundary, conservative RF resolution,
and digest rollback compatibility with 3.2.1.

## Live ingest and projection

- Runtime writes are coordinated through priority lanes so primary ingest and
  live public projection remain fair while retention and backfill yield.
- Transient SQLite busy/deadline outcomes are retried with the same ingest
  identity. Accepted traffic is not counted as processed before durable work
  succeeds, and derived work is retried instead of silently disappearing.
- Public activity and route-pulse rows are committed as one ordered live-core
  batch before broadcast. Background search/summary projection is recoverable.
- Readiness and metrics expose privacy-safe primary/live queue age, projection
  state, persistence failures, and observation-to-broadcast latency.

## Immediate browser state and lossless motion

- WebSocket state and cursor progress apply immediately; `displayAt` is
  advisory and no longer creates a cinematic backlog.
- Only connected-live events animate. HTTP hydration, cursor recovery, and
  snapshots reconcile state without replaying old motion.
- One adaptive animation-frame scheduler retains a distinct visual for every
  safely mappable live packet. High-load modes shorten visuals instead of
  sampling them; emergency scheduling is observable and fails release proof.
- PacketTV and packet history consume sanitized live activity immediately and
  deduplicate later HTTP reconciliation.

## Release integrity

- The release-performance fast-track is removed. Canonical full proof is
  required on the exact release-branch head and again on merged `main`.
- This GitHub release uses the explicit Git-only publication path. It verifies
  main browser CI, both canonical proofs, and the successful immutable
  candidate manifest before promoting world and Canada aliases.
- `release-verification-source-only.json` binds source/workflow identities and
  both image digests. It makes no live deployment, canary, or database-audit
  claim.

Generic `3.2.2`, `3.2`, `sha-<main-sha>`, and `latest` tags serve the world
asset pack. Matching `*-canada` aliases identify the separately built Canada
manifest; no existing Canada host is changed by this release workflow.
