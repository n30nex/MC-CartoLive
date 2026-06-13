# MC-CartoLive 2.9.2 Release Notes

2.9.2 turns the audit plan into public-safe foundations for durable live
delivery, operations visibility, and future map-runtime extraction.

## Highlights

- Added `public_events` with monotonic `seq`, `/api/v1/public/events`, WebSocket
  `latestSeq`, lag ranges, and frontend reconnect backfill.
- Added public-safe `/viewport`, `/noc`, `/coverage`, `/los/profile`,
  `/schema`, and Home Assistant style summary endpoints.
- Added a compact default NOC strip, public route quality buckets, and
  sequence-aware frontend dedupe.
- Added style profile, overlay registry, PMTiles graceful hook, and
  worker-transform foundations for the map runtime.
- Expanded public privacy scans to the new public endpoints.
- Upgraded the frontend build toolchain to Vite 8 and cleared high-severity
  npm audit findings.

## Operator Notes

- SQLite remains the default. Postgres/Redis are not required for 2.9.2.
- Private/raw analyzer mode is intentionally not included.
- Coverage is coarse and cache-backed; external import tooling can populate
  `public_coverage_cells` later.
- LOS returns a safe profile shape even before Canada CDEM samples are imported.
- Service worker snapshot caching is enabled by default; set
  `VITE_ENABLE_SERVICE_WORKER=false` to opt out.
