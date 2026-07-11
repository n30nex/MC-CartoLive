# 3.2.1 Upgrade And Rollback

3.2.1 is a preserved database upgrade from 3.2.0. The hosted Canada deployment
must use the Canada candidate digest; generic/world operators use the world
digest. Neither path builds on the target host.

## Before cutover

1. Verify the exact main SHA, candidate run and attempt, world digest, Canada
   digest, and successful browser/performance evidence.
2. Verify an off-host rollback copy or snapshot and run SQLite `quick_check`
   and `foreign_key_check` against a consistent copy.
3. Confirm the host has at least 9 GiB and 20 percent free space for a preserved
   deployment.
4. Install the staged watchdog and post-release-audit units, run
   `systemctl daemon-reload`, and verify both timers.
5. Pre-pull the Canada digest and keep the currently deployed digest as the
   rollback reference.

## Hosted deployment

Use `scripts/deploy-live.ps1` with the candidate evidence produced for the exact
main commit. The wrapper verifies the remote checkout, immutable image labels,
candidate metadata, and public/loopback checks before it records success.

The deployment must:

- keep `.env`, `data/config.yaml`, the SQLite database, WAL, and SHM;
- omit every fresh-database/destructive flag;
- record `MC_CARTOLIVE_DATABASE_MODE=preserved`;
- use the Canada candidate digest;
- keep the previous digest in the deployment state file;
- refuse a dirty or mismatched remote checkout.

Run the active-flow soak for at least 30 minutes before tagging. A quiet RF
window is not a failure, but when MQTT acceptance advances, MQTT processing,
derived acceptance/processing, the public sequence, and a WebSocket event must
all advance. Derived failure/drop counters must remain zero.

## Rollback

Rollback uses the previous immutable digest already recorded in
`/var/lib/mc-cartolive-deploy/current.env`. Do not reset a Git branch and do not
restore a database unless the schema or integrity check requires it.

1. Stop the failing container through production Compose.
2. Set `MC_CARTOLIVE_IMAGE` to the recorded previous digest.
3. Recreate the service without rebuilding.
4. Verify `/healthz`, `/readyz`, public state, WebSocket hello, metrics over SSH,
   restart/OOM state, and database integrity.
5. If the database itself is damaged, stop all writers before restoring the
   verified off-host copy and its matching WAL/SHM boundary.

The 3.2.1 code does not change schema version 32000, so normal digest rollback
to the last 3.2.0 image does not require a reverse migration.

## Publication

Only after the hosted Canada digest passes the soak, create the annotated
`v3.2.1` tag with the candidate run/attempt, deployment time, and both world
and Canada digests. The generic release workflow promotes existing registry
manifests; it must never rebuild the release tag.

The annotation must contain exactly one of each trailer below. Use the world
digest from the selected candidate manifest and the Canada digest/deployment
time verified against `/var/lib/mc-cartolive-deploy/current.env`:

```text
MC-CartoLive 3.2.1

Candidate-Run-Id: <workflow-run-id>
Candidate-Run-Attempt: <run-attempt>
Candidate-World-Digest: sha256:<world-manifest-digest>
Candidate-Canada-Digest: sha256:<soaked-canada-manifest-digest>
Candidate-Deployed-At: <RFC3339-UTC>
```
