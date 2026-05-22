# Development

## Local Docker

```bash
cp .env.example .env
docker compose up --build
```

Open `http://localhost:39476`.

The public example starts in fixture mode. To use live MQTT, edit `.env`, set
`MQTT_ENABLED=true`, clear `FIXTURE_REPLAY_PATH`, and add private MQTT
credentials.

Do not commit `.env`, `data/config.yaml`, live databases, or WAL/SHM files.

## Credential-Free Fixture Run

Use this when you do not have MQTT credentials or when testing UI behavior in a
repeatable way.

The committed `.env.example` already uses:

```text
MQTT_ENABLED=false
FIXTURE_REPLAY_PATH=/app/examples/fixtures/synthetic-live.ndjson
```

Then run:

```bash
docker compose up --build
```

The fixture at `examples/fixtures/synthetic-live.ndjson` contains fake public
keys, fake node names, and synthetic decoded message text.

## Backend

```bash
cd backend
go test ./...
go run ./cmd/app
```

Useful local debug APIs are available only when `PUBLIC_MODE=false`:

```bash
curl http://localhost:39476/api/v1/live/state
curl "http://localhost:39476/api/v1/debug/resolution?status=ambiguous&limit=50"
curl "http://localhost:39476/api/v1/debug/collisions?hashSize=1"
```

## Frontend

```bash
cd web
npm ci
npm test -- --run
npm run build
```

Vite dev server:

```bash
cd web
npm run dev
```

The frontend expects the Go backend for live API/WebSocket data when running
outside Docker.

Set `VITE_BUILD_NUMBER` when you want a deterministic build label in the top
project bar. Docker and CI builds also pick up `GITHUB_SHA` when present.

## Mobile UI

The mobile layout keeps the map, route motion, packet comets, Live Follow, and
route-copy tools as the primary experience. Secondary panels, status toasts, the
legend, and busy-path lists are hidden by default at small viewport widths.

## Node Connectivity UI

At detail zoom, click a repeater, observer, room, companion, or sensor to test
the connectivity focus. Directly served routes and direct neighbors should
brighten while unrelated routes and nodes dim. The phonebook panel should group
reachable nodes by hop count, highest first, and clicking a row should highlight
the shortest valid public route path without changing the selected source node.

Escape, the panel close button, and an empty map click should clear node, route,
and phonebook path focus.

## Route Copy And Plotting

For v1.3 route-copy checks:

- Select a node, click a phonebook row, and confirm a Copy route button appears
  with a comma-separated six-character MeshCore 3-byte path.
- The copy button should use `pathHash3` route endpoint fields only; full public
  keys must never be exposed.
- Click Plot routes, choose two node endpoints, and confirm the shortest public
  route path glows with a closeable route toast.
- Switch to map-square mode, click two map corners, and confirm all public
  routes crossing the selected square are listed and highlighted.
- Select a node with decoded public messages in the current live window and
  confirm its chatter history is scrollable and closeable.

## Release Checks

Run before publishing or opening a pull request:

```bash
cd backend
go test ./...
```

```bash
cd web
npm ci
npm test -- --run
npm run build
```

```bash
docker compose build
```

Check privacy before committing:

```bash
git status --short --ignored
```

Private files should appear only under ignored output.
