# MC-CartoLive 2.9.1 Validation Checklist

## Frontend

- [x] Healthy WebSocket sessions do not schedule routine full-state polling.
- [x] Fallback polling remains available when the socket is not live.
- [x] Route pulses preserve untouched route object identity when global bucket
  normalization is not needed.
- [x] Activity heatmap source work is skipped when the heatmap layer is hidden.
- [x] Visible activity heatmap refreshes are throttled.
- [x] Busy Pathways route activity summaries and sorting are skipped while the
  panel is hidden.
- [x] VCR history summary polling only runs while the VCR is open.
- [x] In-app release highlights identify 2.9.1 as the performance patch.
- [x] Mobile bottom controls reserve space for drawers, route export actions,
  MapLibre controls, and Replay access without stacking on top of each other.
- [x] Workspace panels suppress floating map chrome while PacketTV suppresses
  the bottom action dock.
- [x] Public WebSocket client recovers when construction or ping sends fail.
- [x] Backend gzip middleware skips already-compressed static assets.
- [x] Live hub drop accounting stays safe under overlapping broadcasts.

## Release Gates

- [x] `cd backend && go test ./...`
- [x] `cd web && npm test -- --run`
- [x] `cd web && npm run build`
- [x] `node scripts/check-version-sync.mjs`
- [x] `node scripts/check-public-privacy.mjs http://127.0.0.1:39476`
- [x] `podman build --format docker -t mc-cartolive-meshcore-live-map:2.9.1 .`
- [x] Podman package smoke.
- [ ] Codex in-app Browser desktop and mobile smoke.
- [ ] Local Chrome agent-control smoke.

## Local Evidence

- Focused frontend tests passed for state reducer, activity heatmap helpers,
  node label helpers, and performance diagnostics.
- Full frontend Vitest suite passed after PR #5 integration: 58 files, 254
  tests.
- Full backend Go test suite passed.
- Production frontend build passed after the performance patch and PR #5
  integration.
- Focused overlap patch validation passed with
  `cd web && npm test -- --run src/components/VisitorGuide.test.tsx src/components/LinkBar.test.tsx src/state.test.ts`.
- Focused PR #5/non-UI validation passed with
  `cd web && npm test -- --run src/ws.test.ts src/components/LinkBar.test.tsx src/components/VisitorGuide.test.tsx src/state.test.ts`.
- Focused backend validation passed with
  `cd backend && go test ./internal/api ./internal/live`.
- Version sync passed for `2.9.1`.
- Podman image build passed for `mc-cartolive-meshcore-live-map:2.9.1`.
- Podman package smoke passed for synthetic and world fixtures, including
  public privacy scans.
- Local public privacy scan passed at `http://127.0.0.1:39476`.
- Local API/WebSocket smoke against the final 2.9.1 container reported ready
  state, public state/history/packets/chat data, and WebSocket hello.
- Local static asset smoke confirmed PNG assets keep immutable caching without
  gzip content encoding.
- Codex in-app Browser smoke is still pending. The browser bridge failed twice
  during setup with the local Windows sandbox error before loading the page.
- Local Chrome agent-control mode was enabled, but smoke is blocked until the
  Codex Chrome Extension is installed/enabled in the selected Chrome profile.
  Chrome is installed and running, and the native host manifest check passed.

## Deployment

- [ ] `main` pushed to GitHub.
- [ ] 2.9.1 deployed to the droplet.
- [ ] Live smoke run against `https://carto.canadaverse.org`.
- [ ] Deployed public privacy scan passed.
