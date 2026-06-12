# MC-CartoLive 2.9.0 Master Plan

## Release Scope

2.9.0 is the visitor UX rollup for the 2.8.x map and propagation line. It keeps
public backend APIs schema-compatible while making the public map easier to
understand on first load and easier to operate on desktop and mobile.

## Completed Changes

- Kept the quiet first view: terrain relief, propagation overlays, and Known
  Pathways remain off by default for new visitors.
- Added frontend-only layer presets for `Live`, `Clean`, `Analysis`, and `3D`.
- Reworked Map Settings into clearer `Base`, `Live`, `Routes`, `Analysis`, and
  `Visuals` groups.
- Added local-only first-visit orientation with quick actions for layer presets,
  Known Pathways, and help.
- Refreshed Shortcut Help with concise visitor orientation plus keyboard
  shortcuts.
- Improved SelectionDrawer hierarchy with compact public-safe node and route
  summary metrics before the detail fields.
- Updated the top-bar changelog to the current 2.9.0/2.8.x release train.
- Updated version metadata, changelog, roadmap, release notes, and validation
  checklist for 2.9.0.

## Validation Plan

- `cd backend && go test ./...`
- `cd web && npm test -- --run`
- `cd web && npm run build`
- `node scripts/check-version-sync.mjs`
- `podman build --format docker -t mc-cartolive-meshcore-live-map:2.9.0 .`
- Podman package smoke.
- Local and deployed public privacy scans.
- Codex in-app Browser smoke for desktop `1920x1080` and mobile `390x844`.

## Merge And Deploy

Merge `codex/2.9.0-ux-roadmap` into `main` after validation, push `main`,
delete the feature branch if it is no longer needed, deploy from the pushed
`main` SHA, and run live smoke against `https://carto.canadaverse.org`.
