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

## Validation

- Backend tests passed with `cd backend && go test ./...`.
- Frontend tests passed with `cd web && npm test -- --run`.
- Production frontend build passed with `cd web && npm run build`.
- Version sync passed with `node scripts/check-version-sync.mjs`.
- Podman image build passed for `mc-cartolive-meshcore-live-map:2.9.0`.
- Podman package smoke passed.
- Local and deployed public privacy scans passed.
- Codex in-app Browser smoke covered desktop `1920x1080` and mobile `390x844`.

## Release Status

The release branch was merged into `main`, pushed to GitHub, deleted after
merge, deployed to the droplet from the pushed `main` SHA, and live-smoked
against `https://carto.canadaverse.org`.
