# MC-CartoLive 2.9.4 Operator Notes

2.9.4 is safe to deploy over 2.9.3 with the normal Compose deploy flow. It is a
frontend/UI polish release plus a weather overlay tuning change.

## What Changed

- Labs now uses direct experiment URLs under `/#/lab/*`.
- The Labs top-bar entry is a dropdown that lists all nine experiments.
- Labs opens as a fullscreen workspace by default.
- The Open Node List button opens `/#/nodes`, a searchable public node browser.
- The weather cloud raster layer is less saturated, lower opacity, and hidden
  before detail zoom so it does not tint the default map after zooming in.

## Checks After Deploy

Run:

```powershell
.\scripts\live-smoke.ps1 -BaseUrl https://carto.canadaverse.org -ExpectedVersion 2.9.4 -ExpectedGitSha <short-sha> -DiagnoseRegion YTR
```

Then open:

- `https://carto.canadaverse.org/#/lab/synth`
- `https://carto.canadaverse.org/#/lab/radar`
- `https://carto.canadaverse.org/#/lab/fireflies`
- `https://carto.canadaverse.org/#/nodes`

The Labs dropdown should list all nine experiments, the selected page should be
highlighted, and each canvas should render even when live traffic is quiet. The
Node List should search and filter public nodes without overlapping the NOC
summary strip.

## Privacy

Do not use live packet captures or private MQTT data for screenshots. Labs
screenshots are safe only when they show the public map UI and sanitized public
labels.
