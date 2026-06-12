# MC-CartoLive 2.8.2 Release Notes

## Highlights

- The default map is flatter and cleaner: terrain relief and propagation
  overlays are off on first load.
- Visitors with legacy 2.8.1 saved defaults are migrated to the quieter first
  view while other map preferences are preserved.
- Flat maps no longer show DEM hillshade; optional dark-mode terrain relief is
  softer when enabled.
- The top bar is focused on live traffic metrics again, with no propagation
  event counter.
- Propagation history is still available from Map Settings and the propagation
  drawer.
- Mobile controls now live in a bottom dock and sheet with larger touch targets.

## Operator Notes

- Public API shape is unchanged.
- Propagation classification and persistence remain enabled server-side.
- The frontend only fetches propagation history when the drawer is opened or
  the propagation overlay is manually enabled.
- Package and local validation should use Podman unless the target host is a
  Docker-only deployment.
