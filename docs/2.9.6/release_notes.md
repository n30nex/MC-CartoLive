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
  motion, density, time window, payload focus, reduced motion, and reset.
- Upgraded opt-in Web Audio with packet bell, glass pad, shimmer, and bass
  swell voices through a compressed master output.
- Updated focused tests and browser smoke so Labs validates the single
  Waterfall surface, retired route redirects, controls, and nonblank canvas
  rendering.

## Privacy

Waterfall Labs remains frontend-only and public-safe. It uses only sanitized
public activity, route pulse, route, node, region, payload, timing, hop, and
message-presence fields already available to the public dashboard.

It does not expose raw payloads, packet hashes, full public keys, raw paths,
resolver debug reasons, private MQTT data, or operator config.

