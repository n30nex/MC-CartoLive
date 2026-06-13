# MC-CartoLive 2.9.6 Operator Notes

2.9.6 is safe to deploy over 2.9.5 with the normal Compose deploy flow. It is a
frontend Labs release and does not require a database migration.

## Labs Route Behavior

- `/#/lab` and `/#/lab/waterfall` open the Packet Waterfall workspace.
- Retired routes such as `/#/lab/synth`, `/#/lab/radar`, and
  `/#/lab/fireflies` redirect to `/#/lab/waterfall`.
- The Workspaces menu exposes Labs as the Waterfall experience only.

## Audio

Waterfall audio remains muted until a visitor activates it. The browser may
still block audio if the user has not interacted with the page or the browser
policy disallows playback.

The audio engine uses only local Web Audio nodes and does not send audio data to
the backend.

## Validation

Recommended checks after deploy:

```powershell
.\scripts\live-smoke.ps1 -BaseUrl https://carto.canadaverse.org -ExpectedVersion 2.9.6 -ExpectedGitSha <short-sha> -DiagnoseRegion YTR
```

Also verify that:

- `/healthz` reports version `2.9.6` and the expected git SHA.
- `/#/lab/waterfall` renders the Waterfall canvas and controls.
- at least one retired Labs URL redirects to `/#/lab/waterfall`.

