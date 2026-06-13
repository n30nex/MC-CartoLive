# Archived Roadmap: 2.5.2 To 2.6.0

Baseline audited: `v2.9.6` is the current production baseline. This file is
kept as a concise archive for the old 2.5.x to 2.6.0 planning track and for the
version-sync guard.

## Outcome

The 2.5.x to 2.6.0 line moved MC-CartoLive from a Canada-only live map toward a
world-ready packaged application:

- generic public region labels and configurable map bounds
- public-safe Packets, Chat, VCR history, and NetGraph surfaces
- package smoke for synthetic and worldwide fixtures
- privacy scanning for public JSON and WebSocket payloads
- release metadata drift checks
- safer Docker/Compose release behavior
- better mobile and desktop browser smoke coverage

Detailed patch-by-patch history now belongs in [CHANGELOG.md](../CHANGELOG.md).

## Current Guidance

- Treat 2.9.6 as the supported baseline.
- Keep public API shapes stable unless a future major release explicitly changes
  them.
- Keep route truth RF-only and evidence-based.
- Keep old planning notes, patch task lists, and transient investigation notes
  out of the active docs tree.
