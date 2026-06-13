# MC-CartoLive 2.9.5 Operator Notes

2.9.5 is safe to deploy over 2.9.4 with the normal Compose deploy flow. It is a
frontend map-customization release with optional PMTiles build-time inputs and
no database migration.

## What Changed

- Map Settings now opens with Map Studio style profiles before the layer
  toggles.
- The top Layers button quick-cycles through Classic Dark, OpenFreeMap 3D, Topo
  RF, NOC Wallboard, and Low Bandwidth.
- OpenFreeMap 3D and Topo RF automatically enable the relevant 3D, route, and
  terrain controls.
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

On the main map, open Map Settings and confirm Map Studio lists OpenFreeMap 3D,
Topo RF, Offline PMTiles, Accessibility, and Low Bandwidth. Click the top Layers
button once from the default map and confirm the map enters OpenFreeMap 3D with
the button active. The offline profiles should remain usable even when no
PMTiles archive is configured.

## Privacy

Map Studio screenshots are safe when they show only public map UI and sanitized
public labels. Do not include live packet captures, private MQTT credentials,
operator `.env` files, raw path data, full keys, packet hashes, or broker data.
