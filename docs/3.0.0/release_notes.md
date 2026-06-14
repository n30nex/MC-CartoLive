# MC-CartoLive 3.0.0 Release Notes

3.0.0 is the v3 image asset pack release. It keeps the public API stable while
turning the frontend into a polished world-ready package with static committed
assets for the default world build and a Canada preset for the hosted droplet.

## Highlights

- Added `world` and `canada` asset packs for app branding, PWA icons, node role
  icons, packet class chips, map/layer thumbnails, workspace states, route GIF
  overlays, live comet effects, OpenFreeMap 3D comet material, and Waterfall
  Labs backdrops.
- Added an optional manifest-driven OpenAI Image API/Batch API workflow for
  future curated asset generation. Runtime builds never call OpenAI.
- Added `VITE_APP_ASSET_PACK`, defaulting to `world`, across Vite, Docker,
  Compose, `.env.example`, and the Setup workspace.
- Updated LinkBar, Legend, packet/node visual helpers, Map Settings, Packets,
  Node List, PacketAnimator, OpenFreeMap 3D, route GIF export, and Labs to use
  the typed asset registry.
- Added `scripts/check-asset-pack.mjs` as a release gate for asset manifest and
  file validation.

## Compatibility

- Public API DTOs are unchanged.
- Privacy boundaries are unchanged.
- Existing Compose deployments can keep their env files. Add
  `VITE_APP_ASSET_PACK=canada` only when rebuilding the Canada-branded frontend.

## Image Presets

- Published world image: `ghcr.io/n30nex/mc-cartolive:3.0.0`
- Canada droplet build: `VITE_APP_ASSET_PACK=canada`,
  `VITE_APP_BRAND_NAME=Carto Live Canada`,
  `VITE_APP_BRAND_URL=https://canadaverse.org/`
