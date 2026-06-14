# MC-CartoLive 2.9.6 Release Notes

2.9.6 is the Waterfall Labs release. It retires the old multi-page Labs suite
and turns Labs into one focused, cinematic Packet Waterfall experience.

## Highlights

- Collapsed Labs to `/#/lab/waterfall`. The old experiment routes now redirect
  to Waterfall so shared links remain useful.
- Added generated RF-waterfall background and mist artwork under
  `web/public/labs/waterfall/`.
- Rebuilt the Waterfall canvas with falling packet streams, payload lanes,
  route ribbons, message sparkles, splashes, mist, and live intensity overlays.
- Replaced the old experiment toolbar with Waterfall controls for volume,
  rhythm, motion, density, time window, payload focus, reduced motion, and reset.
- Hotfixed Waterfall rendering with hard DPR, frame-rate, particle, packet-drop,
  and impact-ring caps for browser stability.
- Replaced the first audio pass with a bounded opt-in rhythmic synth using
  packet bass pulses, soft hats, plucks, and compressed output.
- Updated focused tests and release documentation so Labs validates the single
  Waterfall surface, retired route redirects, controls, and bounded renderer
  behavior.

## Privacy

Waterfall Labs remains frontend-only and public-safe. It uses only sanitized
public activity, route pulse, route, node, region, payload, timing, hop, and
message-presence fields already available to the public dashboard.

It does not expose raw payloads, packet hashes, full public keys, raw paths,
resolver debug reasons, private MQTT data, or operator config.
