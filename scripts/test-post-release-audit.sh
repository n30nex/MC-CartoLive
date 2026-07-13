#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
TEST_VERSION="$(tr -d '\r\n' < "$ROOT/VERSION")"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/app/data" "$tmp/deploy" "$tmp/state" "$tmp/results" "$tmp/watchdog" "$tmp/snapshots"

cat >"$tmp/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
output=""
url=""
while [ "$#" -gt 0 ]; do
	case "$1" in
		--output) output="$2"; shift 2 ;;
		http://*) url="$1"; shift ;;
		*) shift ;;
	esac
done
case "$url" in
	*/readyz)
		printf '{"ready":true,"dbReady":true,"mqttSessionReady":true,"publicStateReady":true,"datasetState":"live","storagePressureState":"ok","version":"%s","gitSha":"%s"}\n' "$MOCK_READY_VERSION" "${MOCK_READY_GIT_SHA:-0123456789abcdef0123456789abcdef01234567}" >"$output"
		;;
	*/metrics)
		cat >"$output" <<METRICS
meshcore_mqtt_session_ready 1
meshcore_mqtt_queue_depth 0
meshcore_mqtt_queue_oldest_item_age_ms 0
meshcore_mqtt_messages_accepted_total 1500
meshcore_mqtt_messages_processed_total 1500
meshcore_mqtt_messages_dropped_total 0
meshcore_store_write_retries_total 0
meshcore_store_write_failures_total 0
meshcore_store_write_full_errors_total 0
meshcore_store_write_busy_errors_total 0
meshcore_store_write_last_latency_ms 4
meshcore_ingest_duplicate_suppressions_total 0
meshcore_derived_queue_depth 0
meshcore_derived_queue_oldest_item_age_ms 0
meshcore_derived_dropped_total 0
meshcore_derived_accepted_total 500
meshcore_derived_processed_total 500
meshcore_derived_failures_total 0
meshcore_cache_refresh_failures_total 0
meshcore_primary_deadline_failures_total 0
meshcore_derived_projection_failures_total 0
meshcore_derived_projection_queue_depth 0
meshcore_derived_projection_queue_oldest_age_ms 0
meshcore_observation_to_broadcast_latency_ms 25
meshcore_observation_to_broadcast_max_latency_ms 45
meshcore_uptime_seconds 90000
METRICS
		;;
	*/api/v1/public/state)
		printf '{"latestSeq":1200}\n' >"$output"
		;;
	*) exit 22 ;;
esac
EOF

cat >"$tmp/bin/sqlite3" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
query="${*: -1}"
case "$query" in
	*'.backup '*)
		target="${query#*.backup \'}"
		target="${target%\'}"
		cp "$MOCK_DATABASE" "$target"
		;;
	*'integrity_check'*) printf 'ok\n' ;;
	*'foreign_key_check'*) ;;
	*'user_version'*) printf '32000\n' ;;
	*'packet_observations'*) printf '%s\n' "$((MOCK_NOW_EPOCH * 1000 - MOCK_OBSERVATION_AGE_MS))" ;;
	*'public_events'*) printf '%s\n' "$((MOCK_NOW_EPOCH * 1000 - MOCK_EVENT_AGE_MS))" ;;
	*) exit 1 ;;
esac
EOF

cat >"$tmp/bin/stat" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = -c ] && [ "${2:-}" = %d ]; then
	case "${3:-}" in *snapshots*) printf '222\n' ;; *) printf '111\n' ;; esac
	exit 0
fi
exec /usr/bin/stat "$@"
EOF

cat >"$tmp/bin/df" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' 'Filesystem 1024-blocks Used Available Capacity Mounted on'
printf '%s\n' '/dev/mock 52428800 41943040 10485760 80% /'
EOF

cat >"$tmp/bin/docker" <<'EOF'
#!/usr/bin/env bash
case "$*" in
	*'.State.Status'*) printf 'running\n' ;;
	*'.RestartCount'*) printf '0\n' ;;
	*'.State.OOMKilled'*) printf 'false\n' ;;
	*'.Config.Image'*) printf '%s\n' 'ghcr.io/n30nex/mc-cartolive@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' ;;
	*) exit 1 ;;
esac
EOF

cat >"$tmp/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
[ "$1" = is-active ] && [ "$2" = --quiet ] && [ "$3" = mc-cartolive-watchdog.timer ]
EOF
chmod +x "$tmp/bin/"*

database="$tmp/app/data/meshcore-live.db"
truncate -s 1000 "$database"
truncate -s 100 "$database-wal"
printf 'failures=0\nrestart_1=0\nrestart_2=0\nlast_restart=0\n' >"$tmp/watchdog/state.env"
printf 'MQTT_PASSWORD=must-never-appear-in-audit-evidence\n' >"$tmp/app/.env"

deployed_epoch=2000000000
deployed_at="$(date -u -d "@$deployed_epoch" +%Y-%m-%dT%H:%M:%SZ)"
cat >"$tmp/deploy/current.env" <<EOF
MC_CARTOLIVE_IMAGE=ghcr.io/n30nex/mc-cartolive@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
MC_CARTOLIVE_PREVIOUS_IMAGE=ghcr.io/n30nex/mc-cartolive@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
MC_CARTOLIVE_DEPLOYED_AT=$deployed_at
MC_CARTOLIVE_VERSION=$TEST_VERSION
MC_CARTOLIVE_GIT_SHA=0123456789abcdef0123456789abcdef01234567
MC_CARTOLIVE_DATABASE_MODE=preserved
MC_CARTOLIVE_BASELINE_ACCEPTED_TOTAL=0
MC_CARTOLIVE_BASELINE_PROCESSED_TOTAL=0
MC_CARTOLIVE_BASELINE_PUBLIC_SEQ=0
MC_CARTOLIVE_BACKUP_VERIFICATION_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
EOF

run_audit() {
	now="$1"
	observation_age="${2:-604800000}"
	event_age="${3:-86400000}"
	PATH="$tmp/bin:$PATH" \
	MOCK_NOW_EPOCH="$now" \
	MOCK_OBSERVATION_AGE_MS="$observation_age" \
	MOCK_EVENT_AGE_MS="$event_age" \
	MOCK_READY_VERSION="${MOCK_READY_VERSION:-$TEST_VERSION}" \
	MC_CARTOLIVE_APP_DIR="$tmp/app" \
	MC_CARTOLIVE_DEPLOY_CURRENT="$tmp/deploy/current.env" \
	MC_CARTOLIVE_AUDIT_STATE_DIR="$tmp/state" \
	MC_CARTOLIVE_AUDIT_RESULT_DIR="$tmp/results" \
	MC_CARTOLIVE_DATABASE="$database" \
	MOCK_DATABASE="$database" \
	MC_CARTOLIVE_AUDIT_SNAPSHOT_DIR="$tmp/snapshots" \
	MC_CARTOLIVE_WATCHDOG_STATE="$tmp/watchdog/state.env" \
	MC_CARTOLIVE_AUDIT_NOW_EPOCH="$now" \
	bash "$ROOT/scripts/post-release-audit.sh"
}

grep -qx 'CapabilityBoundingSet=CAP_DAC_READ_SEARCH' "$ROOT/deploy/systemd/mc-cartolive-release-audit.service"
grep -qx 'ExecStart=/opt/MC-CartoLive/scripts/runtime-health-check.sh' "$ROOT/deploy/systemd/mc-cartolive-release-audit.service"
grep -q '/mnt/mc-cartolive-audit-snapshots' "$ROOT/deploy/systemd/mc-cartolive-release-audit.service"
if grep -qx 'CapabilityBoundingSet=' "$ROOT/deploy/systemd/mc-cartolive-release-audit.service"; then
	echo 'release audit service accidentally has an empty capability bounding set' >&2
	exit 1
fi

# The hourly check proves runtime health without opening SQLite.
PATH="$tmp/bin:$PATH" MOCK_READY_VERSION="$TEST_VERSION" \
	MC_CARTOLIVE_AUDIT_RESULT_DIR="$tmp/results" \
	bash "$ROOT/scripts/runtime-health-check.sh"
jq -e '.passed == true and .databaseIntegrity == "deferred_to_consistent_5m_snapshot"' "$tmp/results/runtime-health.latest.json" >/dev/null

# Readiness is not sufficient unless it identifies the deployed release.
if MOCK_READY_VERSION=9.9.9 run_audit "$((deployed_epoch + 360))" >/dev/null 2>&1; then
	echo 'audit accepted a readiness response from a different release' >&2
	exit 1
fi
identity_failure="$(find "$tmp/results" -name '*.5m.latest-failure.json' -print -quit)"
jq -e '(.errors | index("ready_version_identity_mismatch") != null) and .readiness.versionMatchesDeployment == false' "$identity_failure" >/dev/null

# The five-minute evidence is written once and contains only aggregate fields.
run_audit "$((deployed_epoch + 360))"
result_5m="$(find "$tmp/results" -name '*.5m.json' -print -quit)"
jq -e '.passed == true and .formatVersion == 2 and .phase == "5m" and .release.databaseMode == "preserved" and .readiness.versionMatchesDeployment == true and .readiness.gitShaMatchesDeployment == true and .database.integritySource == "consistent_sqlite_backup" and .database.integrityCheck == "ok" and .database.foreignKeyCheck == "ok" and (.database.snapshotSha256 | test("^[0-9a-f]{64}$")) and .ingest.acceptedSinceDeployment == 1500 and .ingest.processedSinceDeployment == 1500 and .ingest.publicEventsSinceDeployment == 1200 and .filesystem.minGateFreeGiB == 9 and .filesystem.freeBytes >= 9 * 1024 * 1024 * 1024' "$result_5m" >/dev/null
test -z "$(find "$tmp/snapshots" -type f -print -quit)"

# Re-running the timer is idempotent once the gate has passed.
before="$(sha256sum "$result_5m")"
run_audit "$((deployed_epoch + 600))"
after="$(sha256sum "$result_5m")"
[ "$before" = "$after" ]
test "$(find "$tmp/results" -name '*.json' ! -name '*.latest-failure.json' ! -name 'runtime-health.latest.json' | wc -l)" -eq 1
if grep -R -q 'must-never-appear' "$tmp/results" "$tmp/state"; then
	echo 'audit evidence contains a runtime secret' >&2
	exit 1
fi
