# MC-CartoLive 3.0.1 Release Notes

3.0.1 is the smooth live-map shell patch. It keeps backend public API shapes
stable while making the frontend feel more like a modern app on desktop and
mobile.

## Highlights

- Added four map modes: Watch, Explore, Terrain, and Studio.
- Replaced the mobile utility dock with a bottom tabbar for Map, Packets,
  Nodes, Chat, and More.
- Collapsed separate Live and Focus affordances into one calmer Follow action
  for recent routed activity.
- Added unified snackbars for copy, share, route GIF, and follow feedback.
- Added branded loading feedback using the active v3 asset pack.
- Reduced runtime churn around public-state snapshots, route pulses, heatmap
  updates, and duplicate MapLibre source updates.

## Compatibility

- Public API DTOs are unchanged.
- Privacy boundaries are unchanged.
- Existing deployments can keep their current data volumes and env files.
- Existing local map settings migrate to schema v7 and infer the closest map
  mode while marking advanced/customized views when needed.
