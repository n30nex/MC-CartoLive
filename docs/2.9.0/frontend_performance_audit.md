# MC-CartoLive 2.9.0 Frontend Performance Audit

Date: 2026-06-12

## Scope

This audit reviewed the full project with frontend runtime performance as the primary focus. The review covered:

- React application state flow and render cadence.
- MapLibre source and layer update paths.
- Public API polling and WebSocket interaction.
- Bundle output and CSS loading behavior.
- Backend public-state shaping where it affects frontend load.
- Existing test and release validation gates.

No code changes were made as part of this audit.

## Validation Run

The following checks passed:

```text
cd web && npm run build
cd web && npm test -- --run
cd backend && go test ./...
node scripts/check-version-sync.mjs
```

Version sync result:

```text
version sync ok: 2.9.0
```

Frontend build highlights:

```text
maplibre JS: 1052.97 kB raw / 284.56 kB gzip
three JS:     516.04 kB raw / 130.06 kB gzip
index JS:     292.38 kB raw / 103.44 kB gzip
index CSS:    130.65 kB raw / 21.79 kB gzip
```

## Findings

### 1. Full Public-State Polling Continues While WebSocket Is Live

Severity: High

Relevant files:

- `web/src/App.tsx`
- `web/src/api.ts`
- `backend/internal/live/public_cache.go`
- `backend/internal/api/routes.go`

The frontend continues polling `/api/v1/public/state` every 15 seconds even when the public WebSocket is live. Each poll fetches and sanitizes the full public state, then resets application state with `initialAppState(...)`.

This is expensive because the public state can include thousands of nodes and routes plus recent pulses and activity. Even with backend cache limits and ETag headers, the frontend still pays avoidable state reconciliation, object allocation, derived-data recomputation, and map update pressure.

Recommendation:

- Stop routine full-state polling while the WebSocket is healthy.
- Reconcile full state on reconnect, page visibility resume, stale socket detection, or a much slower health interval.
- Avoid replacing the whole app state unless the snapshot changed materially.
- Consider explicit ETag-aware fetch handling if full-state reconciliation remains necessary.

Expected impact:

- Lower network traffic during live sessions.
- Less repeated JSON parse/sanitize work.
- Fewer broad React and MapLibre update cascades.

### 2. Route Pulse Handling Rebuilds And Sorts The Full Route Set

Severity: High

Relevant files:

- `web/src/state.ts`
- `web/src/map/routeSource.ts`
- `web/src/map/CanadaMap.tsx`

Each `routePulse` update currently rebuilds route structures by copying route data into a map, applying pulse updates, normalizing route buckets, and sorting the full route array.

This makes live traffic bursts disproportionately expensive. With route caps in the thousands, per-pulse O(routes) or O(routes log routes) work becomes a major runtime cost before MapLibre rendering is considered.

Recommendation:

- Store route state in an indexed structure that supports incremental updates.
- Update only routes touched by the incoming pulse.
- Recompute frequency buckets on a throttled cadence or only when bucket thresholds change.
- Keep stable route array identity when render-relevant route fields have not changed.

Expected impact:

- Lower CPU cost during packet bursts.
- Smoother map animation and interaction under live traffic.
- Reduced downstream MapLibre source invalidation.

### 3. Activity Heatmap Source Rebuilds Too Often

Severity: High

Relevant files:

- `web/src/map/CanadaMap.tsx`
- `web/src/map/activityHeatmap.ts`
- `web/src/mapSettings.ts`

The activity heatmap source can be rebuilt every two seconds through the node-label freshness clock, and every 250 milliseconds during activity glow updates. The builder filters, scores, sorts, and slices node data before calling MapLibre source updates.

This is avoidable work, especially when the heatmap layer is disabled or when label freshness is the only reason the effect ran.

Recommendation:

- Gate heatmap source rebuilding behind `layerSettings.activityHeatmap`.
- Decouple node-label refresh from heatmap refresh.
- Maintain a small active-node heatmap index instead of rescanning and sorting all nodes.
- Limit high-frequency heatmap updates to visible and recent activity only.

Expected impact:

- Reduced CPU use during normal map viewing.
- Lower MapLibre `setData` frequency.
- Less frame-time pressure during live activity.

### 4. Global One-Second Clock Drives Broad Recalculation

Severity: Medium

Relevant files:

- `web/src/App.tsx`
- `web/src/state.ts`

The top-level application clock updates every second and feeds activity summaries, route summaries, and hot-route sorting. This causes broad derived-data recomputation even when only time display text needs to change.

Recommendation:

- Move ticking clock display into smaller leaf components.
- Bucket route and activity summaries to a 5-10 second cadence.
- Compute hot routes only when the relevant panel is visible.
- Prefer event-driven recomputation when route traces or activity inputs change.

Expected impact:

- Fewer top-level React renders.
- Less repeated sorting and summarization.
- Better idle behavior on the default map view.

### 5. VCR Summary Polling Runs While The VCR Is Closed

Severity: Medium

Relevant files:

- `web/src/App.tsx`
- `backend/internal/store/history.go`
- `backend/internal/api/routes.go`

The history/VCR summary is polled every 30 seconds even when the VCR UI is closed. This adds periodic network traffic and top-level state updates to the default map experience.

Recommendation:

- Load the summary when the VCR is opened.
- Refresh while the VCR is open.
- Keep a stale cached summary for closed-state display if needed.

Expected impact:

- Less background work on the first-view map.
- Lower backend query pressure from idle clients.

### 6. Lazy JavaScript Panels Still Pay Eager CSS Cost

Severity: Medium

Relevant files:

- `web/src/styles.css`
- `web/src/styles/chat.css`
- `web/src/styles/netgraph.css`

The project lazy-loads several JavaScript panels, but panel CSS is imported through the main stylesheet. This means first load still pays CSS parse and transfer cost for panels that may not be opened.

There also appears to be duplicated chat styling between the global stylesheet and the dedicated chat stylesheet.

Recommendation:

- Keep first-load CSS focused on the map shell and common controls.
- Move panel-specific CSS closer to lazy panel boundaries where practical.
- Remove duplicated chat and panel selectors.
- Add a CSS size budget to release validation.

Expected impact:

- Smaller initial CSS payload.
- Faster style parsing.
- Cleaner long-term UI maintenance.

### 7. Static Asset Compression Is Runtime Gzip Only

Severity: Low

Relevant files:

- `backend/internal/api/static.go`
- `backend/internal/api/routes.go`

Hashed frontend assets have appropriate immutable cache headers, but compression is currently handled by generic runtime gzip middleware. There is no precompressed Brotli or gzip static asset serving path.

Recommendation:

- Generate `.br` and `.gz` assets during frontend/package build.
- Serve precompressed assets based on `Accept-Encoding`.
- Avoid compressing already-compressed or very small responses.

Expected impact:

- Lower CPU cost on the backend for static assets.
- Smaller transfer size for modern browsers with Brotli support.

## Existing Strengths

The project already has several good performance foundations:

- Vite manual chunking separates major dependencies.
- MapLibre and Three.js are split from the main app bundle.
- 3D terrain code is lazy-loaded.
- GIF export dependencies are lazy-loaded.
- Map source updates are queued through `requestAnimationFrame`.
- Chat and packet panels use virtualization.
- NetGraph and PacketAnimator include explicit render budgets.
- Backend public cache limits snapshot size.
- Hashed static frontend assets use immutable cache headers.

These should be preserved while addressing the higher-cost runtime paths above.

## Recommended Performance Roadmap

### Phase 1: Reduce Live-State Churn

- Disable routine full public-state polling while WebSocket is healthy.
- Reconcile full state only on reconnect, stale socket, visibility resume, or explicit refresh.
- Make `routePulse` reducer updates incremental.
- Add unit tests for unchanged object identity when irrelevant live events arrive.

Primary files:

- `web/src/App.tsx`
- `web/src/state.ts`
- `web/src/api.ts`

### Phase 2: Reduce Map Source Churn

- Gate heatmap work when the heatmap layer is off.
- Decouple node-label freshness from heatmap source refresh.
- Throttle or index heatmap updates.
- Track MapLibre `setData` call counts during development.

Primary files:

- `web/src/map/CanadaMap.tsx`
- `web/src/map/activityHeatmap.ts`
- `web/src/map/sourceDataQueue.ts`

### Phase 3: Reduce Broad React Re-Renders

- Move one-second clock updates into leaf components.
- Bucket activity summaries to longer intervals.
- Compute hot routes and expensive panel summaries only when visible.
- Review `App.tsx` derived state for visibility-gated memoization.

Primary files:

- `web/src/App.tsx`
- `web/src/components/*`
- `web/src/state.ts`

### Phase 4: Improve First-Load CSS And Assets

- Split or defer non-critical panel CSS.
- Remove duplicate chat styles.
- Add CSS and bundle budgets to validation.
- Add precompressed Brotli/gzip static asset support.

Primary files:

- `web/src/styles.css`
- `web/src/styles/*`
- `web/vite.config.ts`
- `backend/internal/api/static.go`

### Phase 5: Add Performance Instrumentation

Track the following in development builds or an internal diagnostics mode:

- Public-state snapshot size.
- WebSocket event rate.
- Route-pulse reducer duration.
- MapLibre source `setData` frequency.
- Long tasks over 50 milliseconds.
- Initial render and map-ready timings.
- Main bundle, CSS, and vendor chunk sizes.

These metrics should become release-gate evidence for future frontend-heavy releases.

## Summary

The largest frontend performance gains are likely to come from reducing repeated live-state reconciliation, making route pulse updates incremental, and cutting unnecessary MapLibre source rebuilds. Bundle splitting is already reasonably mature; the more important current issue is runtime churn after the app is loaded.

Recommended priority:

1. Stop full-state polling during healthy WebSocket sessions.
2. Make route pulse updates incremental.
3. Gate and throttle activity heatmap source updates.
4. Move global clock work out of the top-level app render path.
5. Split first-load CSS and add size budgets.
