# MC-CartoLive 3.0.2 Release Notes

3.0.2 is a frontend-only loading motion polish patch. It keeps backend public
APIs, DTOs, database schema, WebSocket behavior, privacy rules, and map data
behavior unchanged while making slower UI surfaces feel intentional and stable.

## Highlights

- Added shared loading primitives for branded spinners, loading blocks, skeleton
  rows, and stable busy button labels.
- Replaced abrupt waits across lazy workspaces, Packets, Chat, propagation
  history, NetGraph, route GIF export, replay/Laser Show, live status, and solar
  conditions.
- Kept motion subtle, app-like, and reduced-motion-aware.
- Reused the existing v3 asset-pack loading mark and lucide spinner icon; no new
  runtime image generation or asset-pack generation was added.

## Compatibility

- Public API DTOs are unchanged.
- Backend behavior and deployment schema are unchanged.
- Existing data volumes and env files remain compatible.
- Browser smoke is intentionally skipped for this workstation release flow
  because the operator reported it can crash the host.
