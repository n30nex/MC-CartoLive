# 07 — New Features and Enhancements Beyond Current Dev Branch

These are recommended after P0/P1 release blockers are fixed. Do not let feature work delay fixing Packets, Chat, NetGraph, service worker, DB migrations, projection fallback, deploy safety, and tests.

## 2.8.0 included enhancements if time allows

These are safe to add during stabilization if they are small and tested.

### RF confidence overlay

Show every drawn public route with a confidence label:

- high-confidence RF
- observer-derived
- stale route
- missing recent RF
- rejected by distance gate
- unresolved/ambiguous hidden

UI:

- route inspector field
- legend badge
- optional map overlay tint
- hover tooltip

### Better Packets search

Packets search should cover:

- route ID
- path prefix
- endpoint label
- region/IATA
- payload type
- decoded public message text
- message sender
- hop count
- distance bucket

Keep all search public-safe.

### Chat route context

Each chat message should optionally show:

- route/hop context
- endpoint labels
- replay button
- focus on map button
- collapsed duplicate/echo count

### NetGraph integration with map

From NetGraph:

- select node -> focus node on map
- select edge -> focus route on map
- select graph path -> open Packets filtered to that route

### Layer presets

Add map presets:

| Preset | Settings |
|---|---|
| Balanced | current defaults, stable for most users |
| Performance Saver | no 3D, fewer comets, no weather, lower DPR |
| RF Analysis | routes, heatmap, confidence, SNR/RSSI, labels |
| Presentation | high contrast, cinematic comets, large labels |
| War Drive | live packets, observers, latest heard, mobile-friendly |
| Minimal | nodes/routes only |

### Public diagnostics page

A new public-safe page:

```text
/#/diagnostics
```

Show:

- version/build/SHA
- MQTT state
- last message age
- public cache age
- packet projection state
- search mode counters
- backfill remaining
- WS clients/drops
- DB ready
- static ready
- map region
- public mode
- privacy-safe warnings

Do not expose secrets or raw data.

## World Release 2 feature backlog

### 1. Observer quality score

Calculate public-safe observer quality:

- last seen
- packets/hour
- positioned yes/no
- route contribution count
- duplicate ratio
- stale status
- average SNR/RSSI availability
- region consistency

Map UI:

- observer health layer
- observer badges
- observer dashboard
- “needs location” warning

### 2. SNR/RSSI heatmap

Add heatmaps:

- packet activity heat
- SNR quality heat
- RSSI quality heat
- observer coverage heat
- route freshness heat

Filters:

- region
- payload type
- time window
- observer
- min hop count
- freshness

### 3. Route quality inspector

A route inspector should show:

- endpoint labels
- path hash/prefix if public-safe
- distance
- packet count
- last heard
- payload mix
- average SNR/RSSI if public-safe
- observers involved
- confidence reason
- rejection history if available
- terrain line-of-sight summary
- elevation profile

### 4. Terrain and RF analysis

Add:

- Fresnel clearance estimate
- elevation profile per route
- route obstruction warning
- terrain line-of-sight coloring
- distance vs expected 915 MHz viability
- antenna height assumptions
- “needs manual height” warning

This must be labelled as estimated, not ground truth.

### 5. Replay studio

Improve VCR/GIF export:

- selected route replay
- selected region replay
- last 5/15/60 minute replay
- GIF/MP4 export queue
- overlay HUD options
- watermark/logo toggle
- presentation mode

### 6. Public analytics

Add dashboards:

- top active routes
- top regions
- top observers
- payload mix
- active nodes by role
- route creation/aging
- channel/message volume
- map coverage growth

### 7. Search everything

Unified search should find:

- node labels
- region/IATA
- route IDs
- packets
- public chat
- observer names
- payload type
- path prefix
- map location

### 8. Operator tools

Add safe operator page behind local/internal mode:

- prune controls
- backfill controls
- projection repair
- DB checkpoint
- cache refresh
- fixture replay control
- privacy scan shortcut
- environment summary

Public mode must hide this.

### 9. API schema docs

Generate docs for public endpoints:

- request parameters
- response schema
- examples
- privacy guarantees
- rate limits
- cache behavior
- versioning

### 10. Performance evolution

Backend:

- materialized route summary table
- query plan regression tests
- cached projection completeness
- state deltas
- compressed JSON where useful
- optional binary WebSocket stream later

Frontend:

- map source update batching
- adaptive route/label budgets
- offscreen canvas for packet animator if beneficial
- Web Worker for NetGraph layout if needed
- memory leak tests for 3D layers
- render quality auto-detection

### 11. Multi-region/world mode

World Release 2 should be truly global-ready:

- region preset UX
- map bounds presets
- public region filters
- per-region observer health
- region-specific default zoom/center
- automatic “current active region” quick filter
- worldwide route sanity gates

### 12. Mobile field mode

Add mobile-first mode for field use:

- large live status
- latest packet
- nearest active nodes
- observer/node count
- one-tap Packets
- one-tap Chat
- one-tap NetGraph disabled or simplified
- no heavy 3D by default
- low bandwidth mode

### 13. Reliability/ops

Add:

- startup self-test report
- schema migration report
- DB backup reminder
- stale MQTT alert
- stale public cache alert
- projection backfill alert
- service worker disabled status
- “release health” badge

## Feature priority recommendation

For the 2.8.x series:

1. 2.8.0: stabilize, merge, deploy.
2. 2.8.1: diagnostics page + service worker long-term policy.
3. 2.8.2: observer quality + route confidence overlay.
4. 2.8.3: SNR/RSSI heatmaps + route inspector.
5. 2.8.4: NetGraph-map integration + Chat replay.
6. 2.8.5: replay studio and analytics.

## Feature safety rules

Every new feature must obey:

- public-safe data only
- no raw packet internals
- no secret exposure
- no fake RF routes
- no unbounded DB query
- no unbounded frontend animation list
- no map layer that can crash the whole app
- mobile smoke required
- docs updated
