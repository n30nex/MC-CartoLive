# 3.2.2 Public API Notes

3.2.2 is additive and keeps the sanitized 3.2 HTTP and WebSocket routes and
event types. Full keys, observer keys, packet hashes, raw paths/payloads,
resolver reasons, credentials, and private broker data remain forbidden.

`receivedAt` remains the truthful server receipt time. `displayAt` is optional
immediate advisory timing; clients must not use it to delay authoritative
state or to animate recovered HTTP/snapshot events.

Readiness adds privacy-safe live-flow fields:

- `primaryIngestState` and `liveProjectionState`;
- `primaryQueueOldestAgeMs` and `liveProjectionOldestAgeMs`;
- `lastBroadcastLatencyMs` and cumulative `maxBroadcastLatencyMs`.

Public WebSocket events received on the connected socket may create a visual.
Cursor recovery, visibility recovery, polling, and snapshots update state only.
The six-character `pathHash3` remains the only public route-copy identifier.
