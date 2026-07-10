# 3.2.0 Upgrade And Rollback

The hosted release is an immutable-digest, data-preserving upgrade. Do not use
a mutable tag and do not pass the destructive fresh-database flags.

## Before the maintenance window

1. Record `/healthz`, `/readyz`, the running image, Git SHA, dirty-tree hash,
   restart/OOM state, database/WAL sizes, and filesystem capacity.
2. Reclaim only unused builder cache and require at least 9 GiB and 20% free.
3. Apply staged OS updates and reboot while the existing application and data
   are recoverable. Abort if the old service is not healthy within five minutes.
4. Create an encrypted block volume in the same region. A low-priority raw copy
   while the service is live may pre-seed it, but that copy is not a backup.
   Stop the watchdog and writer, checkpoint the WAL, synchronize the quiesced
   database to the volume, and restart the old digest. Require
   `quick_check=ok`, no foreign-key violations, and matching row/schema
   metadata. Snapshot the idle volume and keep that immutable pre-upgrade
   snapshot through the 24-hour audit.
5. Run the exact candidate against the verified volume copy with MQTT disabled
   on loopback port 39477; the volume snapshot remains the rollback source.
   Record migration duration, peak storage, schema 32000, integrity, retained
   row counts, event reset, WebSocket hello, and the public privacy scan.
6. Resolve one successful candidate workflow run and attempt. Verify the
   uniquely named artifact, attestation, full merge SHA, and `@sha256:` digest.
   Pre-pull that digest and the previous immutable digest.

## Data-preserving cutover

```bash
cd /opt/MC-CartoLive
node --version # v18 or newer for the privacy/WebSocket validation
MC_CARTOLIVE_REQUIRE_PRIVACY_SCAN=1 bash scripts/deploy.sh \
  --image ghcr.io/n30nex/mc-cartolive@sha256:<candidate-digest> \
  --previous-image ghcr.io/n30nex/mc-cartolive@sha256:<previous-digest> \
  --expected-git-sha <full-release-sha>
```

Without `--fresh-database`, the script preserves the SQLite DB, WAL/SHM, and
`data/config.yaml`. It pre-pulls both digests, verifies candidate OCI identity,
stops the watchdog, starts the candidate without building, and allows the
forward-only transaction to add missing columns/indexes and set schema 32000.
It writes `MC_CARTOLIVE_DATABASE_MODE=preserved` only after readiness and
release verification pass.

Before restoring the watchdog, also require:

- `PRAGMA quick_check` is `ok` and `foreign_key_check` is empty
- schema version is 32000 and pre-existing packet/observation/event rows remain
- `afterSeq=0` returns HTTP 200 with `resetRequired=true`
- bootstrap/state and the first version-1 WebSocket `hello` are valid
- every public route passes `scripts/check-public-privacy.mjs`
- compiled version/SHA/build time and the running digest match the candidate
- MQTT session readiness, zero queue drops, and no busy/full error storm

The destructive mode remains available for an explicitly approved future
operation, but it is not the 3.2.0 hosted procedure.

## Automatic rollback

If candidate startup or validation fails, the deploy script stops it and starts
the previous immutable digest against the preserved, additively migrated
database. Schema 32000 changes are additive, so the previous application can
ignore them. The watchdog remains disabled if rollback readiness fails.

If the live database itself is damaged, stop all writers, restore the verified
pre-upgrade block-volume snapshot to `data/meshcore-live.db`, remove only the
corresponding WAL/SHM created after that restored snapshot, verify integrity,
and start the previous digest. Never overwrite the preserved backup in place.

## Promotion and soak

Keep the candidate running for at least 30 minutes. Do not create `v3.2.0` if
there is a restart, OOM, `SQLITE_FULL`, busy storm, queue drop, cache failure,
MQTT loss, public 5xx, privacy finding, metadata mismatch, or row discontinuity.

```bash
set -euo pipefail
cd /opt/MC-CartoLive
set -a
. /var/lib/mc-cartolive-deploy/current.env
set +a
test "$MC_CARTOLIVE_DATABASE_MODE" = preserved
test "$MC_CARTOLIVE_GIT_SHA" = "$(git rev-parse HEAD)"
test "$(docker inspect --format '{{.Config.Image}}' meshcore-canada-live-map)" = "$MC_CARTOLIVE_IMAGE"
candidate_digest="${MC_CARTOLIVE_IMAGE##*@}"
candidate_run_id="$MC_CARTOLIVE_CANDIDATE_RUN_ID"
candidate_run_attempt="$MC_CARTOLIVE_CANDIDATE_RUN_ATTEMPT"
test "$MC_CARTOLIVE_CANDIDATE_TAG" = "candidate-$MC_CARTOLIVE_GIT_SHA-$candidate_run_id-$candidate_run_attempt"
cat >/tmp/mc-cartolive-v3.2.0-tag.txt <<EOF
MC-CartoLive 3.2.0

Candidate-Run-Id: $candidate_run_id
Candidate-Run-Attempt: $candidate_run_attempt
Candidate-Digest: $candidate_digest
Candidate-Deployed-At: $MC_CARTOLIVE_DEPLOYED_AT
EOF
git tag -a v3.2.0 "$MC_CARTOLIVE_GIT_SHA" -F /tmp/mc-cartolive-v3.2.0-tag.txt
git push origin v3.2.0
```

Promotion consumes that run-specific artifact and promotes the same digest,
without rebuilding, to `3.2.0`, `3.2`, `sha-<merge-sha>`, and `latest`.
Install `mc-cartolive-release-audit.timer` before cutover. Preserved mode
requires at least 9 GiB and 20% free at 24 hours; day 8 and day 14 enforce
retention, WAL, and bounded database-growth checks.
