#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/app/data" "$tmp/deploy" "$tmp/state" "$tmp/results" "$tmp/watchdog"

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
		printf '%s\n' '{"ready":true,"dbReady":true,"mqttSessionReady":true,"publicStateReady":true,"datasetState":"live","storagePressureState":"ok"}' >"$output"
		;;
	*/metrics)
		cat >"$output" <<METRICS
meshcore_mqtt_session_ready 1
meshcore_mqtt_queue_depth 0
meshcore_mqtt_queue_oldest_item_age_ms 0
meshcore_mqtt_messages_accepted_total 500
meshcore_mqtt_messages_processed_total 500
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
meshcore_cache_refresh_failures_total 0
meshcore_uptime_seconds 90000
METRICS
		;;
	*) exit 22 ;;
esac
EOF

cat >"$tmp/bin/sqlite3" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
query="${*: -1}"
case "$query" in
	*'quick_check'*) printf 'ok\n' ;;
	*'foreign_key_check'*) ;;
	*'user_version'*) printf '32000\n' ;;
	*'packet_observations'*) printf '%s\n' "$((MOCK_NOW_EPOCH * 1000 - MOCK_OBSERVATION_AGE_MS))" ;;
	*'public_events'*) printf '%s\n' "$((MOCK_NOW_EPOCH * 1000 - MOCK_EVENT_AGE_MS))" ;;
	*) exit 1 ;;
esac
EOF

cat >"$tmp/bin/df" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' 'Filesystem 1024-blocks Used Available Capacity Mounted on'
printf '%s\n' '/dev/mock 52428800 5242880 47185920 10% /'
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
MC_CARTOLIVE_VERSION=3.2.0
MC_CARTOLIVE_GIT_SHA=0123456789abcdef0123456789abcdef01234567
EOF

run_audit() {
	now="$1"
	observation_age="${2:-604800000}"
	event_age="${3:-86400000}"
	PATH="$tmp/bin:$PATH" \
	MOCK_NOW_EPOCH="$now" \
	MOCK_OBSERVATION_AGE_MS="$observation_age" \
	MOCK_EVENT_AGE_MS="$event_age" \
	MC_CARTOLIVE_APP_DIR="$tmp/app" \
	MC_CARTOLIVE_DEPLOY_CURRENT="$tmp/deploy/current.env" \
	MC_CARTOLIVE_AUDIT_STATE_DIR="$tmp/state" \
	MC_CARTOLIVE_AUDIT_RESULT_DIR="$tmp/results" \
	MC_CARTOLIVE_DATABASE="$database" \
	MC_CARTOLIVE_WATCHDOG_STATE="$tmp/watchdog/state.env" \
	MC_CARTOLIVE_AUDIT_NOW_EPOCH="$now" \
	bash "$ROOT/scripts/post-release-audit.sh"
}

# The 24-hour evidence is written once and contains only aggregate fields.
run_audit "$((deployed_epoch + 86460))"
result_24h="$(find "$tmp/results" -name '*.24h.json' -print -quit)"
jq -e '.passed == true and .phase == "24h" and .filesystem.freeBytes >= 25 * 1024 * 1024 * 1024' "$result_24h" >/dev/null

# Day 8 rejects over-retention values and does not create a growth baseline.
if run_audit "$((deployed_epoch + 691260))" 626400001 90000001 >/dev/null 2>&1; then
	echo 'day-8 audit accepted expired hot data' >&2
	exit 1
fi
failure_day8="$(find "$tmp/results" -name '*.day8.latest-failure.json' -print -quit)"
jq -e '(.errors | index("observation_retention_out_of_bounds") != null) and (.errors | index("public_event_retention_out_of_bounds") != null)' "$failure_day8" >/dev/null
test -z "$(find "$tmp/state" -name '*.day8-baseline.env' -print -quit)"

# A valid day-8 sample records the database-plus-WAL baseline atomically.
run_audit "$((deployed_epoch + 691260))"
result_day8="$(find "$tmp/results" -name '*.day8.json' -print -quit)"
baseline="$(find "$tmp/state" -name '*.day8-baseline.env' -print -quit)"
jq -e '.passed == true and .database.databaseAndWalBytes == 1100' "$result_day8" >/dev/null
grep -qx 'database_and_wal_bytes=1100' "$baseline"

# Day 14 fails closed at 10% or greater growth, then passes below 10%.
truncate -s 1300 "$database"
truncate -s 100 "$database-wal"
if run_audit "$((deployed_epoch + 1209660))" >/dev/null 2>&1; then
	echo 'day-14 audit accepted excessive database growth' >&2
	exit 1
fi
failure_day14="$(find "$tmp/results" -name '*.day14.latest-failure.json' -print -quit)"
jq -e '.errors | index("database_growth_at_or_above_10_percent") != null' "$failure_day14" >/dev/null

truncate -s 1100 "$database"
truncate -s 90 "$database-wal"
run_audit "$((deployed_epoch + 1209660))"
result_day14="$(find "$tmp/results" -name '*.day14.json' -print -quit)"
jq -e '.passed == true and .database.day8BaselineBytes == 1100 and .database.growthBasisPoints < 1000' "$result_day14" >/dev/null

# Re-running the hourly job is idempotent once every due phase has passed.
before="$(sha256sum "$result_day14")"
run_audit "$((deployed_epoch + 1209660))"
after="$(sha256sum "$result_day14")"
[ "$before" = "$after" ]
test "$(find "$tmp/results" -name '*.json' | wc -l)" -eq 3
if grep -R -q 'must-never-appear' "$tmp/results" "$tmp/state"; then
	echo 'audit evidence contains a runtime secret' >&2
	exit 1
fi
