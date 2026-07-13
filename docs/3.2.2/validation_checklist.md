# MC-CartoLive 3.2.2 Validation Checklist

This checklist is fail-closed and applies only to the exact SHA and image
digests being promoted.

## Source and behavior

- [ ] `VERSION`, package/OpenAPI metadata, Docker defaults, README, changelog,
  docs, branch, and tag agree on `3.2.2`; SQLite schema remains `32000`.
- [ ] Backend tests, race/vet/vulnerability checks, frontend tests/build,
  privacy/schema/asset/budget checks, shellcheck, release-contract tests,
  CodeQL, browser smoke, and service-worker 3.2.1-to-3.2.2 upgrade pass.
- [ ] Primary/live writer fairness, transient retry identity, ordered public
  event batches, derived retry, immediate semantic state/PacketTV, stable
  socket, no recovery animation, indexed reducer equivalence, and lossless
  burst animation have focused regression coverage.

## Canonical performance and candidate

- [ ] The locked full profile passes on the exact release-branch head and the
  merged-main SHA; no fast-track/deferred-proof path exists.
- [ ] 20/s sustained, 100/s burst, preserved five-million-row retention/
  topology database, API/WebSocket/browser concurrency, latency, frame, memory,
  queue, zero-loss, and zero-emergency gates pass.
- [ ] One main SHA produces immutable, distinct world and Canada amd64/arm64
  candidates with successful smoke, scan, provenance, SBOM, compiled identity,
  and asset-pack checks.

## Hosted Canada canary

- [ ] The 17 GB root backup and off-host/block-volume copy have equal size and
  checksum on different filesystems. Any root-copy removal happened only after
  green evidence; otherwise deployment is aborted.
- [ ] At least 9 GiB and 20 percent free space remain, and the separate audit
  snapshot mount is writable with sufficient temporary capacity.
- [ ] The exact Canada digest is deployed over the preserved database; the
  previous immutable 3.2.1 digest is recorded and no host build occurs.
- [ ] The single five-minute checkpoint passes with at least 1,000 new
  accepted/processed messages and zero write/deadline/drop/animation/emergency,
  restart, OOM, integrity, privacy, or storage failures.
- [ ] Runtime checks do not scan active SQLite. The five-minute result reports a
  hashed consistent backup, full integrity `ok`, foreign keys `ok`, and schema
  `32000`.

## Publication

- [ ] Canonical `release-verification.json` passes bound validation and matches
  the tag trailers, Actions run IDs, SHA, digests, browser numbers, canary
  counters, and five-minute audit.
- [ ] Annotated `v3.2.2` is created only after at least 300 seconds of green canary evidence.
- [ ] World aliases `3.2.2`, `3.2`, `sha-<main-sha>`, and `latest` resolve to
  the world digest; Canada aliases `3.2.2-canada`, `3.2-canada`,
  `sha-<main-sha>-canada`, and `latest-canada` resolve to the soaked Canada
  digest.
- [ ] Release assets, verification JSON, checksums, OpenAPI, bundle, manifest,
  SBOMs, SARIF, and attestations verify and contain no live/private data.
