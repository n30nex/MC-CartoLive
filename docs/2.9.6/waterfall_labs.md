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
- Payload classes become capped falling lanes.
- Public routed packets draw brighter ribbons and limited impact rings.
- Observer-only packets shimmer with tighter drops.
- Public message presence adds spark accents without exposing private data.
- The renderer caps DPR, frame rate, particle counts, and packet drops so bursty
  traffic stays browser-safe.

## Audio Model

Audio is opt-in and browser-local.

- Rhythmic synth steps are quantized to a packet-driven tempo.
- Routed packets become low synth pulses.
- Observer packets become soft hat/noise ticks.
- Text and public message packets become plucked melodic notes.
- Strict per-step and per-second voice limits keep bursts musical and bounded.

## Controls

Waterfall controls are browser-local:

- volume
- rhythm
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
