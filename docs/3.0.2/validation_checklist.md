# MC-CartoLive 3.0.2 Validation Checklist

## Local Gates

- [x] `cd backend && go test ./...`
- [x] `cd web && npm test -- --run` - 69 files, 302 tests
- [x] `cd web && npm run build`
- [x] `node scripts/check-version-sync.mjs`
- [x] `node scripts/public-schema-check.mjs`
- [x] `node scripts/check-asset-pack.mjs`
- [x] `node scripts/check-frontend-budget.mjs`
- [x] `git diff --check`

## Focused Frontend Coverage

- [x] Loading primitives render accessible labels, decorative spinner markup,
  skeleton rows, contextual loading blocks, and stable busy button labels.
- [x] Packets, Chat, propagation history, NetGraph, route GIF export, VCR/Laser,
  live status, and solar loading states render shared loading classes.

## Browser Smoke

- [x] Skipped by operator request on 2026-06-14 because browser smoke can crash
  this workstation.

## Privacy

- [x] No backend public API, DTO, database, or WebSocket changes were made.
- [x] Public UI still avoids raw packet data, packet hashes, full keys,
  observer public keys, private broker details, and resolver debug reasons.

## Deployment

- [ ] Push `main`.
- [ ] Deploy with `SKIP_DB_BACKUP=1 bash scripts/deploy.sh /opt/MC-CartoLive main`.
- [ ] Verify `/healthz`, `/readyz`, `/api/v1/public/state`, and
  `/api/v1/public/schema` report version `3.0.2` and sanitized public data.
