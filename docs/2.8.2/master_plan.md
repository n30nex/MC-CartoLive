# MC-CartoLive 2.8.2 Master Plan

## Release Scope

2.8.2 is the map UI polish release. It keeps the 2.8.1 propagation system but
makes the first map view flatter, quieter, and easier to control on mobile.

## Completed Changes

- Terrain relief is off by default for new visitors.
- Propagation map overlays are off by default for new visitors.
- Legacy 2.8.1 saved map settings migrate terrain and propagation off once
  while preserving other preferences.
- Flat maps show no terrain mesh and no hillshade.
- Optional dark-mode terrain relief uses lower-contrast hillshade.
- The top status bar no longer shows a propagation event counter.
- Propagation history remains available from Map Settings and the propagation
  drawer, but it is not fetched on first load unless requested.
- Mobile map controls use a bottom dock and sheet with larger touch targets for
  settings, Known Pathways, panels, theme, palette, and secondary map actions.

## Validation Plan

- `cd backend && go test ./...`
- `cd web && npm test -- --run`
- `cd web && npm run build`
- `node scripts/check-version-sync.mjs`
- `podman build --format docker -t mc-cartolive-meshcore-live-map:2.8.2 .`
- Podman package smoke.
- Local and deployed public privacy scans.
- Codex in-app Browser smoke for desktop `1920x1080` and mobile `390x844`.

## Merge And Deploy

Merge `codex/2.8.2-map-ui-polish` into `main` after validation, push `main`,
delete the feature branch, deploy from the pushed `main` SHA, and run live
smoke against `https://carto.canadaverse.org`.
