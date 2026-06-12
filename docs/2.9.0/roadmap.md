# MC-CartoLive 2.9.0 UX Roadmap

## Summary

2.9.0 is the no-public-API-change UX release for live map visitors. It ships as
a patch ladder from the `2.8.2` baseline, with each 2.8.x patch deployable on
its own, Browser-smoked on desktop and mobile, and documented before the next
patch begins.

The guiding product goal is to make MC-CartoLive feel like one coherent live
operations workspace: the map, controls, replay tools, and panels should work
together cleanly on desktop and mobile without exposing additional public data.

## Release Ladder

### 2.8.3 Map Chrome Stabilization

- Audit desktop and mobile chrome: top links, bottom dock, status bar, search,
  legend, VCR, map settings, and panel stacking.
- Fix overlapping controls, unreachable buttons, poor safe-area behavior, and
  inconsistent sheet behavior.
- Add tests for chrome visibility, panel anchoring, bottom dock behavior, and
  no-horizontal-overflow mobile rules.

### 2.8.4 Layer And Settings UX

- Redesign Map Settings into clearer groups: Base, Live, Routes, Analysis, and
  Visuals.
- Add frontend-only layer presets: `Live`, `Clean`, `Analysis`, and `3D`.
- Keep first-load defaults quiet: terrain, propagation, and Known Pathways stay
  off unless explicitly enabled.
- Preserve existing user preferences through local settings migrations.

### 2.8.5 Selection And Route Understanding

- Polish node, route, packet, and propagation selection flows so focus, replay,
  copy, and history actions feel consistent.
- Improve SelectionDrawer hierarchy: route summary, endpoint labels, recent
  activity, packet replay actions, and path-copy affordances.
- Make VCR and replay state visible without crowding the map.
- Keep all displayed route detail public-safe and sourced from existing
  sanitized state.

### 2.8.6 Panels Workspace Polish

- Unify Packets, Chat, NetGraph, NodeList, and Propagation panel chrome:
  headers, search/filter patterns, loading/error/empty states, and
  fullscreen/docked controls.
- Improve mobile panel ergonomics with full-height sheets, predictable close
  behavior, and stable scroll areas.
- Keep Chat and Packets schema-compatible with existing public endpoints.

### 2.8.7 Visitor Onboarding And Help

- Add lightweight in-app orientation for first-time visitors: live comets,
  trails, nodes, panels, and Known Pathways.
- Improve ShortcutHelp and Changelog so users can discover controls without
  crowding the map.
- Keep onboarding local-only and dismissible; no accounts, no telemetry, and no
  backend schema changes.

### 2.8.8 Visual QA And Performance Pass

- Tighten typography, spacing, contrast, panel density, dark/light palette
  consistency, and motion-reduction behavior.
- Add screenshot/browser-smoke coverage for desktop `1920x1080`, laptop-ish
  widths, mobile `390x844`, and a narrow mobile edge case.
- Keep practical UI performance budgets: no blank map/canvas, bounded source
  rebuilds, and no hidden-tab animation regressions.

### 2.9.0 UX Rollup

- Freeze feature work and update docs, changelog, roadmap, release notes, and
  validation evidence.
- Run full release gates, Podman package smoke, Codex in-app Browser smoke,
  privacy scans, and live droplet smoke.
- Publish 2.9.0 as the stable visitor-facing UX baseline.
- Keep 2.9.0 API-compatible with 2.8.x public clients.

## Public Interfaces

- Do not change public backend API response shapes before 2.9.0.
- Do not add public DB/schema-dependent feature work unless it is fully
  internal and invisible to public responses.
- Allowed interface changes:
  - frontend-only `localStorage` settings schema migrations
  - UI labels, layouts, controls, panels, and visual defaults
  - additive docs and release-check/browser-smoke coverage

## Test And Release Gates

Every patch from 2.8.3 through 2.9.0 must pass:

- `cd backend && go test ./...`
- `cd web && npm test -- --run`
- `cd web && npm run build`
- `node scripts/check-version-sync.mjs`
- Podman image/package smoke for release candidates.
- Local public privacy scan.
- Codex in-app Browser smoke, not local Playwright on this host:
  - desktop map first view
  - mobile `390x844`
  - map settings/layer controls
  - the primary panel or workflow for that milestone
  - no `.panel-error`, console errors, broken chunks, blank map/canvas, or
    overlapping critical controls
- Post-deploy live smoke and deployed privacy scan for every deployed patch.

## Assumptions

- Live map visitors are the primary audience for this release train.
- Map and panels are the highest-priority UX surface.
- The roadmap intentionally avoids public API changes until after 2.9.0.
- Patch releases should remain small enough to ship, test, push to `main`, and
  deploy independently.
- Podman remains the local container runtime; the droplet can keep its current
  Docker Compose runtime.
