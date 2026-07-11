# MC-CartoLive 3.2.1 Validation Checklist

This record is fail-closed. Check an item only for the exact commit and image
digests promoted as 3.2.1.

## Source and regression coverage

- [ ] `VERSION`, package metadata, OpenAPI, Docker defaults, README, changelog,
  release docs, branch name, and tag agree on `3.2.1`.
- [ ] Backend tests, vet, race tests, module verification, and `govulncheck`
  pass, including storage-warning progress, bounded backfill, unsequenced
  fallback, and concurrent cache-reconciliation coverage.
- [ ] Frontend tests and production build pass, including sparse cursor,
  unsequenced fallback, bootstrap hydration, Watch-mode migration, and low-zoom
  live-motion coverage, plus bounded long-session identity tracking and map
  source-queue disposal.
- [ ] Privacy/schema, asset-pack, frontend-budget, release/deploy contract,
  shell, secret, dependency, CodeQL, and vulnerability checks pass.
- [ ] Desktop 1440x900 and mobile 390x844 browser smoke pass on the PR and the
  protected-main commit. The smoke proves complete topology, advancing live
  state, absence of retired VCR/Replay Studio controls, visibility/network
  recovery, and bounded resource growth.

## Performance and packaging

- [ ] The canonical full performance profile passes on the exact release-branch
  head and again on the merged main commit; no fast-track waiver is set.
- [ ] Sustained 20/s, burst 100/s, five-million-row API, 250-client WebSocket,
  quiet-connection, queue-isolation, and memory gates pass with no ingest or
  derived drop.
- [ ] One source SHA produces separate world and Canada amd64/arm64 manifest
  digests. Both pass package smoke with the correct served PWA manifest and
  pack-local icons, scan, provenance, SBOM, and per-platform compiled identity
  checks.
- [ ] Candidate evidence binds the main SHA, source CI, browser-smoke success,
  performance proof, workflow run/attempt, both digests, both asset packs, and
  both platform sets.

## Hosted Canada cutover

- [ ] `/opt/MC-CartoLive` is clean and exactly matches the merged main SHA;
  release scripts/systemd units match repository checksums.
- [ ] The current database and off-host rollback evidence are verified; at
  least 9 GiB and 20 percent filesystem space remain before preserved deploy.
- [ ] The Canada candidate digest is deployed in preserved mode with the
  previous digest recorded for rollback. No host build or branch reset occurs.
- [ ] The corrected post-release-audit unit loads and exits successfully with
  its read-only capability boundary; the watchdog remains active and clean.
- [ ] Health/readiness report `3.2.1`, the exact main SHA, live MQTT session,
  ready public state, and no storage pressure.
- [ ] Public HTTP privacy, WebSocket hello/events, loopback metrics over SSH,
  database integrity, restart/OOM, and active-flow checks pass.
- [ ] A minimum 30-minute soak shows advancing MQTT/public sequences when
  traffic is present, visible browser motion, zero queue/WS/store/cache drops,
  zero unexpected restart/OOM, and no busy/full/error storm.

## Publication

- [ ] The annotated `v3.2.1` tag names the exact candidate run/attempt,
  deployment time, and both soaked digests and is created only after the soak.
- [ ] World tags `3.2.1`, `3.2`, `latest`, and `sha-<main-sha>` resolve to the
  world digest.
- [ ] Canada tags `3.2.1-canada`, `3.2-canada`, `sha-<main-sha>-canada`, and
  `latest-canada` resolve to the Canada digest deployed on the hosted droplet.
- [ ] GitHub release assets, checksums, OpenAPI, deployment bundle, release
  manifest, SBOM, SARIF, and attestations verify and contain no live/private
  data.
- [ ] The GitHub release and README clearly identify the generic image as
  world and the hosted image as Canada.

## Scheduled evidence

- [ ] The 24-hour audit passes for the 3.2.1 deployment identity.
- [ ] The day-8 retention/WAL result passes and records its growth baseline.
- [ ] The day-14 retention/WAL result passes with growth below the documented
  threshold.
