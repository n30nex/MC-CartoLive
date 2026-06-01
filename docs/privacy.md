# Privacy Model

## Private Inputs

Keep these out of git, logs, issues, screenshots, and public artifacts:

- MQTT username and password
- MeshCore private keys
- group/channel secrets
- `.env` files with real values
- live SQLite databases, WAL files, and SHM files
- local `data/config.yaml`
- raw packet captures copied from live traffic

## Public Outputs

Public endpoints should expose only sanitized live-map data needed for display,
including the public 24h VCR history feed, true-path packet records derived
from public routed edge events, and sanitized public chat messages derived from
decoded public text fields.
They must not expose:

- full public keys
- observer public keys
- packet hashes
- raw packet summaries
- path hex
- resolver debug reasons
- raw packet payloads

Operational endpoints such as `/healthz` and `/readyz` may expose public-safe
runtime counters only: cache age, DB readiness, MQTT connection status, message
counts, WebSocket client/drop counts, version, Git SHA, build time, and public
API latency/error counts. They must not expose broker credentials, topics beyond
public-safe labels, raw packet identifiers, full keys, raw hex, resolver details,
or operator config.

The public route API may expose a six-character `pathHash3` for positioned
route endpoints. This is the 3-byte MeshCore route prefix shown in the mobile
app's Set Path flow. It is intentionally limited to the route-copy workflow and
must not be expanded into full public keys.

Decoded message text is exposed only as sanitized public bubble or Chat text
when the backend can decode it from public packet data, the built-in MeshCore
default Public channel key, or extra private channel secrets provided locally by
the operator. Public Chat must not expose channel secret material, raw channel
hash bytes, raw payloads, full keys, packet hashes, broker metadata, or resolver
debug output.

## Region Allowlist

The public map filters state and live events through `PUBLIC_REGIONS`.
Unsupported or unexpected region traffic is counted as an anomaly and excluded
from the public map. `PUBLIC_IATAS` remains a deprecated 2.x alias so existing
Canada deployments keep working.

Empty `PUBLIC_REGIONS` means allow all safe broker region labels, which is the
package-friendly default for private or worldwide brokers. Public hosted maps
should set an explicit allowlist when the operator wants to limit what appears.
IATA codes are still valid region labels, but MC-CartoLive no longer requires a
global airport-code list for correctness.

## Route Truth

Only high-confidence RF paths become public route animations. Ambiguous,
duplicate-prefix, missing-location, missing-RF, distance-gated, invalid, and
unresolved observations do not create guessed public routes.

When an observation cannot safely draw a route but the observer has a public
location, the frontend can show observer-only live activity instead.

## Replay History And Packet Records

The public VCR history endpoints replay only sanitized routed `routePulse`
shapes already used by the live map. The public packets endpoint exposes only
records derived from those same mappable routed pulses. The public Chat endpoint
exposes only sanitized decoded text, sender labels, safe channel labels, and
public map anchors. They must stay inside the same privacy boundary as
`/api/v1/public/state` and `/ws/public`: no raw packet hashes, raw payloads,
full public keys, path hex, summaries, channel secrets, or resolver debug
reasons.

## Tests

Privacy-sensitive changes must keep backend public-state tests passing:

```bash
cd backend
go test ./...
```

Frontend changes that affect message bubbles, live scheduling, routes, clusters,
or labels should keep the web test suite passing:

```bash
cd web
npm test -- --run
```
