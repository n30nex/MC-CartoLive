# MC-CartoLive 3.0.0 Validation Checklist

## Local Gates

- [x] `cd backend && go test ./...`
- [x] `cd web && npm test -- --run`
- [x] `cd web && npm run build`
- [x] `node scripts/check-version-sync.mjs`
- [x] `node scripts/public-schema-check.mjs`
- [x] `node scripts/check-asset-pack.mjs`
- [x] `node --check` for v3 asset scripts and browser smoke.
- [x] `git diff --check`

## Package Smoke

- [x] Podman image build passes for `ghcr.io/n30nex/mc-cartolive:3.0.0`.
- [x] Package smoke passes with the synthetic fixture and default `world` asset
  pack.
- [x] Browser smoke passes on desktop and mobile for `/`, `#/packets`,
  `#/nodes`, `#/netgraph`, `#/chat`, `#/setup`, and `#/lab/waterfall`.
- [x] Pixel checks confirm nonblank map, canvas, PacketAnimator, Waterfall, and
  v3 asset imagery.

## Asset Pack

- [x] `world` PWA icons, app logo, social/release hero, map thumbnails, node
  icons, packet dots, workspace states, and motion sprites render.
- [x] `canada` PWA icons, app logo, social/release hero, map thumbnails, node
  icons, packet dots, workspace states, and motion sprites render.
- [x] No committed asset contains raw packet data, packet hashes, full keys,
  observer public keys, private broker details, or exact third-party marks.

## Canada Deployment Evidence

- [ ] Production build uses `VITE_APP_ASSET_PACK=canada`.
- [ ] Production build uses `VITE_APP_BRAND_NAME=Carto Live Canada`.
- [ ] Production build uses `VITE_APP_BRAND_URL=https://canadaverse.org/`.
- [ ] Droplet Compose port mapping is `80:8080`.
- [ ] `/healthz` reports version `3.0.0`.
- [ ] `/healthz` reports expected git SHA: `<fill after deploy>`.
- [ ] Live smoke passes for `https://carto.canadaverse.org`.

## Release Evidence

- [ ] Implementation commit SHA: `<fill before release>`.
- [ ] Deploy evidence commit SHA: `<fill after deploy>`.
- [ ] Tag `v3.0.0` pushed.
- [ ] GHCR image `ghcr.io/n30nex/mc-cartolive:3.0.0` published as the
  world/default image.

## Local Evidence

- Frontend tests: 65 files, 286 tests passing.
- Backend tests: `go test ./...` passing.
- Package smoke: synthetic and world scenarios passed against the local Podman
  image via host `172.25.129.67`.
- Browser smoke: desktop `1920x1080` and mobile `390x844` passed with
  screenshots under `artifacts/browser-smoke/`.
- Pixel sanity: sampled smoke screenshots had varied colors and nonblank
  content.
