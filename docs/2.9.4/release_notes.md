# MC-CartoLive 2.9.4 Release Notes

2.9.4 is the Labs polish update. It turns the initial Labs workspace into a
routed experiment suite with a dedicated top-bar dropdown, individual pages,
and a more deliberate fullscreen workbench.

## Highlights

- Added routed Labs pages under `/#/lab/synth`, `/#/lab/waterfall`,
  `/#/lab/sequencer`, `/#/lab/organism`, `/#/lab/constellation`,
  `/#/lab/aurora`, `/#/lab/dj`, `/#/lab/radar`, and `/#/lab/fireflies`.
- Replaced the single Labs link with a dropdown menu that opens any experiment
  directly beside Packets, NetGraph, and Chat.
- Made Labs open fullscreen by default so the live canvas, controls, metrics,
  inspector, and payload mix read as a real experiment page.
- Added per-experiment signal descriptions, cue chips, accent styling, and
  inspector cards.
- Fixed the Open Node List control and added a routed `/#/nodes` workspace with
  search, role/freshness filters, summary cards, sortable columns, and
  mobile-safe table scrolling.
- Tightened desktop and mobile responsive sizing so the canvas and controls do
  not clip or overflow.
- Reduced the weather cloud layer tint by desaturating it, capping opacity, and
  fading it fully before detail-mode zoom.

## Public Data Boundary

Labs remain frontend-only and public-safe. The experiments use the already
sanitized public state: activity events, public route pulses, public route
endpoints, public nodes, public stats, public message presence, region labels,
payload classes, and timing. They do not expose raw payloads, packet hashes,
full keys, raw path data, broker data, resolver debug, or private operator
configuration.

## Operator Impact

- No database migration is required.
- No new backend public route is required.
- Audio remains muted until the visitor explicitly enables it.
- Existing `PUBLIC_MODE=true` deployments keep the same public data boundary.
- Browser smoke now visits every Labs experiment route and the Node List route,
  checking that each Canvas surface paints pixels and the node browser renders.
