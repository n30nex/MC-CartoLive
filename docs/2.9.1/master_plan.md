# MC-CartoLive 2.9.1 Master Plan

## Summary

2.9.1 is a frontend performance patch for the 2.9 visitor UX baseline. It keeps
public API shapes stable and focuses on reducing repeated work after the map is
loaded.

## Implemented Scope

- Stop routine full `/api/v1/public/state` polling while the public WebSocket is
  healthy. Full snapshots remain available for initial load, reconnect,
  visibility resume, and polling fallback.
- Update live route pulses incrementally so untouched routes keep object
  identity when global frequency-bucket normalization is not required.
- Gate activity heatmap GeoJSON work when the heatmap layer is hidden.
- Throttle visible activity heatmap source refreshes so animation timers do not
  drive MapLibre `setData` calls at timer cadence.
- Reduce non-critical node label freshness refreshes from two seconds to ten
  seconds. Live node glow remains handled by feature state.
- Reduce idle top-level clock cadence from one second to five seconds while
  keeping active VCR playback at one second.
- Load VCR history summaries only while the VCR is open.
- Avoid Busy Pathways route activity summarization and sorting while that panel
  is hidden.
- Update in-app release highlights, version metadata, changelog, release notes,
  and validation checklist for 2.9.1.

## Research Basis

- MapLibre large-data guidance favors clustering, fewer rendered features,
  simplified styling, zoom-level gating, and vector/server tiling for larger
  datasets. The 2.9.1 patch applies the same principle locally by avoiding
  hidden heatmap source generation and reducing unnecessary source refreshes.
- React guidance treats memoization as a way to skip expensive recalculations
  when dependencies have not changed. The 2.9.1 patch applies that by making
  expensive route activity summaries visibility-gated and cadence-bucketed.
- Vite build guidance keeps chunking explicit for production builds. Existing
  split chunks are preserved; this patch targets runtime churn rather than
  moving code between bundles.

## Non-Goals

- No public API changes.
- No backend schema changes.
- No route-truth or privacy-boundary changes.
- No broad UI redesign in this patch.

## Release Gates

- Backend test suite.
- Full frontend Vitest suite.
- Production frontend build.
- Version sync.
- Public privacy scan.
- Podman package smoke.
- Browser smoke for desktop and mobile map-first workflows.
- Push to `main`, deploy, and live-smoke the production droplet.
