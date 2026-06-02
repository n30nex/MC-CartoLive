# MeshCore MQTT Live Map v2.5.38

Also known as **MC-CartoLive**.

MC-CartoLive is a Dockerized live MQTT-to-map dashboard for MeshCore public RF
observations. It ingests MeshCore broker traffic, resolves only
high-confidence RF routes, and serves a smooth public MapLibre dashboard with
live packet motion, observer activity, decoded public message bubbles, and
privacy-safe public APIs.

The app stays intentionally simple for operators: one Go backend, one embedded
React frontend, one SQLite database, one Docker Compose service.

Public instance: [MeshCore Canada MQTT](https://carto.canadaverse.org/).

## Screenshots

Real public map data from the production UI:

![Canada cluster overview](docs/assets/screenshots/canada-clusters.png)

![Toronto live route detail](docs/assets/screenshots/toronto-detail.png)

![Ottawa live route detail](docs/assets/screenshots/ottawa-detail.png)

### v2.5.38 Feature Gallery

Version 2.5.38 keeps the Canada deployment intact while continuing the
worldwide/private broker support introduced in the 2.5 line with configurable
map bounds and generic region labels.

This patch pauses NetGraph canvas animation frames and D3 force layout work
while the browser tab is hidden, then resumes drawing cleanly when the page is
visible again. It is a narrow production-smoothness patch for long-lived public
viewer sessions.

Version 2.5.37 added render-quality frame pacing for both the flat packet
canvas and OpenFreeMap 3D layer, so `Smooth` and `Balanced` modes reduce
animation cadence as well as visual density. It also made Live Follow even
calmer with broader, slower camera moves and made the Perf page's primary cards
answer `live`, `degraded`, `quiet`, or `not live` before showing supporting
details.

Version 2.5.36 added a persisted render quality control for `Smooth`,
`Balanced`, and `High` modes. The default Balanced path lowers OpenFreeMap 3D
node/route budgets, caps active 3D comets/glows with proper object disposal,
uses cheaper ordinary route-arc geometry, and scales flat-map packet canvas DPR,
masking, residue, observer aura, and sparkle work so live views stay smoother on
modest clients.

Version 2.5.35 trimmed Perf into a direct live/not-live status view, slowed Live Follow
into a watchable linear camera move, extended palette tokens into more UI status
surfaces, and made NetGraph use the same device and packet visual registry as
the live map legend.

Version 2.5.34 added a repeatable browser smoke gate for desktop `1920x1080`
and mobile `390px` layouts. The first run found and fixed mobile Perf/Packets
panel clipping, so this is now part of the 2.6 release confidence path.

This patch makes selected OpenFreeMap packet replay more cinematic with a
trailing chase camera, steadier follow cadence, and distance-aware pitch while
keeping forced replay public-safe and frontend-only.

This patch continues the 3D production polish: OpenFreeMap 3D now uses adaptive
node and route-arc budgets by zoom, and ordinary nodes near detail zoom render
as lightweight markers while selected/path/neighbour nodes keep full procedural
models.

This patch fixes the remaining visible public Chat repeat case: long decoded
messages rebroadcast through multiple route or sender wrappers are collapsed in
the Chat page, while short replies from different senders remain visible.

This patch reduces OpenFreeMap 3D render cost: ordinary route arcs use cheaper
geometry, selected/focused routes keep higher detail, 3D packet comets reuse
cached arc samples and fixed trail buffers, and volatile activity counters no
longer force node-scene rebuilds when the visible 3D model set has not changed.

This patch makes NetGraph match the rest of the app more closely: the canvas
background, selected pathways, fallback link colors, labels, observer accents,
and panel chrome now use the active light/dark theme and selected palette
instead of fixed dark-blue graph colors.

This patch makes the live-status and follow controls easier to trust: Perf now
answers whether the public system is live, the top-bar build age is parsed
strictly from release metadata, and Live Follow uses slower, lower-zoom camera
moves that are more watchable during busy traffic.

The default flat map's live motion is also easier to read: recently heard
high-frequency pathways get thicker, hue-shifted lines and stronger payload
glow, then shrink and fade back as the path cools. Packet comet residue leaves
deterministic short-lived sparkles so recent true packet movement is more
obvious without adding random particles or exposing new public data. Setup is
still available from the Guide overlay for new operators who need public-safe
`.env` starter settings, but it is no longer a permanent top-bar page. The
release also keeps Chat duplicate hardening, NetGraph stability helpers,
OpenFreeMap packet replay chase math on shared 3D route-arc samples, Docker
Compose release metadata fallback fixes, and public JSON/WebSocket privacy
scanning in local release checks.

The current 2.6 production polish track also keeps public cache refresh off full
SQLite stats counts, exposes public-safe cache truncation and packet-search
pressure, shares map and Legend device icons through one role registry, keeps
Live Follow calmer, keeps the activity heatmap subtle and toggleable, strengthens
light-mode route contrast, and keeps the VCR scrub timeline readable. Recent
observer-only public text bubbles survive reloads/polling fallback, Public
group-text decoding is cleaner for map speech bubbles, Packets has clearer
select/search/replay guidance, OpenFreeMap 3D rebuilds fewer scene objects in
dense views, and NetGraph is steadier with tighter component packing, mobile
pinch zoom, faster live pulse drawing, and Legend-matched role visuals.

OpenFreeMap 3D turns the public live map into a terrain-aware network view with
procedural node models, elevated public route arcs, and 3D packet motion.

![OpenFreeMap 3D route arcs and node models](docs/assets/screenshots/openfreemap-3d-arcs-2.4.9.png)

Packets is a production browsing tool for true public paths: server-backed
filters, segment details, focus/replay controls, and 24h public-safe history.

![True-path Packets page](docs/assets/screenshots/packets-true-path-2.4.9.png)

Plot Routes keeps long selected paths visible at low zoom for cross-region
analysis without showing every idle route across the country.

![Long Plot Routes analysis path](docs/assets/screenshots/plot-routes-long-path-2.4.9.png)

NetGraph renders the connected public RF topology as a closeable live graph,
with live pulses, search, fit/reset, mobile pan/zoom/select, tighter component
packing, Legend-aligned node visuals, and compact node/pathway inspectors.

![NetGraph overview](docs/assets/screenshots/netgraph-overview-2.4.9.png)

![NetGraph node inspector](docs/assets/screenshots/netgraph-node-inspector-2.4.9.png)

## Capabilities

- Ingests MeshCore MQTT traffic read-only, decodes public-safe packet metadata,
  and stores observations in SQLite.
- Resolves only high-confidence RF routes. Ambiguous, unresolved, unmappable, or
  disallowed-region traffic is counted for diagnostics but not guessed onto the
  map.
- Serves a MapLibre public dashboard with clustered overview, detail zoom,
  live packet comets, observer activity, activity heatmap, message bubbles, Plot Routes, a
  reachable-node phonebook, OpenFreeMap 3D mode, light/dark themes, and palette
  controls.
- OpenFreeMap 3D mode uses terrain, neutral building extrusions, procedural
  low-poly node models, elevated route arcs, and 3D packet comet trails while
  retaining the existing 2D layers for labels, clicks, and fallback rendering.
- Provides hidden-by-default 24h VCR replay, a Packets tab for true-path packet
  records, a Perf tab for public-safe runtime counters, a NetGraph tab for a
  live connected-node graph, and a Chat tab for sanitized decoded public text
  history using the same sanitized public routes and events.
- Adds a browser first-run Setup tab that generates public-safe world, Canada,
  and custom deployment `.env` starters for packaged installs.
- Adds top-bar quick help, latest changelog, and feature list popups. First-time
  visitors see a dismissible welcome guide stored only in browser localStorage.
- Includes operator tools for release checks, live droplet smoke checks, soak
  checks, performance counters, and local-only map-inclusion diagnostics.
- Keeps public APIs sanitized: no broker credentials, channel secrets, live DB
  files, packet hashes, full public keys, raw path hex, raw payloads, or resolver
  debug details.

## Architecture

- Go HTTP API, WebSocket server, MQTT subscriber, route resolver, and SQLite persistence.
- React + Vite + TypeScript + MapLibre public dashboard.
- SQLite database at `/app/data/meshcore-live.db`, persisted through Docker volume or bind mount.
- Static frontend embedded into the Go binary during Docker build.

Public routes:

```text
GET /healthz
GET /readyz
GET /api/v1/public/state
GET /api/v1/public/history?from=<ms>&to=<ms>&limit=<n>&cursor=<token>
GET /api/v1/public/history/summary?from=<ms>&to=<ms>&bucketMs=<n>
GET /api/v1/public/packets?from=<ms>&to=<ms>&limit=<n>&cursor=<token>&region=&iata=&payload=&minHops=&messageOnly=&q=
GET /api/v1/public/chat?from=<ms>&to=<ms>&limit=<n>&cursor=<token>&region=&iata=&channel=&q=
GET /ws/public
```

With `PUBLIC_MODE=true`, internal debug APIs are not exposed.

## Quick Start

```bash
cp .env.example .env
docker compose up --build
```

Open:

```text
http://localhost:39476
```

The dashboard starts in the MapLibre/CARTO dark view. Use the map base toggle
to switch the same live map to OpenFreeMap 3D without changing ports or
services.
In OpenFreeMap mode, Map Settings can independently toggle 3D node models,
route arcs, packet comets, packet trails, observer bursts, and building
extrusions.
Use the top theme controls to switch dark/light mode and choose a color
palette. These are browser-local preferences and do not change backend data.

The committed example runs a synthetic fixture by default so a fresh clone works
without MQTT credentials. To connect to live MQTT, edit your private `.env`, set
`MQTT_ENABLED=true`, clear `FIXTURE_REPLAY_PATH`, and add your MQTT username and
password.

The package default is worldwide: valid non-zero coordinates inside normal
world map bounds are allowed, and broker topic labels such as `YKF`, `r1`,
`AUS`, or `EU-W` are treated as generic regions. Hosted Canada deployments can
set `MAP_REGION_PRESET=canada` and a `PUBLIC_REGIONS` allowlist.

## Published Docker Image

Tagged releases publish a built image to GitHub Container Registry:

```text
ghcr.io/n30nex/mc-cartolive:<version>
ghcr.io/n30nex/mc-cartolive:<major>.<minor>
ghcr.io/n30nex/mc-cartolive:latest
```

Run the published image in credential-free demo mode:

```bash
docker run --rm -p 8080:8080 \
  -e MQTT_ENABLED=false \
  -e PUBLIC_MODE=true \
  -e PUBLIC_BASE_URL=http://localhost:8080 \
  -e FIXTURE_REPLAY_PATH=/app/examples/fixtures/synthetic-live.ndjson \
  ghcr.io/n30nex/mc-cartolive:2.5.38
```

For a real public deployment, mount persistent data and provide private MQTT
credentials through environment variables or an env file:

```bash
docker run -d --name mc-cartolive \
  -p 8080:8080 \
  --env-file .env \
  -v mc-cartolive-data:/app/data \
  ghcr.io/n30nex/mc-cartolive:2.5.38
```

The image includes the synthetic demo fixture, runs as non-root `appuser`, and
exposes `/healthz` for container liveness.

## Configuration

Real MQTT credentials, channel secrets, private keys, live databases, and local
operator config belong only in your private `.env` and `data/` directory. They
must not be committed.

Important settings:

| Variable | Required | Notes |
| --- | --- | --- |
| `PUBLIC_MODE` | yes | Use `true` for public hosting. |
| `PUBLIC_BASE_URL` | yes | Browser origin allowed for public WebSocket connections. Use your HTTPS site URL in production. |
| `MQTT_ENABLED` | yes | The public example uses `false`; set `true` only with private credentials. |
| `MQTT_BROKER_URL` | yes when MQTT is enabled | Defaults to the MeshCore Canada MQTT broker URL. |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | yes when `MESHCORE_AUTH_MODE=subscriber` and MQTT is enabled | Keep private. |
| `MESHCORE_CHANNEL_SECRETS` | optional | Keep private. The default MeshCore Public channel is decoded automatically for sanitized speech bubbles; add private raw keys or hashtag names like `#wardriving` only for channels you intentionally want to expose. |
| `MAP_REGION_PRESET` | optional | `world` by default. Use `canada` for the hosted Canada map, or `custom` with `MAP_BOUNDS`. |
| `MAP_BOUNDS` | optional | Custom bounds as `minLat,minLng,maxLat,maxLng`, for example `-45,110,-10,155` for Australia-style bounds. |
| `PUBLIC_REGIONS` | optional | Preferred public region allowlist. Empty means allow all safe broker region labels. |
| `PUBLIC_IATAS` | optional | Deprecated 2.x alias for `PUBLIC_REGIONS`; kept for existing Canada deployments. |
| `VITE_APP_BRAND_NAME` | optional build arg | Top-bar deployment brand. Defaults to `MC-CartoLive`; hosted Canada can set `MeshCore Canada`. |
| `VITE_APP_BRAND_URL` | optional build arg | Link used by the top-bar brand. Defaults to the MC-CartoLive GitHub repo. |
| `VITE_APP_BRAND_LOGO` | optional build arg | Public URL/path for the top-bar logo. Empty uses the bundled MC-CartoLive app icon. |
| `DB_PATH` | yes | SQLite database path inside the container. |
| `CONFIG_YAML` | optional | Private local node/observer coordinate overrides. |
| `FIXTURE_REPLAY_PATH` | optional | Synthetic replay file for demos without MQTT credentials. |

## Worldwide Region Support

MC-CartoLive no longer requires Canadian coordinates or airport-style IATA
labels. IATA codes exist worldwide and remain valid region labels, but the app
now treats the broker topic segment after `meshcore/` as a generic region label.
Accepted labels are public-safe `A-Z`, `0-9`, `_`, and `-` strings from 1 to 16
characters. Existing DB/public fields named `iata` remain for 2.x compatibility;
new responses also include `region` aliases where useful.

Routes are still true RF routes. Worldwide support does not infer links from
coordinate proximity, node names, or label similarity. The resolver remains
region-scoped and still rejects ambiguous prefixes, duplicate matches, missing
coordinates, invalid roles, missing RF evidence, and distance-gated paths.

Examples:

```env
# Worldwide or private broker: allow all safe regions and world coordinates.
MAP_REGION_PRESET=world
PUBLIC_REGIONS=
MQTT_TOPIC=meshcore/#
```

```env
# Hosted Canada-style public map.
MAP_REGION_PRESET=canada
PUBLIC_REGIONS=YYZ,YOW,YKF,YGK,YTR,YUL,YVR,YYC,YEG
DEFAULT_REGION=CANADA
```

```env
# Australia-style private deployment with custom bounds and private regions.
MAP_REGION_PRESET=custom
MAP_BOUNDS=-45,110,-10,155
DEFAULT_CENTER_LAT=-25
DEFAULT_CENTER_LNG=134
DEFAULT_ZOOM=4
PUBLIC_REGIONS=r1,r2,AUS
```

## Credential-Free Demo

The committed `.env.example` already runs with the synthetic fixture:

```text
MQTT_ENABLED=false
FIXTURE_REPLAY_PATH=/app/examples/fixtures/synthetic-live.ndjson
```

Then start Docker:

```bash
docker compose up --build
```

The fixture uses fake public keys and synthetic messages. It is not copied from live traffic.
An additional `examples/fixtures/worldwide-r1.ndjson` fixture demonstrates
non-Canada coordinates and private `r1`/`r2` broker regions for worldwide
package testing.

## Development

Backend:

```bash
cd backend
go test ./...
go run ./cmd/app
```

Frontend:

```bash
cd web
npm ci
npm test -- --run
npm run build
```

Docker:

```bash
docker compose build
```

Browser layout smoke for the 2.6 release gate:

```powershell
npm --prefix web exec playwright install chromium
node scripts/browser-smoke.mjs --base-url http://127.0.0.1:39476
```

The smoke checks desktop `1920x1080` and mobile `390px` layouts for the live
map, Perf, Packets, Chat, and NetGraph. Screenshots are written to
`artifacts/browser-smoke` by default.

## Production Hosting

The recommended v2.5.38 release path is clone + Docker Compose on a VPS or local
host, optionally behind Cloudflare Tunnel or another HTTPS reverse proxy.

For a public site:

1. Set `PUBLIC_MODE=true`.
2. Set `PUBLIC_BASE_URL` to the public HTTPS origin.
3. Keep `.env`, `data/*.db*`, and `data/config.yaml` private.
4. Back up the SQLite database before upgrades.
5. Run `docker compose up -d --build`.
6. Run the live post-deploy smoke from your workstation:

```powershell
.\scripts\live-smoke.ps1
```

More details:

- [Development](docs/development.md)
- [Production](docs/production.md)
- [Operator runbook](docs/operator-runbook.md)
- [Roadmap and release focus](docs/roadmap.md)
- [Privacy](docs/privacy.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

## License

MIT. See [LICENSE](LICENSE).

## Sources

- MeshCore packet format: https://github.com/meshcore-dev/MeshCore/blob/main/docs/packet_format.md
- MeshCore payload format: https://github.com/meshcore-dev/MeshCore/blob/main/docs/payloads.md
- MeshCore Canada MQTT guides: https://meshcore.ca/analyzer/builds/mctomqtt/
- MeshCore MQTT broker subscriber role notes: https://github.com/michaelhart/meshcore-mqtt-broker
