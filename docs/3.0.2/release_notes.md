# MC-CartoLive 3.0.2 Release Notes

3.0.2 started as a frontend-only loading motion polish patch. A follow-up
operational update now also bounds raw live data growth while preserving the
public latest-route graph.

## Highlights

- Added shared loading primitives for branded spinners, loading blocks, skeleton
  rows, and stable busy button labels.
- Replaced abrupt waits across lazy workspaces, Packets, Chat, propagation
  history, NetGraph, route GIF export, replay/Laser Show, live status, and solar
  conditions.
- Kept motion subtle, app-like, and reduced-motion-aware.
- Reused the existing v3 asset-pack loading mark and lucide spinner icon; no new
  runtime image generation or asset-pack generation was added.
- Default raw packet/history/search retention is seven days.
- Public history, packet, chat, event, viewport backfill, and propagation
  searches are capped to a maximum seven-day window.
- Compact public route summaries preserve the latest sanitized route graph after
  raw rows are pruned.

## Compatibility

- Public API DTOs remain compatible.
- Existing data volumes and env files remain compatible; unset retention values
  now use seven-day defaults.
- A schema migration adds compact public route summary tables.
- Browser smoke is intentionally skipped for this workstation release flow
  because the operator reported it can crash the host.
