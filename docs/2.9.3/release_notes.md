# MC-CartoLive 2.9.3 Release Notes

2.9.3 is the Labs update. It adds an experimental live RF workspace that turns
the existing sanitized public MQTT-derived state into opt-in browser audio and
Canvas visual systems.

## Highlights

- Added `#/lab` as a lazy-loaded workspace beside Packets, NetGraph, and Chat.
- Added RF Synth, Packet Waterfall, Live Sequencer, Route Organism, RF
  Constellation, Propagation Aurora, Packet DJ Booth, Network Weather Radar,
  and Message Fireflies lab modes.
- Added native Web Audio sonification with explicit user activation, mute, and
  volume controls.
- Added public-safe lab metrics/selectors derived only from existing public
  `activity`, `routePulse`, `nodes`, `routes`, and stats state.
- Added focused Vitest coverage for lab data shaping, static panel rendering,
  and top-bar Labs navigation.

## Public Data Boundary

Labs do not add backend routes, private DTOs, raw packet payloads, raw path
data, packet hashes, public keys, observer keys, broker details, or resolver
debug fields. Every visual and tone is generated from the same public-safe
frontend state already used by the live map.

## Operator Impact

- The page is available at `/#/lab`.
- Audio is muted until a visitor explicitly enables it.
- The panel supports the same docked/fullscreen workspace presentation as
  Packets and Chat.
- The existing one-container SQLite deployment shape is unchanged.
