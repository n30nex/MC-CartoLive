# MC-CartoLive 2.7.5 to 2.7.7 Roadmap

Last audited: 2026-06-09

Baseline audited: `v2.7.7` is the system-theme, elevation-profile, and
infrastructure-hardening release. Adds OS theme auto-detection, PWA service
worker, node freshness indicators, route elevation profile charts, backend
panic guards, resolver/meshcore unit tests, and CI linting/vuln scanning.

## 2.7.6 Patch Focus

- Observer map labels with viewport-aligned naming for positioned observers.
- 3D building extrusions on the original/flat map mode.
- Weather cloud overlay layer.
- Space-key input guard to prevent accidental map interactions.
- Layer event refresh on theme switch so map layers stay current.
- Message bubble deduplication anchored to first reporting observer.
- Light-mode observer label contrast improvements.
- Label jitter fix on camera move.
- CARTO basemap tile CSP img-src and connect-src fix.
- Port 80 mapping restore for Cloudflare origin connectivity.
- Solar snapshots included in prune tables.
- Observer error resilience on resolver failures.
- End-to-end audit: rate limiter shutdown, dead code removal, deploy rollback
  hardening, version sync, Makefile bump-version fix, dependency grouping.

## 2.7.7 Delivered

- System theme auto-detection: `system` mode follows OS dark/light preference
  via `prefers-color-scheme` with live switching on preference change.
- PWA support: service worker with cache-first app shell and network-first map
  tile strategies, web app manifest, Apple mobile web app meta tags.
- Node freshness indicators: active nodes (heard <5 min) show green pulse ring;
  opacity tiers indicate recency (fresh/medium/stale/never).
- Route elevation profile: SVG-based elevation chart in SelectionDrawer showing
  terrain profile (min, max, gain, loss) along selected routes, sampled from
  terrain RGB tiles using terrarium encoding.
- Backend hardening: WebSocket broadcast panic recovery via `defer/recover`,
  rate limiter cleanup goroutine properly stopped during shutdown, MQTT message
  handler shutdown context fixed.
- Test expansion: 34 meshcore decoder unit tests covering ParsePacket,
  ParseHexPacket, ParseAdvertPayload, chunkPath, DecodePublicMessage; 8 resolver
  unit tests covering single/multiple/collision/zero/non-forwarder/duplicate
  scenarios plus distance gate; 1 elevation profile test module.
- Infrastructure: added `VITE_OPENWEATHERMAP_API_KEY` Dockerfile build arg,
  golangci-lint config, ESLint/Prettier configs, `npm audit` and `govulncheck`
  CI steps, Makefile `lint`/`clean` targets with `--pull` on builds.
- Frontend fixes: ErrorBoundary wrapping entire app, CSP meta tag,
  `observerBurstLastAtByLocation` periodic pruning (10s interval), duplicate
  CSS merge, `role` type tightened to `NodeRole` union.
- Version bump from 2.7.6 to 2.7.7 across all config files and docs.

## 2.7.6 Patch Focus
