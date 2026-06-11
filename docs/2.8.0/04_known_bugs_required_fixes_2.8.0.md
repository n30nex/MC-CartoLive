# 04 — Known Bugs and Required Fixes for 2.8.0

This is the release blocker tracker. Codex xhigh should not close the work until every P0/P1 item has a code fix and a test or browser-smoke proof.

## Priority definitions

- **P0:** release blocker. No merge, no deploy.
- **P1:** production readiness blocker. Should be fixed before release unless explicitly deferred with owner approval.
- **P2:** important improvement, can ship shortly after 2.8.0 if all P0/P1 are green.
- **P3:** backlog/nice-to-have.

## P0 bugs

| ID | Bug | Evidence | Impact | Required fix | Acceptance test |
|---|---|---|---|---|---|
| P0-001 | Packets page broken | User report. Source also shows Packets depends on `/api/v1/public/packets` and lazy chunk. | Major advertised feature unusable. | Fix API fallback, service worker/chunk caching, panel runtime errors, and layout. | `/#/packets` passes desktop/mobile browser smoke with no console/page errors and no `.panel-error`. |
| P0-002 | Chat page broken | User report. Source shows Chat lazy panel and `/api/v1/public/chat`. | Public messages unusable. | Fix API, panel runtime errors, dedupe/filter edge cases, service worker stale cache. | `/#/chat` passes desktop/mobile browser smoke and API returns valid response. |
| P0-003 | NetGraph page broken | User report. Source shows NetGraph lazy panel and canvas/ResizeObserver. | Topology view unusable. | Fix canvas sizing, layout, lazy chunk/service worker, runtime errors. | `/#/netgraph` passes desktop/mobile smoke; canvas width/height > 0. |
| P0-004 | Unsafe service worker cache | `main.tsx` registers SW unconditionally; `sw.js` cache-firsts non-tile requests. | Stale API, stale app shell, stale chunks, broken panels after deploy. | Disable by default and unregister legacy SW/cache; or implement safe network-first policy. | Browser smoke verifies no SW controls page by default and APIs are not cached. |
| P0-005 | Public Packets projection can hide valid packets | `publicPackets()` returns after projection; projection writes empty JSON and returns true. | Packets page can show empty/broken after upgrade. | Gate projection on completeness or fallback when projection incomplete/empty. | Test with live events and empty projection returns packets via legacy fallback. |
| P0-006 | Missing `nodes.supports_multibyte` migration | Schema and node code use column; `Migrate()` does not add it. | Existing production DB can fail with missing column. | Idempotent migration helper and tests. | Old-schema DB migrates and node/public state functions pass. |
| P0-007 | Deploy script checks wrong host port | Compose maps host `80` and `39476`; script checks `127.0.0.1:8080`. | Healthy deploy can false-fail/rollback. | Use `127.0.0.1:39476/readyz` or container exec check. | Dry-run deploy script health succeeds against local Compose. |
| P0-008 | Deploy script defaults wrong branch | Script defaults `dev`, target branch is `dev/deepseek-v4` pre-merge or `main` post-merge. | Wrong code may deploy. | Parameterize branch, default appropriately, print SHA. | Script logs intended branch and SHA before deploy. |
| P0-009 | Deploy script backs up only DB main file | SQLite WAL mode can require WAL/SHM or `.backup`. | Backup/rollback can corrupt or lose data. | Use `sqlite3 .backup`; fallback copies `meshcore-live.db*` only with app stopped. | Backup file is valid SQLite and restore rehearsal passes. |
| P0-010 | Version drift | Dev version is 2.7.7 but Dockerfile defaults 2.7.6; target is 2.8.0. | Wrong image/version docs, failed sync, confusing deploy. | Bump all release metadata. | `node scripts/check-version-sync.mjs` passes. |
| P0-011 | Browser smoke obsolete Perf scenario | Smoke expects `#/perf`; app redirects `#/perf` away. | False CI failure or hidden real page failures. | Remove/replace perf scenario and strengthen Packets/Chat/NetGraph checks. | Browser smoke passes and includes all real pages. |
| P0-012 | Service-worker upgrade path missing | Existing users may already have old `mc-cartolive-v1` cache. | Even after code fix, old clients can stay broken. | One-time unregister/delete legacy caches in 2.8.0. | Browser smoke installs old SW then loads new build and panels open. |

## P1 production readiness bugs

| ID | Bug | Impact | Required fix | Acceptance test |
|---|---|---|---|---|
| P1-001 | CI does not run on pushes to `dev/deepseek-v4` | Broken dev pushes can accumulate. | Add dev branch to CI triggers or require PR into dev. | Push/PR triggers backend/frontend/docker/secret jobs. |
| P1-002 | Lint tooling incomplete | Added configs may not actually run. | Add ESLint/Prettier deps/scripts or remove misleading config. | `npm run lint` passes in CI. |
| P1-003 | Public rate limiter trusts `X-Forwarded-For` unconditionally | Direct clients can spoof IP rate limits. | Add `TRUST_PROXY_HEADERS` config. | Unit test for trusted/untrusted proxy. |
| P1-004 | MapLibre style validation risk | Invalid layer paint expression can break map. | Browser-test original/OpenFreeMap/terrain/weather toggles and fix invalid expressions. | No MapLibre console errors in smoke. |
| P1-005 | `ResizeObserver` assumed in NetGraph | Can fail in tests/older browsers. | Guard or polyfill fallback to window resize. | NetGraph unit/smoke works when ResizeObserver is undefined. |
| P1-006 | Weather clouds default enabled with no key | Users may toggle a layer that cannot load. | Disable/hide unavailable layer or show “API key required.” | No network/console errors when no weather key. |
| P1-007 | Clipboard copy assumes permissions in some areas | Copy may silently fail. | Add fallback copy method and visible status. | Clipboard-denied browser test still shows copyable text/status. |
| P1-008 | Readiness failure messages not operator-friendly | Deploy failure triage slower. | Print structured readiness fields and container logs. | Failed deploy prints db/cache/static/mqtt status. |
| P1-009 | Public projection FTS/index migration incomplete risk | Search may silently degrade or error after upgrade. | Verify projection table, FTS table, triggers, and backfill in migration tests. | Search returns same expected packet via FTS and fallback. |
| P1-010 | Browser smoke does not assert no `.panel-error` globally | Panels can render fallback but scenario still passes. | Add global `.panel-error` check after each scenario. | Inject panel error in test fixture; smoke fails. |
| P1-011 | Layer toggles not grouped or stateful | UX confusion. | Group layers and show availability state. | Manual UX review on desktop/mobile. |
| P1-012 | Large NetGraph cap hidden from users | Users may trust incomplete graph. | Show capped node/edge counts. | Fixture with cap shows warning/counts. |

## P2 improvements

| ID | Improvement | Why |
|---|---|---|
| P2-001 | Public diagnostics page | Operators need safe runtime insight without SSH. |
| P2-002 | Observer quality score | Helps identify bad/stale observers and MQTT-only noise. |
| P2-003 | RF confidence overlay | Makes the RF-only truth model understandable. |
| P2-004 | SNR/RSSI heatmap | Strong visual analysis feature for MeshCore Canada. |
| P2-005 | Route inspector | Show hops, distance, last heard, confidence, payload mix, observers. |
| P2-006 | Packet replay from Chat | Click a message to see its route path. |
| P2-007 | NetGraph map focus integration | Select graph edge/node and focus map. |
| P2-008 | Map presets | Balanced, Performance Saver, RF Analysis, Presentation, War Drive. |
| P2-009 | API docs | Document public response schemas and privacy rules. |
| P2-010 | Performance benchmark script | Track regression p50/p95 over releases. |

## Global bug-fix instructions for Codex

For every bug fixed:

1. Reproduce it first.
2. Write down the failure mode in the PR notes.
3. Apply the smallest safe fix.
4. Add a regression test or browser-smoke assertion.
5. Re-run the relevant gate.
6. Do not mark fixed until the test fails before the fix and passes after the fix, where practical.

## Bugs that require manual/browser confirmation

These cannot be closed by unit tests alone:

- Packets page opens and works.
- Chat page opens and works.
- NetGraph opens and works.
- Map layer toggles work.
- OpenFreeMap loads and can switch back.
- Mobile layout works at 390px.
- Existing stale service worker clients recover.
- Live droplet reverse proxy does not cache API responses.
- `carto.canadaverse.org` deploy works with production `.env`.

## Minimum bug-fix PR checklist

```markdown
- [ ] P0 bugs fixed
- [ ] P1 bugs fixed or explicitly deferred
- [ ] Version sync passed
- [ ] Backend tests passed
- [ ] Govulncheck passed
- [ ] Frontend tests passed
- [ ] Frontend build passed
- [ ] Container build passed
- [ ] Package smoke passed
- [ ] Public privacy scan passed
- [ ] Browser smoke passed desktop
- [ ] Browser smoke passed mobile
- [ ] Manual browser verification complete
- [ ] Deploy runbook tested locally
- [ ] Changelog updated
- [ ] Docs updated to 2.8.0
- [ ] No secrets committed
```
