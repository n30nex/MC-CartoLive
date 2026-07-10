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
5. Resolve the tested candidate and previous image to full `@sha256:`
   references. Pull both.
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

The script pre-pulls both images, stops the watchdog, stops the writer, removes
stale release identity/runtime variables, fixes the production retention values,
permanently deletes the database and backup directory contents, and checks free
space. It then boots the candidate once with MQTT disabled, proves schema 32000
and zero packet/node/observer/route/event rows, stops that proof instance, and
starts the same database and digest with the preserved production MQTT setting.
No on-host build occurs. Each start has up to 120 seconds for readiness. It
additionally requires:

- the compiled version to match `VERSION`
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
`current.env`, `deployment_succeeded`, and watchdog restoration happen only
after this transaction passes. A failure enters the existing immutable-digest
rollback path; if rollback readiness also fails, the watchdog remains disabled
for explicit operator recovery.

An empty database may be ready with `datasetState=warming`. The watchdog must
not restart it merely because no RF traffic has arrived yet.

## Automatic rollback

If readiness or smoke validation fails, the script stops the candidate, deletes
its new database, and starts the supplied previous digest with another empty
database. The watchdog remains disabled if rollback also fails. Historical data
is never restored.

Manual equivalent:

```bash
systemctl stop mc-cartolive-watchdog.timer
MC_CARTOLIVE_IMAGE=ghcr.io/n30nex/mc-cartolive@sha256:<candidate-digest> \
  docker compose -f docker-compose.production.yml down
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
create the annotated tag at the deployed commit. GitHub Actions promotes the
candidate manifest without rebuilding and publishes the package assets.

Repeat evidence collection after 24 hours and retention/storage checks on days
8 and 14. Install and enable `mc-cartolive-release-audit.timer` before cutover;
the packaged timer captures these phases automatically from loopback readiness,
metrics, bounded read-only SQLite checks, disk/WAL state, and watchdog state.
Inspect the mode-0600 JSON results in
`/var/log/mc-cartolive-release-audit/`; a failed phase retries hourly and keeps
the systemd service failed until a subsequent sample passes.
