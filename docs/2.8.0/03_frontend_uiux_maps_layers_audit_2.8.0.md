# 03 — Frontend, UI/UX, Maps, and Layers Audit for 2.8.0

## Executive frontend verdict

The dev branch has the right direction for an “ultimate MeshCore map”: Packets, Chat, NetGraph, VCR, replay, OpenFreeMap/3D, themes, layers, activity heatmap, cluster badges, packet animations, terrain/weather controls, and map settings.

The frontend is not production-ready until the broken pages and service-worker behavior are fixed and tested in real browsers.

## P0 frontend blockers

### P0-1 — Packets, Chat, and NetGraph must be fixed

User report: Packets, NetGraph, and Chat do not work.

Treat this as a release blocker.

**Required browser checks**

Open each route in desktop and mobile with DevTools open:

```text
/#/packets
/#/chat
/#/netgraph
```

Verify:

- panel appears
- panel is visible in viewport
- panel controls are clickable
- no console errors
- no page errors
- no `.panel-error`
- no dynamic import error
- no CSP error
- no stale service worker/chunk error
- no layout clipping on mobile
- loading/empty/error states are understandable
- closing returns to the full map
- reopening works

**Likely causes to check first**

1. stale service worker returning old app shell or chunks
2. stale lazy import chunk after deploy
3. `/api/v1/public/packets` empty due projection fallback bug
4. DB migration failure causing public state to fail
5. obsolete browser smoke route hiding the real issue
6. CSS workspace panel covering/zero-size issue
7. NetGraph canvas zero-size
8. `ResizeObserver` failure in test/browser context
9. MapLibre style error causing outer error boundary to trigger
10. API returns 429 due rate limiter during panel polling/smoke

### P0-2 — Unsafe service worker

The current service worker should not ship enabled by default.

Current behavior:

- app registers service worker on every load if supported
- fixed cache name
- precaches `/` and `/index.html`
- cache-first for every non-tile request
- stores any `response.ok`

That means it can cache:

- `/api/v1/public/state`
- `/api/v1/public/packets?...`
- `/api/v1/public/chat?...`
- `/index.html`
- `/assets/*.js`
- stale lazy chunks
- old CSS

**2.8.0 fast fix**

Disable service worker by default.

```ts
const enableServiceWorker = import.meta.env.VITE_ENABLE_SERVICE_WORKER === 'true';

if (enableServiceWorker && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
```

Add default:

```text
VITE_ENABLE_SERVICE_WORKER=false
```

Add 2.8.0 one-time cleanup:

```ts
async function unregisterLegacyServiceWorkers() {
  if (!('serviceWorker' in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((reg) => reg.unregister()));
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('mc-cartolive')).map((key) => caches.delete(key)));
  }
}
```

Use this if `VITE_ENABLE_SERVICE_WORKER !== 'true'`.

**Long-term safe policy**

If PWA returns later:

- cache name includes app version/build hash
- never cache `/api/`, `/healthz`, `/readyz`, `/metrics`, `/ws`
- never cache URLs with query strings unless explicitly safe
- network-first for HTML navigation
- cache-first only immutable hashed assets under `/assets/`
- stale-while-revalidate for manifest/icons only
- automatic old-cache deletion
- dynamic import retry that clears old caches and reloads once
- browser smoke that upgrades from the previous version to the new one

### P0-3 — Browser smoke has obsolete Perf scenario

The smoke test still includes:

```text
#/perf -> .perf-panel
```

But the app redirects `#/perf` away.

**Fix**

Remove the Perf scenario or replace it with the current diagnostics/status experience.

2.8.0 browser smoke must cover:

- live map
- setup
- Packets
- Chat
- NetGraph
- map settings drawer
- OpenFreeMap toggle
- theme/palette
- VCR
- service-worker stale-cache prevention
- mobile viewport

### P0-4 — Lazy panel import failure handling

Packets, Chat, NetGraph, Setup, NodeList, and ShortcutHelp are lazy imports. After deployment, stale clients can hit:

```text
Failed to fetch dynamically imported module
```

**Fix**

Add a lazy import retry wrapper:

```ts
function lazyWithReload<T extends React.ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
  name: string
) {
  return lazy(async () => {
    try {
      return await importer();
    } catch (error) {
      const key = `mc-cartolive-lazy-reload-${name}-${import.meta.env.VITE_APP_VERSION ?? 'dev'}`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        await clearLegacyCaches();
        window.location.reload();
      }
      throw error;
    }
  });
}
```

Do not infinite reload.

## Map/layer audit

### Current map capabilities

The dev branch includes many valuable map/layer systems:

- original CARTO dark/light raster map
- OpenFreeMap vector map
- terrain DEM/hillshade
- 3D buildings
- 3D node models
- elevated 3D route arcs
- 3D packet comets/trails
- activity heatmap
- route payload glow
- cluster activity aura/ring
- cluster role badges
- selected node halo
- node role icons
- observer symbols
- observer labels
- analysis paths
- live route/packet animations
- message bubbles
- weather clouds
- terrain line-of-sight toggle
- map settings drawer
- theme/palette variables

This is the right foundation.

### Required map validation

Run these in browser smoke and manual testing:

1. Original map loads.
2. Light/dark theme changes do not break route contrast.
3. OpenFreeMap mode loads.
4. OpenFreeMap toggle can switch back.
5. Node clusters appear at low zoom.
6. Cluster role badges appear and do not crowd the screen.
7. Nodes appear at detail zoom.
8. Node labels appear and remain readable.
9. Routes appear only when intended.
10. Selected/analysis path stays visible.
11. Live packet comets animate.
12. Packet residue fades.
13. Observer bursts animate.
14. Message bubbles appear and expire.
15. 3D node models do not leak memory when toggled.
16. 3D route arcs do not leak geometry/materials when toggled.
17. 3D packet comets clean up after expiry.
18. Terrain heightmap/hillshade toggle does not throw MapLibre style errors.
19. Terrain LOS toggle either works or is visibly disabled until implemented.
20. Weather clouds toggle hides when no API key exists or shows a useful disabled state.

### Potential MapLibre style risk

The map code includes terrain/hillshade style expressions that must be verified in browser. MapLibre paint properties are strict. If any paint property uses an array that is not a valid expression, the whole map can error.

**Required action**

Run browser smoke with OpenFreeMap and terrain toggles enabled. If console shows a style validation error, fix the layer expression or disable the layer until valid.

### Layer settings UX improvements

Current layer settings expose many toggles in one list. That is powerful but overwhelming.

For 2.8.0, group controls:

#### Base

- Original / OpenFreeMap
- Dark / Light / System
- Terrain heightmap
- 3D buildings
- Weather clouds

#### Mesh

- Nodes
- Node labels
- Clusters
- Observers
- Routes
- Activity heatmap

#### Live motion

- Live packet comets
- Packet residue
- Observer bursts
- Message bubbles

#### 3D

- Node models
- Route arcs
- Packet comets

#### Analysis

- Analysis paths
- Terrain line-of-sight
- RF confidence overlay

Add preset buttons:

- `Balanced`
- `Performance Saver`
- `RF Analysis`
- `Presentation`
- `War Drive`
- `Mobile`

### Layer state feedback

A layer toggle should show state:

- enabled and visible
- enabled but no data
- enabled but unavailable
- disabled by render quality
- disabled because no API key
- disabled in current base mode
- failed to load

Do not leave users guessing why a toggle appears to do nothing.

## Packets panel audit

Strengths:

- API-backed fetch.
- AbortController cleanup.
- Refresh every 20 seconds.
- Search/region/payload/min-hop/message filters.
- Virtualized list.
- Packet focus/replay.
- Loaded/scanned/window/updated summary.

Needed fixes:

- Must handle API empty due projection fallback.
- Empty state should say whether the API returned zero, projection is warming, or filters are too strict.
- Show search mode in a public-safe way:
  - `indexed`
  - `fallback search`
  - `projection warming`
- Add route quality/confidence fields.
- Add copy fallback when Clipboard API fails.
- Add mobile compact filter drawer.
- Add “open on map” and “replay” buttons that remain thumb-friendly.
- Add row keyboard selection.

## Chat panel audit

Strengths:

- API-backed public chat.
- AbortController cleanup.
- Refresh every 20 seconds.
- Region/channel/search filters.
- Virtualized rows.
- Safe display helpers.

Needed fixes:

- Confirm `/api/v1/public/chat` returns messages from both `packet_observations` and `live_edge_events` as intended.
- Add “message route context” button that focuses the packet path when available.
- Add echo count/collapsed duplicates.
- Add public-channel badge and region badge.
- Add “load older” smoke.
- Add empty state that distinguishes:
  - no messages in time window
  - filters too strict
  - backend warming
  - API error

## NetGraph audit

Strengths:

- D3 force layout.
- Canvas rendering.
- Node/edge caps.
- Hidden-tab animation pause.
- Touch/pinch support.
- Search.
- Inspector.
- Live pulses/glows.
- Role legend.

Needed fixes:

- Assert canvas has nonzero CSS size and backing size.
- Add fallback if `ResizeObserver` is unavailable.
- Add fit/reset controls visible in the panel.
- Add render-quality presets.
- Add filters:
  - region
  - role
  - payload type
  - min packet count
  - active in last X
  - observer-only on/off
- Add graph density warning when capped.
- Add “show hidden due cap” count.
- Add mobile inspector bottom-sheet.
- Add selected edge “open route on map.”
- Add selected node “open map selection.”

## General UI/UX readiness

### Must fix before release

- No panel should open under top chrome or off-screen.
- Fullscreen panel must be full viewport on desktop and mobile.
- Side panel width must not cover all map actions on desktop unless user expands.
- Close buttons must have accessible labels.
- Escape key should close open modal/panel.
- Link bar active state must match hash route.
- Browser back/forward must open/close panels predictably.
- App should display “live/degraded/quiet/not live” status clearly.

### Mobile priorities

- 390px viewport is mandatory.
- Search/filter rows should wrap cleanly.
- NetGraph must not scroll-lock the whole page incorrectly.
- Packets and Chat lists need comfortable touch targets.
- Map settings drawer should become a full-screen sheet on mobile.
- Top actions should not overlap browser safe areas.

### Accessibility

Add tests/checks for:

- all icon buttons have labels/titles
- panels have `aria-label`
- lists use appropriate roles
- focus is not trapped accidentally
- keyboard can close panels
- reduced motion mode reduces packet/graph animation intensity

## Frontend acceptance criteria

Run:

```bash
cd web
npm ci
npm test -- --run
npm run build
npm run smoke:browser -- --base-url http://127.0.0.1:39476
```

Browser smoke must fail on:

- console error
- page error
- `.panel-error`
- missing panel
- panel outside viewport
- NetGraph canvas zero width/height
- stale service worker registration when disabled
- API response cached by service worker
- dynamic import failure
- MapLibre style error
