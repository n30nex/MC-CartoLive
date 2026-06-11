# 05 — 2.8.0 Local, Browser, Package, and Live Acceptance Gate

## Principle

2.8.0 is not “done” because code compiles. It is done only when every public page and feature works in a real browser.

## Required local environment

Recommended:

- Go version from `backend/go.mod`
- Node 22+
- npm from lockfile
- Docker + Docker Compose
- Chrome/Chromium for Playwright
- `sqlite3`
- `jq`

## Phase 1 — clean checkout

```bash
git fetch origin
git checkout dev/deepseek-v4
git reset --hard origin/dev/deepseek-v4
git clean -fdx

# restore only required local secrets/config after clean if needed
cp /safe/path/.env .env
```

Never commit `.env`.

## Phase 2 — version sync

After bumping to `2.8.0`:

```bash
node scripts/check-version-sync.mjs
```

Must print:

```text
version sync ok: 2.8.0
```

## Phase 3 — backend tests

```bash
cd backend
go test ./...
go tool govulncheck ./...
cd ..
```

Required new test coverage:

- old DB missing `nodes.supports_multibyte`
- projection fallback with empty `public_packet_paths`
- projection path after backfill
- public Packets filters
- public Packets search via FTS and substring fallback
- public Chat filters/search/dedupe
- public history projection/fallback
- `/readyz` JSON fields stable
- `/metrics` privacy-safe
- trusted/untrusted proxy IP parsing
- app shutdown does not leak goroutines

## Phase 4 — frontend tests/build

```bash
cd web
npm ci
npm test -- --run
npm run build
cd ..
```

Required new frontend tests:

- service worker disabled by default
- legacy service worker unregister logic
- lazy import retry/clear-cache path
- Packets empty/error/loading states
- Chat empty/error/loading states
- NetGraph zero-size guard
- ResizeObserver fallback
- map settings normalization for every layer
- layer settings persistence
- mobile panel presentation state
- API error messages do not expose secrets

## Phase 5 — local Docker run

```bash
docker compose build --pull
docker compose up -d --remove-orphans
docker compose ps
docker compose logs --tail=120 meshcore-live-map || docker compose logs --tail=120
```

Check health:

```bash
curl -fsS http://127.0.0.1:39476/healthz | jq .
curl -fsS http://127.0.0.1:39476/readyz | jq .
curl -fsS http://127.0.0.1:39476/api/v1/public/state | jq '.stats'
```

Packet/chat checks:

```bash
NOW=$(date -u +%s)000
FROM=$((NOW - 86400000))

curl -fsS "http://127.0.0.1:39476/api/v1/public/packets?from=$FROM&to=$NOW&limit=25" \
  | jq '.window, .scan, (.packets|length), .packets[0]'

curl -fsS "http://127.0.0.1:39476/api/v1/public/chat?from=$FROM&to=$NOW&limit=25" \
  | jq '.window, (.messages|length), .messages[0]'
```

## Phase 6 — package smoke

```bash
RUN_PACKAGE_SMOKE=1 ./scripts/release-check.sh
```

Package smoke must cover:

- synthetic fixture
- world fixture
- `/healthz`
- `/readyz`
- `/api/v1/public/state`
- `/api/v1/public/history`
- `/api/v1/public/packets`
- `/api/v1/public/chat`
- public privacy scan
- version equals `2.8.0`

## Phase 7 — browser smoke

Update `scripts/browser-smoke.mjs` before running. Remove obsolete `perf` scenario.

Run:

```bash
RUN_BROWSER_SMOKE=1 ./scripts/release-check.sh
```

Or directly:

```bash
cd web
npm run smoke:browser -- --base-url http://127.0.0.1:39476
cd ..
```

### Required viewports

- desktop: `1920x1080`
- mobile: `390x844`

### Required scenarios

1. live map
2. setup
3. packets
4. chat
5. netgraph
6. map settings
7. OpenFreeMap toggle
8. theme/palette
9. VCR open/close
10. packet replay if packet fixture has a selectable route
11. layer toggle smoke
12. stale service worker upgrade smoke

### Required browser smoke assertions

Each scenario must fail on:

- console error
- page error
- `.panel-error`
- missing expected selector
- expected selector outside viewport
- dynamic import error
- stale service worker cache
- `net::ERR_ABORTED` on active chunks
- 404 on `assets/*.js`
- MapLibre style validation error
- NetGraph canvas width/height <= 0
- API response cached by service worker
- route hash not matching visible panel

### Browser smoke additions

Add global checks after every scenario:

```js
const panelErrors = await page.locator('.panel-error').count();
if (panelErrors > 0) errors.push(`panel-error rendered: ${panelErrors}`);

const swControlled = await page.evaluate(() => Boolean(navigator.serviceWorker?.controller));
if (swControlled && process.env.VITE_ENABLE_SERVICE_WORKER !== 'true') {
  errors.push('service worker controlled page while disabled');
}

const badChunks = consoleErrors.filter((line) =>
  /Failed to fetch dynamically imported module|Loading chunk|assets\/.*\.js.*404/i.test(line)
);
```

NetGraph canvas check:

```js
const canvasBox = await page.locator('.netgraph-canvas').boundingBox();
if (!canvasBox || canvasBox.width < 50 || canvasBox.height < 50) {
  throw new Error(`NetGraph canvas invalid size: ${JSON.stringify(canvasBox)}`);
}
```

## Phase 8 — manual browser verification

Open Chrome with DevTools and disable cache.

Use:

```text
http://127.0.0.1:39476/
http://127.0.0.1:39476/#/setup
http://127.0.0.1:39476/#/packets
http://127.0.0.1:39476/#/chat
http://127.0.0.1:39476/#/netgraph
```

Manual checklist:

```markdown
- [ ] Home map loads
- [ ] Link bar active states work
- [ ] Status bar shows live/degraded/quiet state
- [ ] Map settings opens/closes
- [ ] Every layer toggle can be changed
- [ ] Original map renders
- [ ] OpenFreeMap renders
- [ ] OpenFreeMap can switch back to original
- [ ] Terrain/hillshade does not error
- [ ] Weather layer handles missing API key
- [ ] Clusters render at low zoom
- [ ] Nodes render at detail zoom
- [ ] Routes render
- [ ] Activity heatmap renders
- [ ] VCR opens/closes
- [ ] VCR timeline loads
- [ ] Packets opens
- [ ] Packets filters work
- [ ] Packet focus returns to map
- [ ] Packet replay animates
- [ ] GIF export works if packet selected
- [ ] Chat opens
- [ ] Chat filters work
- [ ] Chat load older works
- [ ] NetGraph opens
- [ ] NetGraph search works
- [ ] NetGraph pan/zoom/select works
- [ ] NetGraph inspector works
- [ ] Mobile 390px works
- [ ] No console errors
- [ ] No page errors
- [ ] No `.panel-error`
```

## Phase 9 — privacy scan

Run public privacy scanner against local app:

```bash
node scripts/check-public-privacy.mjs http://127.0.0.1:39476
```

Must ensure public endpoints do not expose:

- raw packet hex
- raw payload hex
- full public keys
- MQTT credentials
- channel secrets
- `.env`
- DB paths with secrets
- private topics
- raw MQTT JSON
- private debug endpoints in public mode

Also manually test:

```bash
curl -i http://127.0.0.1:39476/api/v1/debug/stats
curl -i http://127.0.0.1:39476/api/v1/packets/recent
curl -i http://127.0.0.1:39476/ws
```

In `PUBLIC_MODE=true`, internal/debug endpoints should not expose data.

## Phase 10 — performance check

Add or run a performance script:

```bash
node scripts/perf-public-api.mjs --base-url http://127.0.0.1:39476 --out perf-results/2.8.0-local.json
```

Minimum metrics:

- p50 latency
- p95 latency
- max latency
- response bytes
- status code
- failures

Endpoints:

- `/healthz`
- `/readyz`
- `/api/v1/public/state`
- `/api/v1/public/history`
- `/api/v1/public/history/summary`
- `/api/v1/public/packets`
- `/api/v1/public/chat`
- `/api/v1/public/solar`

Recommended local fixture budgets:

| Endpoint | p95 target |
|---|---:|
| `/healthz` | 250 ms |
| `/readyz` | 500 ms |
| `/api/v1/public/state` | 500 ms |
| `/api/v1/public/history` | 1000 ms |
| `/api/v1/public/history/summary` | 750 ms |
| `/api/v1/public/packets` | 1000 ms |
| `/api/v1/public/chat` | 1000 ms |
| `/api/v1/public/solar` | 500 ms |

Do not fail the release on first budget violation unless it is severe, but record baseline for future regression.

## Phase 11 — PR evidence

Attach or paste:

- backend test output
- frontend test/build output
- package smoke JSON
- browser smoke JSON
- browser smoke screenshots
- privacy scan output
- deploy dry-run output
- manual checklist
- known deferred items, if any

## Final release gate

The release is green only when:

```text
version sync     PASS
backend tests    PASS
govulncheck      PASS
frontend tests   PASS
frontend build   PASS
docker build     PASS
package smoke    PASS
privacy scan     PASS
browser smoke    PASS
manual browser   PASS
deploy dry-run   PASS
```
