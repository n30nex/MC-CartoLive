# MC-CartoLive 3.0.0 Asset Pack

3.0.0 introduces a committed v3 asset system for MC-CartoLive. The shipped
runtime assets are static PNG/WebP-style PNG outputs generated from the local
manifest and deterministic post-processing scripts. Normal builds, containers,
browser runtime, and the production droplet do not call OpenAI.

## Presets

- `world`: the default GitHub/GHCR/easy-deploy preset for global users.
- `canada`: the production Canadaverse preset used by
  `carto.canadaverse.org`.

Set the preset at frontend build time with:

```text
VITE_APP_ASSET_PACK=world
```

The hosted Canada release uses:

```text
VITE_APP_ASSET_PACK=canada
VITE_APP_BRAND_NAME=Carto Live Canada
VITE_APP_BRAND_URL=https://canadaverse.org/
```

## Generation Workflow

The asset workflow is manifest-driven:

- `scripts/asset-pack-manifest.mjs` defines every asset record.
- `scripts/generate-asset-pack.mjs` can prepare OpenAI Batch API JSONL or call
  the Image API when `OPENAI_API_KEY` is provided.
- `scripts/process-asset-pack.mjs` writes deterministic committed assets for
  local/offline release builds.
- `scripts/check-asset-pack.mjs` validates required records and output files.

Each manifest record includes `id`, `pack`, `category`, `prompt`, `size`,
`quality`, `format`, `postprocess`, `targetFiles`, and `acceptance`.

The generation prompts are original and style-inspired. They do not request or
embed exact third-party logos, live node names, packet hashes, private-looking
IDs, raw packet data, full keys, resolver internals, broker secrets, or live
captures.

## Runtime Layout

- Imported frontend assets live under `web/src/assets/v3/{world,canada}/`.
- Static PWA/brand assets live under `web/public/brand/{world,canada}/`.
- Waterfall v3 backdrops live under `web/public/labs/waterfall/`.
- `web/src/assets/v3/assetPacks.ts` is the typed registry and fallback boundary.

## Validation

Run the asset gate before release:

```bash
node scripts/check-asset-pack.mjs
```

The gate checks manifest shape, `gpt-image-2` sizing/quality assumptions,
target paths, PNG signatures and dimensions, and pack-local PWA manifests.

## Privacy Notes

Assets are decorative, navigational, or symbolic. They do not invent geospatial
facts and do not replace authoritative MapLibre, CARTO, OpenFreeMap, or PMTiles
map data. Hardware-specific art is static and derived from existing public role
classes only; no new public DTO fields were added in 3.0.0.
