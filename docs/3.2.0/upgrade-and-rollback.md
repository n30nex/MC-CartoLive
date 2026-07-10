# 3.2.0 Upgrade And Rollback

This procedure is for the hosted fresh-database release. It is intentionally
digest-based and destructive. Do not substitute a mutable tag.

## Before the 15-minute window

1. Record `/healthz`, `/readyz`, the current container image/digest, Git SHA,
   working-tree hash, `docker inspect` restart/OOM state, and `df -h`.
2. Confirm no build is active. Reclaim unused BuildKit cache and verify at least
   9 GiB free without stopping production.
3. Apply staged OS updates and reboot while the existing service/data are still
   recoverable. Abort if the old service is not healthy within five minutes.
4. Copy the 3.2.0 deployment bundle into `/opt/MC-CartoLive`, preserving the
   private `.env` and `data/config.yaml` already on the host.
5. Resolve one successful candidate workflow run and attempt. Download its
   uniquely named
   `release-candidate-<merge-sha>-<run-id>-<run-attempt>` artifact, verify its
   manifest and attestation, and record its run ID, run attempt, and full
   `@sha256:` image. Never resolve the candidate from a newest artifact or a
   `sha-*` tag. Resolve the previous image to a full digest and pull both.
6. Run the candidate with a temporary volume on loopback port 39477 and the
   synthetic fixture. Verify version/SHA, readiness, public event reset,
   WebSocket hello, and the public privacy scan; then remove the candidate
   container/volume.

## Cutover

Use the full digests:

```bash
cd /opt/MC-CartoLive
apt-get install -y nodejs
node --version # must be v18 or newer
bash scripts/deploy.sh \
  --image ghcr.io/n30nex/mc-cartolive@sha256:<candidate-digest> \
  --previous-image ghcr.io/n30nex/mc-cartolive@sha256:<previous-digest> \
  --expected-git-sha <full-release-sha> \
  --fresh-database \
  --confirm-fresh-database DELETE-MC-CARTOLIVE-PRODUCTION-DATA
```

The script pre-pulls both images, stops the watchdog, stops the writer, proves
the named Compose container is absent, removes
stale release identity/runtime variables, fixes the production retention values,
permanently deletes the database and backup directory contents, and checks free
space (at least 25 GiB free and root strictly below 25% usage). It then boots
the candidate once with MQTT disabled, proves schema 32000
and zero packet/node/observer/route/event rows, stops that proof instance, and
starts the same database and digest with the preserved production MQTT setting.
No on-host build occurs. Each start has up to 120 seconds for readiness. It
additionally requires:

- the compiled version to match `VERSION`
- candidate workflow run ID, run attempt, and run-specific tag OCI labels to
  agree with the candidate merge SHA
- the fresh database schema to match the packaged manifest
- zero packet/node/observer/route/event rows before MQTT is enabled
- `afterSeq=0` to return `resetRequired=true`
- public state to serialize successfully
- every public HTTP response to pass the bundled credential-free privacy scan
- `/ws/public` to upgrade with the configured production Origin and send a
  valid version-1 `hello` as its first text frame
- SQLite `quick_check=ok` and no foreign-key violations

The deploy script connects the scan to loopback so it proves the candidate
that is actually being cut over, while using `PUBLIC_BASE_URL` from the
preserved production `.env` as the WebSocket Origin. Node.js 18 or newer is
staged as an OS prerequisite; no npm install, browser, credential, or uploaded
data is needed.
`current.env` records the deployed digest plus the candidate workflow run ID,
run attempt, and run-specific tag read from verified OCI labels.
`deployment_succeeded` and watchdog restoration happen only after this
transaction passes. A failure enters the existing immutable-digest
rollback path; if rollback fails at any gate, the watchdog remains disabled
for explicit operator recovery.

An empty database may be ready with `datasetState=warming`. The watchdog must
not restart it merely because no RF traffic has arrived yet.

## Automatic rollback

If readiness or smoke validation fails, the script stops the candidate, deletes
its new database, and starts the supplied previous digest with another empty
database. The watchdog remains disabled if rollback also fails. Historical data
is never restored. Candidate `docker compose down` must succeed and a separate
Docker query must prove the named container is absent before rollback deletes
the new database or starts the previous digest. Failure of either check is
fail-closed: data is left in place, the previous digest is not started, and the
watchdog remains disabled for operator recovery.

Manual equivalent:

```bash
set -euo pipefail
systemctl stop mc-cartolive-watchdog.timer
MC_CARTOLIVE_IMAGE=ghcr.io/n30nex/mc-cartolive@sha256:<candidate-digest> \
  docker compose -f docker-compose.production.yml down
remaining="$(docker ps --all --quiet --filter 'name=^/meshcore-canada-live-map$')" || exit 1
test -z "$remaining"
rm -f data/meshcore-live.db data/meshcore-live.db-wal data/meshcore-live.db-shm
MC_CARTOLIVE_IMAGE=ghcr.io/n30nex/mc-cartolive@sha256:<previous-digest> \
  docker compose -f docker-compose.production.yml up -d --no-build
```

Use the scripted path whenever possible because it also verifies paths,
configuration preservation, digests, free space, and post-start state.

## Promotion and soak

Keep the candidate running for 30 minutes. Do not create `v3.2.0` if there is a
restart, OOM, `SQLITE_FULL`, busy storm, queue drop, cache failure, MQTT session
loss, public 5xx, privacy finding, or release-metadata mismatch. Once clean,
read the exact deployed digest from the mode-0600 deployment record, and use the
same candidate workflow run ID and attempt whose artifact produced that digest:

```bash
set -euo pipefail
cd /opt/MC-CartoLive
set -a
. /var/lib/mc-cartolive-deploy/current.env
set +a
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

The promotion workflow rejects lightweight tags, duplicate/missing trailers,
an annotated tag created less than 30 minutes after the recorded deployment,
an artifact name that does not exactly include that run and attempt, a manifest
digest that differs from the trailer, and a run-specific registry tag that no
longer resolves to the same digest. It promotes the exact digest without
rebuilding to `3.2.0`, `3.2`, `sha-<merge-sha>`, and `latest`, uses the candidate
manifest build time for packaged metadata, and publishes `ROLLBACK.md` as a
standalone release asset.

Repeat evidence collection after 24 hours and retention/storage checks on days
8 and 14. Install and enable `mc-cartolive-release-audit.timer` before cutover;
the packaged timer captures these phases automatically from loopback readiness,
metrics, bounded read-only SQLite checks, disk/WAL state, and watchdog state.
Inspect the mode-0600 JSON results in
`/var/log/mc-cartolive-release-audit/`; a failed phase retries hourly and keeps
the systemd service failed until a subsequent sample passes.
