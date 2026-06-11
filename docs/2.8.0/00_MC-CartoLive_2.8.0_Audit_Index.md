# MC-CartoLive 2.8.0 Production Merge Audit Bundle

**Repository:** `n30nex/MC-CartoLive`
**Main branch audited:** `main`
**Dev branch audited:** `dev/deepseek-v4`
**Target release:** `2.8.0`
**Release name:** Production Ready / World Release 2 / Canada Release
**Production host:** `carto.canadaverse.org`
**Prepared:** 2026-06-10

## What this bundle is for

This bundle is a handoff package for GPT 5.5 Codex xhigh or an equivalent senior coding agent. The goal is to turn `dev/deepseek-v4` into the final 2.8.0 production PR, merge the new dev features and performance gains into `main`, update all documentation to 2.8.0, run full local/browser testing, and deploy the live Canada release to `carto.canadaverse.org`.

The audit is intentionally strict. `dev/deepseek-v4` contains valuable new features, but the branch must not be merged or deployed until the release blockers are fixed and browser-tested.

## Important limitation

This is a source-level audit using the GitHub repository contents and prior generated audit context. The execution sandbox could not clone GitHub directly or run the app in a browser. Treat every item marked **needs runtime confirmation** as a mandatory local/browser validation task for Codex xhigh before closing the PR.

## Branch state

At audit time:

- `main` is the public production baseline at `2.6.3`.
- `dev/deepseek-v4` reports `2.7.7`.
- GitHub branch comparison showed `dev/deepseek-v4` is ahead of `main` and not behind it.
- The dev branch contains the desired 2.7.x feature line: Packets Explorer, Chat, NetGraph, OpenFreeMap/3D route arcs/models/comets, VCR replay, GIF export, map layers, theme/palette controls, service worker/PWA work, elevation/terrain work, runtime counters, packet projection/backfill work, package smoke, privacy scanning, and CI improvements.
- The user reports that Packets, NetGraph, and Chat are broken on the dev branch. This report is treated as true until browser smoke proves otherwise.

## Release decision

**Do not merge `dev/deepseek-v4` directly into `main` yet.**

The correct path is:

1. Stabilize `dev/deepseek-v4`.
2. Fix all P0/P1 blockers.
3. Bump all release metadata to `2.8.0`.
4. Run full backend, frontend, package, privacy, and browser smoke checks.
5. Open the final PR from `dev/deepseek-v4` to `main`.
6. Merge only after the browser confirms every page works.
7. Deploy to `carto.canadaverse.org`.
8. Run live droplet smoke checks and manual browser checks.

## Bundle files

| File | Purpose |
|---|---|
| `01_branch_diff_merge_strategy_2.8.0.md` | How to merge dev to main safely and what belongs in 2.8.0. |
| `02_backend_database_api_audit_2.8.0.md` | Backend, SQLite, API, MQTT, projection, public-safety, and performance audit. |
| `03_frontend_uiux_maps_layers_audit_2.8.0.md` | Frontend, broken pages, UI/UX, maps, layers, OpenFreeMap, NetGraph, Packets, Chat audit. |
| `04_known_bugs_required_fixes_2.8.0.md` | Bug tracker with required fixes, evidence, and acceptance tests. |
| `05_testing_local_browser_acceptance_2.8.0.md` | Local container, browser, service-worker, privacy, and live acceptance gate. |
| `06_production_deploy_runbook_carto_2.8.0.md` | Safe droplet deployment and rollback procedure for `carto.canadaverse.org`. |
| `07_new_features_world_release_2_backlog.md` | New feature/enhancement plan beyond the current code. |
| `master_plan.md` | Copy-paste goal prompt and completion status for GPT 5.5 Codex xhigh. |
| `09_subagent_task_cards_2.8.0.md` | Sub-agent task breakdown for parallel work. |
| `10_release_completion_evidence_2.8.0.md` | Local release-gate evidence and post-deploy evidence record. |

## Non-negotiable release rules

- Keep `PUBLIC_MODE=true` on the public host.
- Do not expose raw packet hex, raw payload hex, channel secrets, MQTT credentials, private keys, full public keys, live DB files, WAL/SHM files, or operator config.
- Preserve RF-only route truth. Do not draw MQTT-only fake RF links.
- Fix Packets, Chat, and NetGraph before any merge or deployment.
- Disable or harden the service worker before any live deployment.
- Add schema-safe migrations for old production databases.
- Back up SQLite safely before deployment.
- Run browser smoke in desktop and mobile.
- Do not deploy unless all pages open without console errors, page errors, stale service-worker failures, or `.panel-error`.

## Highest priority blockers

1. Broken Packets / NetGraph / Chat pages.
2. Unsafe cache-first service worker.
3. Public Packets projection can hide valid legacy edge events.
4. Missing DB migration for `nodes.supports_multibyte`.
5. Deploy script uses the wrong default branch, wrong health-check port, and unsafe DB backup.
6. Version drift between `VERSION`, Dockerfile, Compose, docs, and package files.
7. Browser smoke still contains obsolete `#/perf` scenario.
8. CI does not run on pushes to `dev/deepseek-v4`.
9. Lint tooling is incomplete.
10. Map layer style and toggle behavior must be browser-verified in both original and OpenFreeMap modes.

## Definition of done for 2.8.0

2.8.0 is done only when all of the following are true:

- `node scripts/check-version-sync.mjs` passes for `2.8.0`.
- `cd backend && go test ./...` passes.
- `cd backend && go tool govulncheck ./...` passes.
- `cd web && npm ci && npm test -- --run && npm run build` passes.
- Container build passes.
- Package smoke passes.
- Public privacy scan passes.
- Browser smoke passes for desktop `1920x1080` and mobile `390x844`.
- Manual browser checks pass for:
  - `/`
  - `#/setup`
  - `#/packets`
  - `#/chat`
  - `#/netgraph`
  - map settings drawer
  - original map mode
  - OpenFreeMap/3D mode
  - layer toggles
  - VCR replay
  - packet replay/focus
  - GIF export if a packet is selectable
- No console errors.
- No page errors.
- No `.panel-error`.
- No stale service worker behavior.
- Live `carto.canadaverse.org` health/readiness/API/browser smoke passes after deploy.
