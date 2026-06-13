# MC-CartoLive 2.9.6 Waterfall Labs Notes

Waterfall Labs is a single public-safe audio/visual instrument for live packet
flow.

## Public Route

| Route | Result |
| --- | --- |
| `/#/lab` | Redirects to Packet Waterfall |
| `/#/lab/waterfall` | Packet Waterfall |
| old `/#/lab/*` experiment routes | Redirect to Packet Waterfall |

## Visual Model

- Generated cinematic RF-waterfall artwork provides the stage backdrop.
- A generated mist/caustic overlay adds depth behind live packet motion.
- Payload classes become falling lanes.
- Public routed packets draw brighter ribbons and splashes.
- Observer-only packets shimmer with tighter drops.
- Public message presence adds spark accents without exposing private data.

## Audio Model

Audio is opt-in and browser-local.

- Droplet bells: short packet arrivals.
- Glass pads: routed events and longer paths.
- Shimmer noise: observer and public message events.
- Bass swells: aggregate traffic intensity.
- Master compression keeps bursts musical when packet rates rise.

## Controls

Waterfall controls are browser-local:

- volume
- motion
- density
- time window
- payload focus
- reduced motion

## Public Inputs

Allowed inputs:

- public activity and route pulse DTOs
- payload type names
- public regions/IATA labels
- sanitized message presence and public sender labels
- public route endpoint labels and coordinates
- timing, hop counts, segment counts, and public route distance

Forbidden inputs:

- raw payloads
- raw packet summaries
- packet hashes
- raw path hex
- full keys or observer keys
- private broker credentials
- resolver debug reasons
- local operator config

