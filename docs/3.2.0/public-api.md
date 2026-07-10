# 3.2.0 Public API Changes

3.2.0 preserves existing public endpoints and fields. New behavior is additive
except that event cursor zero now intentionally requests a reset instead of an
unbounded historical scan.

## Compact bootstrap

`GET /api/v1/public/bootstrap` returns:

- `serverTime`, sanitized map configuration and summary `stats`
- `latestSeq`
- public-safe `health` with `mqttSessionReady`, `datasetState`,
  `datasetStartedAt`, and `storagePressureState`
- aggregate low-zoom `clusters`
- bounded `recentActivity`

Use bootstrap for initial map hydration. `/api/v1/public/state` remains the
compatibility endpoint for clients that need the full retained snapshot.

## Event cursor contract

`GET /api/v1/public/events?afterSeq=<n>&limit=<1..1000>` returns
`oldestSeq`, `latestSeq`, `events`, `nextCursor`, and `resetRequired`.

- `afterSeq <= 0`: HTTP 200, empty `events`, `resetRequired=true`.
- cursor below the retained floor: the same reset response.
- cursor beyond `latestSeq`: the same reset response.
- retained cursor: ascending events, `resetRequired=false`, and a cursor for the
  last returned sequence.

When reset is required, fetch bootstrap/state, set the local cursor to
`latestSeq`, and reconnect. Do not retry sequence zero. Use bounded history
endpoints for deliberate historical browsing.

## Viewports

`GET /api/v1/public/viewport` can include aggregate `clusters` along with
`nodes`, `routes`, and events. Low zoom should consume clusters; detail zoom can
request the public nodes/routes inside the supplied bbox.

## Dataset health

`datasetState` values are:

- `fresh_start`: newly initialized schema with no retained observation yet
- `warming`: runtime/session/cache initialization is progressing
- `live`: the public dataset is actively populated

`storagePressureState` is `ok`, `warn`, or `critical`. These values are
sanitized decisions, not raw filesystem paths or database internals.

## Privacy and compatibility

New responses follow the same boundary as state and WebSocket data: no full
keys, observer keys, packet hashes, raw payload/path hex, broker data, resolver
reasons, or operator configuration. `pathHash3` remains the only public
route-copy prefix.

The authoritative machine-readable contract is
[`docs/public-api.openapi.json`](../public-api.openapi.json). CI checks its
OpenAPI version, application version, route inventory, and forbidden fields.
