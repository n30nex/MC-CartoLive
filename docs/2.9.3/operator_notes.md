# MC-CartoLive 2.9.3 Operator Notes

## Labs

Open Labs from the top project bar or directly at:

```text
https://carto.canadaverse.org/#/lab
```

The Labs workspace is frontend-only in 2.9.3. It consumes the already-sanitized
public live state and WebSocket updates. It does not require new MQTT, database,
or backend configuration.

## Audio Behavior

Labs audio uses the browser Web Audio API and starts only after a user clicks
the audio control. This keeps the page compatible with browser autoplay policy
and avoids surprise audio on wallboards.

For public wallboards, leave audio muted unless the display has a known speaker
setup. Reduced motion can be enabled inside the panel for slower visual updates.

## Privacy

Labs must remain public-only:

- no raw packet hex;
- no full public keys or observer public keys;
- no raw path hex;
- no packet hashes;
- no resolver debug reasons;
- no broker credentials or operator config.

If future Labs work needs private analyzer data, build it under the private
analyzer namespace instead of expanding the public page.
