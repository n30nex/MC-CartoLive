# MC-CartoLive 2.9.5 Operator Notes

2.9.5 is safe to deploy over 2.9.4 with the normal Compose deploy flow. It is a
frontend map-customization release with optional PMTiles build-time inputs and
no database migration.

## What Changed

- Map Settings now opens with operator mode cards before detailed layer toggles.
- The main toolbar is now `Live`, `Focus`, `Routes`, `Map`, and `More`.
- `Map` opens mode cards for Clean Live, Terrain/Topo, 3D, and Low Bandwidth;
  advanced style, layer, packet, weather, and RF controls are collapsed.
- Classic, NOC, Accessibility, and standard OpenFreeMap styles stay flat by
  default. OpenFreeMap 3D and Topo RF automatically enable terrain.
- Offline PMTiles and Field Offline profiles use `VITE_PMTILES_BASEMAP_URL`
  when supplied, and otherwise fall back to a local low-detail map.
- 3D nodes can render as role towers, signal beacons, or minimal pins, with
  configurable node height, scale, building opacity, and route arc height.

## Checks After Deploy

Run:

```powershell
.\scripts\live-smoke.ps1 -BaseUrl https://carto.canadaverse.org -ExpectedVersion 2.9.5 -ExpectedGitSha <short-sha> -DiagnoseRegion YTR
```

Then open:

- `https://carto.canadaverse.org/`
- `https://carto.canadaverse.org/#/lab/synth`
- `https://carto.canadaverse.org/#/nodes`

On the main map, confirm the top toolbar shows only `Live`, `Focus`, `Routes`,
`Map`, and `More`. Open `Map` and confirm the Clean Live, Terrain/Topo, 3D, and
Low Bandwidth cards appear first. Classic Dark/Light should be flat at street
zoom until `Terrain relief` is explicitly toggled. Terrain/Topo and 3D should
still enable terrain. The offline profiles should remain usable even when no
PMTiles archive is configured.

## Privacy

Map Studio screenshots are safe when they show only public map UI and sanitized
public labels. Do not include live packet captures, private MQTT credentials,
operator `.env` files, raw path data, full keys, packet hashes, or broker data.
