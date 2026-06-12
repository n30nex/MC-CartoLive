# MC-CartoLive 2.9.0 UX Roadmap

2.9.0 was the no-public-API-change visitor UX rollup for the 2.8.x
propagation and flat-first map line.

## Delivered Scope

- Kept terrain relief, propagation overlays, and Known Pathways off by default
  for new visitors.
- Added frontend-only layer presets: Live, Clean, Analysis, and 3D.
- Reworked Map Settings into Base, Live, Routes, Analysis, and Visuals groups.
- Added local-only first-visit orientation with quick actions for layer
  presets, Known Pathways, and Help.
- Refreshed Shortcut Help with map orientation plus keyboard shortcuts.
- Added compact node and route summary metrics to SelectionDrawer.
- Updated top-bar changelog highlights and release documentation.

## Public Interface Policy

- No public API response shape changes.
- No new backend schema requirement for the UX rollup.
- All onboarding and map preset state is browser-local.

## Release Evidence

- [Release notes](release_notes.md)
- [Validation checklist](validation_checklist.md)
- [Master plan](master_plan.md)

## Future Direction

Future 2.9.x work should stay small, browser-smoked, and API-compatible unless a
new major plan explicitly changes the public contract.
