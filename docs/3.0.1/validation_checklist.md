# MC-CartoLive 3.0.1 Validation Checklist

## Local Gates

- [x] `cd backend && go test ./...`
- [x] `cd web && npm test -- --run` - 66 files, 295 tests
- [x] `cd web && npm run build`
- [x] `node scripts/check-version-sync.mjs`
- [x] `node scripts/public-schema-check.mjs`
- [x] `node scripts/check-asset-pack.mjs`
- [x] `node scripts/check-frontend-budget.mjs`
- [x] `podman build --format docker -t mc-cartolive-meshcore-live-map:3.0.1-local .`
- [x] `git diff --check`

## Browser Smoke

- [x] Skipped by operator request on 2026-06-14 because browser smoke can crash
  this workstation.
- [ ] Desktop `1920x1080` live map renders with Watch/Explore/Terrain/Studio
  controls and one Follow action.
- [ ] Mobile `390x844` renders the Map, Packets, Nodes, Chat, and More tabbar.
- [ ] Map settings drawer exposes the four modes first and keeps advanced
  layer/style controls behind collapsed sections.
- [ ] Toasts appear for copy/share/follow/export states without overlapping the
  mobile tabbar or VCR controls.

## Privacy

- [x] No public API fields were added.
- [x] Public UI still avoids raw packet data, packet hashes, full keys,
  observer public keys, private broker details, and resolver debug reasons.
