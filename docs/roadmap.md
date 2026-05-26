# MC-CartoLive Roadmap

This document tracks the active release focus. Completed release details belong
in `CHANGELOG.md`; operator procedures belong in `docs/operator-runbook.md`.

## Current Baseline

Version `2.5.1` is the current production baseline.

- Public map behavior remains stable while package installs support
  worldwide/private brokers through configurable region labels and map bounds.
- Mobile layout, Packets browsing, VCR controls, packet replay, and low-zoom
  comet visibility are the current patch focus.
- Public packet/path data remains sanitized and schema-compatible.
- The supported runtime is the main Docker Compose service or the published
  GHCR image. OpenFreeMap is an in-app map toggle, not a separate stack.
- Release readiness is verified with backend tests, frontend tests/build, Docker
  build, packaged-image smoke, live smoke, and privacy checks.

## Active Maintenance Focus

- Keep packet ingest, public cache, WebSocket fanout, public history, and public
  packet paths observable through public-safe health/readiness counters.
- Keep the Packets page server-backed, cursor-stable, and bounded under rare
  filters or large 24h windows.
- Keep NetGraph frontend-only, smooth, and privacy-safe while it renders live
  connected public routes from existing state and WebSocket events.
- Keep OpenFreeMap 3D frontend-only, smooth, and optional: the true 3D layer is
  a visual overlay over the existing 2D map sources, not a new public data API.
- Keep map rendering smooth on modest clients by avoiding unnecessary source
  rebuilds, duplicate replay schedulers, and hidden-tab animation work.
- Keep production deployment repeatable through release, smoke, soak, and
  operator diagnostic scripts.
- Keep docs concise enough that new operators can deploy, smoke test, diagnose,
  back up, restore, and upgrade without reading historical planning notes.

## 2.5.1 Patch Focus

- Keep mobile sheets, top buttons, VCR, palette picker, map controls, and live
  clock inside phone safe-area bounds.
- Keep Packets server-backed across 1h/6h/24h windows with 1000-row cursor pages
  and a 5000-row retained client cap.
- Keep live packet comets readable by suppressing them at low zoom by default,
  while allowing forced replay and the all-zoom override.
- Keep VCR replay clear with loading spinner feedback, 8x/16x speeds, and a
  capped Laser Show mode.
- Keep OpenFreeMap selected-packet replay cinematic with a cancellable chase
  camera and unchanged public data schemas.

## Next Cleanup Candidates

- Continue splitting large frontend surfaces only when behavior is covered by
  tests and the visible UI stays unchanged.
- Add focused regression tests for any packet filtering, replay, map source, or
  privacy boundary bug that appears in production.
- Review screenshots and docs each release so README examples reflect the
  current UI and do not keep obsolete release-specific assets.
- Keep local-only artifacts, databases, and generated output out of Git and out
  of Docker build contexts.

## Non-Goals

- No public raw packet hashes, raw path hex, full public keys, resolver debug
  fields, private payloads, broker credentials, or operator config.
- No public admin/debug page without a separate access-control design.
- No guessed map routes. Missing data should be explained by diagnostics, not
  invented on the public map.
