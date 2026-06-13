# MC-CartoLive 2.9.5 Map Studio Notes

Map Studio is a browser-local presentation layer for public-safe map
customization. It does not change ingestion, storage, route truth, or public API
schemas.

## Style Profiles

- `Classic Dark` and `Classic Light`: CARTO raster basemaps for the familiar
  traffic-first view.
- `OpenFreeMap Dark` and `OpenFreeMap Light`: bundled vector styles tuned for
  RF overlays and 3D readiness.
- `Positron`, `Liberty`, and `Fiord`: OpenFreeMap-hosted style presets for
  cleaner light, general-purpose, and muted review views.
- `OpenFreeMap 3D`: pitched vector terrain, buildings, route arcs, packet
  comets, and node models.
- `Topo RF`: terrain-first RF planning defaults with routes, shaded relief,
  height tint, and propagation context enabled.
- `NOC Wallboard`: low-clutter operations display for wall screens with
  restrained relief context.
- `Offline PMTiles` and `Field Offline`: operator-supplied PMTiles basemap
  profiles with local fallback when no archive URL is configured.
- `Accessibility`: higher label visibility and calmer motion defaults.
- `Low Bandwidth`: local low-detail map with expensive visual layers disabled.

## 3D Controls

The 3D And RF section controls the node and route presentation:

- `Role Towers`: mast-like node models with role-specific accents.
- `Beacons`: vertical markers with signal rings for a more animated RF look.
- `Pins`: compact low-cost 3D markers for dense map review.
- `Terrain clarity`: controls terrain mesh lift, hillshade intensity, and subtle
  height tint together.
- `Building opacity`: adjusts 3D building visibility without hiding routes.
- `Node model scale`: grows or shrinks all 3D node models.
- `Antenna height`: lifts nodes above the terrain surface in meters.
- `Route arc height`: changes the vertical clearance of 3D route arcs.

## PMTiles Setup

Leave `VITE_PMTILES_BASEMAP_URL` blank for the default public build. To package
an offline basemap, host a PMTiles archive at a same-origin or CSP-allowed HTTPS
URL and set the value before building:

```bash
VITE_PMTILES_BASEMAP_URL=/tiles/canada.pmtiles npm run build
```

For Docker/Compose builds, set the same variable in `.env` so it is passed as a
frontend build arg. `VITE_PMTILES_TERRAIN_URL` can point at a compatible
Terrarium DEM PMTiles archive; when it is blank, offline profiles stay flat
instead of fetching external terrain tiles.

## Validation

Map Studio changes should run the focused frontend tests, full Vitest suite,
frontend build, browser smoke, and package smoke. Public privacy scans should
remain unchanged because the feature is frontend-only.
