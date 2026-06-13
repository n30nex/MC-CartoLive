# Labs Design Notes

## Implemented In 2.9.3

| Lab | Input | Output |
|---|---|---|
| RF Synth | recent public packet events | opt-in tones mapped by payload, hop count, distance, and region |
| Packet Waterfall | recent public packet events | payload lanes with live motion trails |
| Live Sequencer | last minute of public events | 16-step packet pattern with live step energy |
| Route Organism | public routes and route pulses | route network breathing by freshness/activity |
| RF Constellation | public nodes, routes, and events | starfield-style node/route visualization |
| Propagation Aurora | long or multi-hop public route events | aurora bands and low-energy RF motion |
| Packet DJ Booth | payload mix and recent events | equalizer-style live mix surface |
| Network Weather Radar | public region/IATA event counts | radar cells by public region activity |
| Message Fireflies | public-safe message events | drifting message anchors |

## Data Mapping

- Payload type controls color and oscillator waveform.
- Hop count lifts pitch and visual size.
- Route distance expands trails, arcs, and tone range.
- Routed events are melodic; observer-only events are more percussive.
- Region/IATA values feed radar grouping and stereo placement.
- Public message text only appears as sanitized public message-derived motion.

## Future Lab Backlog

- **RF Chorus**: group active regions into harmonized voices with per-region mute.
- **Time Tunnel**: VCR-backed tunnel that samples 15 minutes to 24 hours of
  public events.
- **Clip Export**: record a 10-second canvas/audio lab clip after explicit user
  action.
- **Topology Instrument**: play selected graph paths as call-and-response motifs.
- **Accessibility Sonar**: nonvisual event-rate cues for operators using the map
  while watching another screen.
- **Propagation Piano Roll**: long-distance events laid out as a rolling score.
- **Packet Weather Loops**: radar cells with region history bands and storm
  fronts from public activity buckets.
- **Field Mode**: low-bandwidth Labs profile with no tile dependency and slower
  animations.

## Guardrails

Labs should stay isolated from `CanadaMap.tsx` unless a visual is explicitly a
map overlay. Add helpers and tests first, keep audio opt-in, and derive public
state through selectors rather than direct backend additions.
