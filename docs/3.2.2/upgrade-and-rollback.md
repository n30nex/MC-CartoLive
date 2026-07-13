# 3.2.2 Upgrade And Rollback

3.2.2 preserves schema `32000`; normal rollback to the recorded immutable
3.2.1 digest does not require a reverse migration.

## Before cutover

1. Verify the release-branch and merged-main canonical performance artifacts,
   successful main browser CI, candidate run/attempt, and distinct world/Canada
   digests.
2. Checksum-verify the root backup against its copy on a different mounted
   filesystem. Remove the redundant root copy only after the verification
   script records `matched=true`; abort on any mismatch.
3. Confirm at least 9 GiB and 20 percent free space and provision the separate
   audit snapshot mount.
4. Pre-pull the exact Canada digest and record the current 3.2.1 digest.

Deploy with `scripts/deploy-live.ps1`/`scripts/deploy.sh` using the exact merged
main SHA, Canada `image@sha256:digest`, and previous immutable digest. Do not
build on the host, reset a branch, replace the database, or pass fresh-database
flags. Preserved deployment also requires the fresh aggregate evidence file
from `verify-backup-copy.sh`; the Windows wrapper defaults to
`/var/lib/mc-cartolive-deploy/backup-verification.json`.

Run one fail-closed checkpoint at five minutes. It requires at least 1,000
accepted and processed messages, zero loss,
write/deadline failure, restart or OOM, browser timing proof, at least 9 GiB/20
percent free, and a green consistent-snapshot audit.

## Publication

Generate and validate the aggregate evidence described in
[release verification](release-verification.md). Create the annotated
`v3.2.2` tag after that five-minute gate. Its annotation contains the candidate
run/attempt, both digests, deployment timestamp, and a single base64-encoded
canonical `release-verification.json` trailer. The tag workflow validates this
evidence against trusted Actions artifacts before promoting the already-built
manifests to `3.2.2`, `3.2`, and `latest` aliases.

### Git-only publication option

If the operator explicitly chooses not to cut over a live system, do not run
the deployment, backup, canary, or live-audit steps above. Dispatch `Publish
Git-only release` on exact current `main` with the successful candidate run ID
and attempt. It verifies the same source CI, browser, canonical performance,
candidate, digest, and asset-pack identities before promoting both world and
Canada aliases and creating the annotated tag and GitHub release.

The attached `release-verification-source-only.json` deliberately excludes any
live deployment, canary, or database-audit claim. Publishing the Canada image
does not assert that any existing Canada host is running it. A later operator
cutover must independently perform the backup, deployment, readiness, and
rollback checks appropriate to that host.

## Rollback

On any privacy, integrity, write/deadline/drop, animation-loss, emergency-mode,
restart, OOM, or space gate failure, stop the candidate and recreate the service
with `MC_CARTOLIVE_PREVIOUS_IMAGE` from deployment state. Verify readiness,
public privacy, WebSocket flow, metrics, and database state. Restore the
verified off-host database only if integrity itself failed and all writers are
stopped.
