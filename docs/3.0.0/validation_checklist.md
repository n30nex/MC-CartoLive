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

- [x] Production build uses `VITE_APP_ASSET_PACK=canada`.
- [x] Production build uses `VITE_APP_BRAND_NAME=Carto Live Canada`.
- [x] Production build uses `VITE_APP_BRAND_URL=https://canadaverse.org/`.
- [x] Droplet Compose port mapping is `80:8080`.
- [x] `/healthz` reports version `3.0.0`.
- [x] `/healthz` reports expected git SHA:
  `ed286fcf85cbbb013c9a8043a993bc4e4b0a5d55`.
- [x] Live smoke passes for `https://carto.canadaverse.org`.

## Release Evidence

- [x] Implementation commit SHA:
  `ed286fcf85cbbb013c9a8043a993bc4e4b0a5d55`.
- [x] Deploy evidence commit records the Canada production validation.
- [x] Tag `v3.0.0` pushed.
- [x] GHCR image `ghcr.io/n30nex/mc-cartolive:3.0.0` published as the
  world/default image by GitHub Actions run `27486711923`.
- [x] GHCR manifest inspection confirms a linux/amd64 image digest:
  `sha256:a113b124e117f43ae26363ca352c1c11572f084f9faaa46b2625d4cc27675b07`.
- [x] GitHub Release published:
  `https://github.com/n30nex/MC-CartoLive/releases/tag/v3.0.0`.

## Local Evidence

- Frontend tests: 65 files, 286 tests passing.
- Backend tests: `go test ./...` passing.
- Package smoke: synthetic and world scenarios passed against the local Podman
  image via host `172.25.129.67`.
- Browser smoke: desktop `1920x1080` and mobile `390x844` passed with
  screenshots under `artifacts/browser-smoke/`.
- Pixel sanity: sampled smoke screenshots had varied colors and nonblank
  content.

## Canada Live Evidence

- Fast-forwarded `/opt/MC-CartoLive` from `dc43d04` to `ed286fc` with
  `git pull --ff-only origin main`; no database backup step was run for this
  deployment.
- Droplet `.env` release keys after deploy:
  `APP_VERSION=3.0.0`, `VITE_APP_ASSET_PACK=canada`,
  `VITE_APP_BRAND_NAME=Carto Live Canada`,
  `VITE_APP_BRAND_URL=https://canadaverse.org/`, and
  `PUBLIC_BASE_URL=https://carto.canadaverse.org`.
- Public Canada manifest served from
  `https://carto.canadaverse.org/brand/canada/manifest.json` with
  `name=Carto Live Canada`.
- Live smoke passed: packets `648378`, nodes `1993`, routes `794`,
  history events `25`, packet paths `25`, chat messages `7`, WebSocket
  hello `seq=504151`, `packetIngestState=fresh`, `publicCacheState=fresh`,
  and `liveConfidenceState=fresh`.
