# MC-CartoLive 2.9.0 Release Notes

## Highlights

- The first view stays map-first and traffic-first: terrain relief,
  propagation overlays, and Known Pathways remain opt-in.
- Map Settings now has workflow presets for Live, Clean, Analysis, and 3D views.
- Layer controls are grouped by how visitors use the map: Base, Live, Routes,
  Analysis, and Visuals.
- First-time visitors get a dismissible local guide with quick access to layer
  presets, Known Pathways, and help.
- Shortcut Help now explains live traffic, controls, panels, and keyboard
  shortcuts in one compact modal.
- Node and route selections show compact summary metrics before the full detail
  table.
- The top-bar changelog now reflects the current 2.9.0/2.8.x release train.

## Operator Notes

- Public API response shapes are unchanged from 2.8.x.
- No new backend database tables or public endpoints are required for this
  release.
- Map presets and visitor guide dismissal are local browser preferences only.
- Package and local validation should use Podman unless the target host is a
  Docker-only deployment.
