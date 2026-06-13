# MC-CartoLive 2.9.4 Labs Notes

Labs is an experimental live audio/visual suite built only from public-safe
frontend state.

## Experiment Pages

| Route | Experiment | Focus |
| --- | --- | --- |
| `/#/lab/synth` | RF Synth | Packet pitch, pan, and orbital particles. |
| `/#/lab/waterfall` | Packet Waterfall | Payload lanes and burst trails. |
| `/#/lab/sequencer` | Live Sequencer | Sixteen-step packet rhythm. |
| `/#/lab/organism` | Route Organism | High-confidence routes as living fibers. |
| `/#/lab/constellation` | RF Constellation | Public nodes and route ripples as a sky chart. |
| `/#/lab/aurora` | Propagation Aurora | Long routes and multi-hop packets as slow bands. |
| `/#/lab/dj` | Packet DJ Booth | Payload mix as bars, arcs, and percussive tones. |
| `/#/lab/radar` | Network Weather Radar | Public region buckets as scan cells. |
| `/#/lab/fireflies` | Message Fireflies | Public message presence as anchored lights. |

## UI Contract

- The Labs dropdown is the primary navigation into experiments.
- The active experiment is encoded in the URL so pages can be linked directly.
- Fullscreen is the default presentation because the experiments need canvas
  room and inspector context.
- Side mode still exists through the workspace presentation toggle.
- The panel must stay readable at desktop and mobile browser-smoke viewports.

## Public Inputs

Allowed inputs:

- public activity and route pulse DTOs
- public nodes and public routes
- public route endpoint labels and coordinates
- sanitized message sender labels and message presence
- payload type names, public regions/IATA labels, timing, hop counts, and
  public route distances

Forbidden inputs:

- raw payloads, raw packet summaries, raw path hex, packet hashes, full keys,
  observer keys, broker credentials, resolver debug, and private config

## Validation Focus

- Every `/#/lab/*` route must render the matching heading and active dropdown
  state.
- Every experiment canvas must paint pixels in quiet traffic and live traffic.
- Text must not clip inside experiment cards, cue chips, inspector cards, or
  the signal strip.
- Labs must not force audio; audio starts only after explicit user activation.
