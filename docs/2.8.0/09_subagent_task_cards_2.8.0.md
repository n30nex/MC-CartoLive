# 09 — Sub-Agent Task Cards for 2.8.0

Use these task cards to parallelize the work with sub-agents. The release manager owns integration and final sign-off.

## Agent 1 — Release Manager / Merge Captain

### Mission

Coordinate the 2.8.0 release from `dev/deepseek-v4` to `main`.

### Tasks

- Confirm branch state.
- Keep the work on `dev/deepseek-v4` until green.
- Track P0/P1 blockers.
- Ensure all version metadata becomes `2.8.0`.
- Ensure no secrets or DB files are committed.
- Ensure each sub-agent writes tests.
- Run final full release gate.
- Prepare PR description.
- Coordinate merge and deploy.

### Acceptance

- `node scripts/check-version-sync.mjs` passes.
- PR includes all test evidence.
- No P0/P1 blockers remain.
- Final SHA is recorded.

## Agent 2 — Backend Database/API Agent

### Mission

Fix SQLite migrations, public Packets projection fallback, public APIs, and backend tests.

### Tasks

- Add idempotent migration helper.
- Add `nodes.supports_multibyte` migration.
- Verify all post-2.6 schema changes are migration-safe.
- Fix `/api/v1/public/packets` projection fallback.
- Verify `/api/v1/public/history` fallback/projection behavior.
- Add backend tests for old DBs and projection fallback.
- Verify public Chat filters/dedupe/search.
- Verify public privacy scanner covers new endpoints.
- Review `/metrics` for public safety.
- Review X-Forwarded-For trust behavior.

### Acceptance

```bash
cd backend
go test ./...
go tool govulncheck ./...
```

Must pass.

## Agent 3 — Frontend Panels Agent

### Mission

Fix Packets, Chat, NetGraph, lazy imports, and panel UX.

### Tasks

- Reproduce Packets failure.
- Reproduce Chat failure.
- Reproduce NetGraph failure.
- Fix panel runtime errors.
- Add lazy import retry/clear-cache/reload-once helper.
- Improve empty/loading/error states.
- Fix mobile layouts.
- Add tests for panel states.
- Ensure no `.panel-error`.
- Ensure browser back/forward works.

### Acceptance

Browser smoke passes:

```text
/#/packets
/#/chat
/#/netgraph
```

on desktop and mobile.

## Agent 4 — Service Worker / PWA Agent

### Mission

Make the live dashboard safe from stale cache and stale chunk failures.

### Tasks

- Disable service worker by default.
- Add `VITE_ENABLE_SERVICE_WORKER=false`.
- Add legacy service worker unregister/cache cleanup.
- Ensure no `/api/`, `/healthz`, `/readyz`, `/metrics`, `/ws` caching.
- Add stale upgrade browser test.
- Update docs.

### Acceptance

- No controlling service worker by default.
- Old `mc-cartolive-v1` cache is deleted.
- Old SW clients recover.
- APIs are never cached by SW.

## Agent 5 — Map/Layers/UI/UX Agent

### Mission

Verify and polish map/layer behavior for 2.8.0.

### Tasks

- Test original map.
- Test light/dark theme.
- Test OpenFreeMap.
- Test terrain/hillshade.
- Test weather clouds with/without key.
- Test layer toggles.
- Test 3D node/route/packet layers.
- Fix MapLibre style expression errors.
- Group map settings.
- Add layer availability states.
- Improve mobile settings drawer.
- Add layer presets if time allows.

### Acceptance

- No MapLibre console errors.
- Every layer toggle is either functional or clearly unavailable.
- Desktop/mobile map settings are usable.

## Agent 6 — QA / Browser Smoke Agent

### Mission

Make browser smoke a real release gate.

### Tasks

- Remove obsolete `perf` scenario.
- Add global console/page error capture.
- Add `.panel-error` failure.
- Add NetGraph canvas size assertion.
- Add service worker disabled assertion.
- Add stale service worker upgrade scenario.
- Add desktop and mobile scenarios.
- Save screenshots/artifacts.
- Document manual browser checklist.

### Acceptance

```bash
RUN_BROWSER_SMOKE=1 ./scripts/release-check.sh
```

Must pass and produce screenshots for each scenario.

## Agent 7 — Security / Privacy Agent

### Mission

Ensure 2.8.0 public release does not leak private data.

### Tasks

- Review public APIs.
- Review `/metrics`.
- Review browser state.
- Run privacy scanner.
- Run secret scan.
- Check no `.env`, DB, WAL, SHM, credentials, or backups are committed.
- Verify internal endpoints hidden in `PUBLIC_MODE=true`.
- Verify docs warn about secrets.

### Acceptance

- Secret scan passes.
- Public privacy scan passes.
- Manual API checks show no debug/private endpoints in public mode.

## Agent 8 — Docs / Deploy Agent

### Mission

Update documentation to 2.8.0 and make deployment safe.

### Tasks

- Update README to 2.8.0.
- Update CHANGELOG.
- Update production docs.
- Update development docs.
- Update roadmap/docs checked by version sync.
- Fix `scripts/deploy.sh`.
- Add deploy and rollback docs.
- Add post-deploy checklist.
- Verify Docker Compose port assumptions.

### Acceptance

- `node scripts/check-version-sync.mjs` passes.
- Deploy script dry-run/local run succeeds.
- Runbook is accurate for `carto.canadaverse.org`.

## Integration order

1. Backend DB migration fix.
2. Packets projection fallback fix.
3. Service worker disable/cleanup.
4. Panels fixed.
5. Map/layer UX fixed.
6. Browser smoke updated.
7. Deploy script fixed.
8. Version/docs bumped.
9. Full release gate.
10. PR and deploy.

## Daily standup format for sub-agents

Each sub-agent should report:

```markdown
### Agent name

Done:
- ...

Still broken:
- ...

Tests run:
- ...

Artifacts:
- ...

Risks:
- ...

Next:
- ...
```

## Final integrated sign-off

The release manager should produce:

```markdown
# MC-CartoLive 2.8.0 Final Sign-off

Branch:
SHA:
Version:
Date:

P0 status:
P1 status:

Tests:
- version sync:
- backend:
- govulncheck:
- frontend:
- build:
- docker:
- package smoke:
- privacy:
- browser desktop:
- browser mobile:
- manual browser:

Deploy:
- DB backup:
- healthz:
- readyz:
- public state:
- packets:
- chat:
- browser:

Decision:
- [ ] ready to merge
- [ ] ready to deploy
```
