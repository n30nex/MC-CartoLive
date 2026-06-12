# MC-CartoLive 2.9.1 Release Notes

## Highlights

- Live WebSocket sessions now avoid routine full-state polling, reducing
  repeated JSON parsing, sanitizer work, and broad state replacement.
- Route pulses update the touched routes instead of rebuilding and sorting the
  whole public route list on every routed packet.
- Activity heatmap source updates are skipped while hidden and throttled while
  visible, reducing MapLibre source refresh pressure.
- Node label freshness refreshes and top-level idle clocks run at calmer
  cadences while active VCR playback remains responsive.
- VCR history summaries no longer poll while the VCR is closed.
- Busy Pathways sorting and route activity summarization are skipped while the
  panel is hidden.
- Mobile map controls reserve one bottom-control zone, with Replay exposed from
  the mobile control sheet and transient drawers anchored above the dock.
- Workspace panels now suppress floating map chrome, PacketTV suppresses the
  bottom dock, and the mobile release bar collapses to the controls that fit.
- Public WebSocket recovery handles browser construction and send failures more
  gracefully, and the backend skips gzip work for already-compressed static
  assets.
- Live hub drop accounting is safe under overlapping broadcasts, and websocket
  removal avoids duplicate close work.

## Operator Notes

- Public API response shapes are unchanged from 2.9.0.
- No database migration is required.
- The patch is intended to improve loaded-map responsiveness during live traffic
  and lower idle browser work for default visitors.
- Responsive UI checks should confirm the mobile dock, Map Settings drawer,
  visitor guide, route export action, replay controls, and MapLibre controls do
  not overlap at narrow widths.
- Backend validation should include API middleware and live hub tests because
  this patch touches compression decisions and websocket drop accounting.
- Local validation should continue to use Podman unless the target host is
  Docker-only.

## Compatibility

- Existing browser map settings remain valid.
- Existing public endpoints and WebSocket messages remain valid.
- Existing deployment environment variables remain valid.
