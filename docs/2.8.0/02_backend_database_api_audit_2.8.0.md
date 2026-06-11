# 02 — Backend, Database, API, and Performance Audit for 2.8.0

## Executive backend verdict

The backend architecture is good and should be preserved: one Go service, one SQLite database, one embedded React frontend, one Docker Compose service, MQTT ingest, public-safe APIs, and WebSocket live updates.

The backend is not yet production-ready for 2.8.0 because of migration, projection fallback, deploy, and release-gate issues. These must be fixed before merging dev to main.

## Architecture strengths to keep

### Single-service deployment

The app remains operator-friendly:

- Go backend
- embedded Vite/React static assets
- SQLite WAL database
- Docker Compose
- public/private API split
- optional fixture replay
- one public live WebSocket

Keep this. Do not split into microservices for 2.8.0.

### Public/private safety boundary

The public route registration is good:

- public endpoints are registered unconditionally
- internal debug/raw endpoints are registered only when `PUBLIC_MODE=false`
- public endpoints emit sanitized state, public packet paths, public chat, and route pulses
- internal raw packet details are hidden in public mode

For 2.8.0, do not add any endpoint that leaks raw packet internals.

### Runtime observability

The dev branch already exposes useful operational fields:

- MQTT connected state
- MQTT last message age
- MQTT dropped messages
- public WebSocket drops
- cache age
- route/pulse freshness
- public packet projection counters
- projection backfill counters
- public packet search mode counters
- cache refresh and packet count refresh latencies/failures

Keep and expand this into a public-safe diagnostics panel after the release blockers are fixed.

## P0 backend bugs

### P0-1 — Missing production DB migration for `nodes.supports_multibyte`

**Confirmed source issue**

`schema.sql` defines:

```sql
supports_multibyte TEXT NOT NULL DEFAULT 'unknown'
```

in the `nodes` table.

Node write/read code uses the column in:

- `UpsertAdvertNode`
- `upsertStatusNode`
- `NodeByPublicKey`
- `NodeByID`
- `Nodes`

But current `Migrate()` only attempts to add:

- `packet_observations.message_sender`
- `packet_observations.message_text`
- `live_edge_events.message_sender`
- `live_edge_events.message_text`
- `live_edge_events.message_anchor_json`

It does not add `nodes.supports_multibyte`.

**Production impact**

Existing production DBs created before this column existed can break with:

```text
no such column: supports_multibyte
```

This can cascade into:

- failed node upserts
- failed public state refresh
- empty nodes
- empty NetGraph
- broken route/node labels
- broken Packets/Chat context
- readiness failures

**Required fix**

Add an idempotent migration helper:

```go
func (s *Store) addColumnIfMissing(ctx context.Context, table string, column string, alterSQL string) error {
    rows, err := s.db.QueryContext(ctx, `PRAGMA table_info(`+safeSQLiteIdent(table)+`)`)
    if err != nil {
        return err
    }
    defer rows.Close()

    for rows.Next() {
        var cid int
        var name, typ string
        var notNull int
        var defaultValue any
        var pk int
        if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
            return err
        }
        if strings.EqualFold(name, column) {
            return nil
        }
    }
    if err := rows.Err(); err != nil {
        return err
    }
    _, err = s.db.ExecContext(ctx, alterSQL)
    return err
}
```

Do not accept arbitrary user input for table names. Use a whitelist or fixed constants.

Minimum migration:

```sql
ALTER TABLE nodes ADD COLUMN supports_multibyte TEXT NOT NULL DEFAULT 'unknown';
```

Also migrate/verify these columns/tables because old installs may lack them:

- `packet_observations.message_sender`
- `packet_observations.message_text`
- `live_edge_events.message_sender`
- `live_edge_events.message_text`
- `live_edge_events.message_anchor_json`
- `public_packet_paths.region`
- `public_packet_paths.route_ids_json`
- `public_packet_paths.endpoint_labels_json`
- `public_packet_paths.search_text`
- `public_packet_paths.message_sender`
- `public_packet_paths.message_text`
- `public_packet_paths_fts`
- projection triggers

**Required tests**

Create an old-schema SQLite DB without `supports_multibyte`, then run `Migrate()`.

Assertions:

```go
assertColumnExists("nodes", "supports_multibyte")
assertNoError(s.UpsertAdvertNode(...))
assertNoError(s.NodeByPublicKey(...))
assertNoError(s.Nodes(ctx, false, ""))
assertNoError(app.RefreshPublicStateCache(ctx))
```

### P0-2 — Public Packets projection can hide valid packet paths

**Confirmed source issue**

`publicPackets()` calls `publicPacketsFromProjection()` first and returns immediately when it returns true.

The projection handler writes a JSON response and returns `true` even when the projection query returns zero rows.

The store already has `PublicPacketPathProjectionComplete(ctx, from, to)`, but the public Packets handler does not gate projection use on it.

**Production impact**

If `public_packet_paths` is empty/incomplete after an upgrade, `/api/v1/public/packets` can return:

```json
{
  "packets": [],
  "window": { "count": 0 },
  "scan": { "eventsScanned": 0 }
}
```

even when `live_edge_events` contains valid public route data. The Packets page then looks broken.

**Required fix**

Use projection only when the window is complete, or fallback when projection returns empty and legacy edge events may exist.

Recommended pattern:

```go
complete, completeErr := s.Store.PublicPacketPathProjectionComplete(ctx, from, to)
if completeErr == nil && complete {
    if s.publicPacketsFromProjection(w, ctx, now, from, to, limit, cursor, filters) {
        failed = false
        return
    }
}

if completeErr != nil && s.Runtime != nil {
    s.Runtime.RecordPublicPacketsProjection(false, false, true)
}

// Legacy fallback remains authoritative when projection is incomplete.
```

Better pattern:

```go
projected, scan, ok := s.publicPacketsProjectionResponse(ctx, now, from, to, limit, cursor, filters)
if ok && (complete || len(projected.Packets) > 0 || cursor != nil || filters.hasAny()) {
    writeJSON(w, http.StatusOK, projected)
    return
}
return s.publicPacketsLegacy(...)
```

Acceptance rule:

- Incomplete projection must not hide legacy packets.
- Empty complete projection is okay only if legacy would also be empty.
- Filters/search must be tested both with FTS and substring fallback.

**Required tests**

1. `live_edge_events` has one valid event.
2. `public_packet_paths` is empty.
3. `/api/v1/public/packets` returns the valid packet via legacy fallback.
4. Projection counters record fallback.
5. After backfill, projection path returns the same packet.
6. Search filters still work.

### P0-3 — Deploy script is unsafe for production

See `06_production_deploy_runbook_carto_2.8.0.md` for full fix.

Backend-facing requirements:

- Use SQLite `.backup`.
- Never restore a single DB file over a live WAL database unless the app is stopped and WAL/SHM are handled.
- Check the actual host port: `http://127.0.0.1:39476/readyz`.
- Default to `dev/deepseek-v4` during pre-merge release validation or `main` after merge.
- Record previous SHA.
- Roll back safely if health/browser checks fail.

### P0-4 — Version drift

The target release is `2.8.0`.

Update:

- `VERSION`
- `web/package.json`
- `web/package-lock.json`
- `Dockerfile` both `ARG APP_VERSION`
- `docker-compose.yml` default `APP_VERSION`
- `.env.example`
- `backend/internal/app/config.go`
- `web/index.html`
- `README.md`
- `CHANGELOG.md`
- `docs/production.md`
- `docs/development.md`
- `docs/roadmap.md`
- any release screenshots/notes where version appears

Run:

```bash
node scripts/check-version-sync.mjs
```

## P1 backend concerns

### P1-1 — Public rate limiter trusts X-Forwarded-For unconditionally

The backend accepts `X-Forwarded-For` before `X-Real-IP` or `RemoteAddr`.

If the service is reachable directly, clients can spoof XFF and bypass rate limits. If it is only behind a trusted proxy, this is acceptable.

**Fix options**

Add:

```text
TRUST_PROXY_HEADERS=true
TRUSTED_PROXY_CIDRS=127.0.0.1/32,10.0.0.0/8,...
```

Default should be false unless production deployment requires it.

### P1-2 — Readiness may be too strict during warm cache

`readyz` depends on DB readiness, static readiness, and public cache readiness. This is good for production. It can be frustrating after migrations or fixture boot if cache warm-up is slow.

**Fix**

Keep strict production readiness, but expose separate fields clearly:

- `dbReady`
- `staticReady`
- `publicStateReady`
- `cacheAgeMs`
- `cacheUpdatedAt`
- `packetPathBackfillRemaining`

Deploy script should wait long enough and print these fields on failure.

### P1-3 — Packet path projection completeness check could be expensive

`PublicPacketPathProjectionComplete()` uses an anti-join over a time window. This is correct but should be indexed and possibly cached briefly.

**Fix**

Ensure indexes support:

```sql
live_edge_events(heard_at_ms DESC, id DESC)
public_packet_paths(edge_id)
```

Add a short in-memory completeness cache keyed by rounded window only if performance measurements show pressure.

### P1-4 — Public history projection path may share the same incomplete projection risk

`publicHistoryFromProjection()` also returns true when it writes a response. It does fallback only if no projection rows and first page/cursor nil in some cases. Confirm runtime behavior with tests.

**Required test**

When projection is incomplete and legacy public history has route pulses, history should not become empty.

### P1-5 — Metrics endpoint exposure

`/metrics` is public. That may be fine, but it should never expose secrets, raw payloads, public keys, or private topics. Keep only aggregate counters.

Add privacy scan coverage for `/metrics`.

## Performance recommendations

### Backend API

1. Add a local performance script that records p50/p95/max latency and response sizes for:
   - `/healthz`
   - `/readyz`
   - `/api/v1/public/state`
   - `/api/v1/public/history`
   - `/api/v1/public/history/summary`
   - `/api/v1/public/packets`
   - `/api/v1/public/chat`
   - `/api/v1/public/solar`
2. Save output to:
   - `perf-results/backend-api-2.8.0.json`
3. Add thresholds:
   - state p95 under 500 ms on fixture
   - packets p95 under 1000 ms on fixture
   - chat p95 under 1000 ms on fixture
   - history summary p95 under 750 ms on fixture
4. Add SQL query plan snapshots for packet/chat/history hot paths.

### SQLite

Keep:

- WAL
- busy timeout
- `synchronous=NORMAL`
- `temp_store=MEMORY`
- mmap
- bounded queries
- indexed projection table

Add:

- `PRAGMA optimize` in maintenance loop.
- Startup log for SQLite version and schema migration status.
- Migration table or schema version table for future safety.
- DB size and WAL size in diagnostics.
- DB backup command in docs.

### MQTT ingest

Keep the bounded queue and dropped message counters.

Add:

- ingest queue depth in `/healthz` and `/readyz`
- decode failure buckets by reason
- topic parse failure count
- route gate status buckets
- observer freshness buckets

### Public cache

Keep cache refresh off the hot request path.

Add:

- cache generation ID
- last successful refresh duration
- last failed refresh error class
- cache item truncation detail
- “live but quiet” vs “stale” display fields

## Backend acceptance criteria

The backend cannot be signed off until all pass:

```bash
cd backend
go test ./...
go tool govulncheck ./...
```

New backend tests must cover:

- old DB migration without `nodes.supports_multibyte`
- projection fallback when `public_packet_paths` is empty
- projection path after backfill
- public packets filters/search
- public chat filters/search/dedupe
- public history fallback/projection behavior
- public privacy scan for `/metrics`
- readiness JSON stability
- deploy health URL expectations
- rate limiter behavior behind trusted/untrusted proxy settings
