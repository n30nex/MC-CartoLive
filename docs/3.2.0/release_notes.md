# MC-CartoLive 3.2.0 Release Notes

MC-CartoLive 3.2.0 is the production reliability and visual-showcase release.
It folds the unreleased 3.1 work into the supported 3.2 line; there is no 3.1
tag or production migration waypoint.

## Highlights

- **RF Replay Studio** turns an already-public resolved route into a synchronized
  timeline with 2D/terrain/3D traversal, observer bursts, segment controls,
  Waterfall context, privacy-safe links, and on-demand client export.
- The first-run and mobile surfaces are smaller and more accessible. Dialogs
  trap/restore focus, advanced controls are grouped, and reduced-motion users
  get a static route story instead of forced camera animation.
- `/api/v1/public/bootstrap` supplies a compact first map response. Viewports
  can return low-zoom clusters without transferring the full node/route graph.
- Public event resume is bounded. Invalid, expired, initial, and future cursors
  return an immediate HTTP 200 reset response instead of scanning millions of
  retained rows.
- Health now distinguishes MQTT transport from subscription readiness and
  reports `fresh_start`, `warming`, or `live` dataset state plus sanitized
  storage pressure.
- SQLite schema version 32000 adds forward migration tracking, optimized event
  indexes, incremental space reclamation, seven-day observation retention, and
  24-hour public-event retention.
- Release identity is compiled into the binary/frontend. Runtime `.env` values
  cannot claim a different version, Git SHA, or build time.
- GitHub Actions builds one amd64/arm64 candidate, smokes/scans/attests its
  digest, and promotes that exact digest to `3.2.0`, `3.2`, and `latest`.

## Production fresh start

The hosted Canada 3.2.0 cutover intentionally starts with a new SQLite database.
The prior DB, WAL/SHM files, and every file under the dedicated `backups/`
directory are permanently deleted. They are not uploaded or archived. `.env`
and `data/config.yaml` are preserved, except stale release-identity keys are
removed from `.env` because identity now belongs to the artifact.

This is an operator decision for the hosted service, not a requirement for
third-party installations. The application retains forward migrations for
normal packaged upgrades.

## Compatibility

- Existing public endpoints and fields remain available. New HTTP fields and
  the bootstrap endpoint are additive.
- Event consumers must honor `resetRequired`; they should refresh bootstrap or
  state and resume at `latestSeq` rather than requesting sequence zero again.
- Published images require no release metadata environment variables.
- Production uses `DATA_RETENTION_DAYS=7`,
  `PUBLIC_EVENT_RETENTION_HOURS=24`, and
  `ALLOW_UNBOUNDED_RETENTION=false`.
- Go is updated to the patched 1.25.12 toolchain. Frontend release tooling uses
  React 19.2.7, Vite 8.1.4, Vitest 4.1.10, and Playwright 1.61.1.

## Release assets

The GitHub release contains the digest-pinned deployment archive, release
manifest, OpenAPI document, SPDX SBOM, Trivy SARIF, and `SHA256SUMS`. GitHub and
OCI provenance are attached separately as attestations. Verify checksums and
the manifest digest before moving files to a production host.

See [upgrade and rollback](upgrade-and-rollback.md),
[storage/fresh-start policy](storage-and-fresh-start.md), and the
[validation checklist](validation_checklist.md) before deployment.
