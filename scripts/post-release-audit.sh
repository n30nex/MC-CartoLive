#!/usr/bin/env bash
set -Eeuo pipefail

# This audit is deliberately read-only. It records only aggregate operational
# evidence and never copies database rows, runtime configuration, or secrets.
APP_DIR="${MC_CARTOLIVE_APP_DIR:-/opt/MC-CartoLive}"
DEPLOY_CURRENT="${MC_CARTOLIVE_DEPLOY_CURRENT:-/var/lib/mc-cartolive-deploy/current.env}"
STATE_DIR="${MC_CARTOLIVE_AUDIT_STATE_DIR:-/var/lib/mc-cartolive-release-audit}"
RESULT_DIR="${MC_CARTOLIVE_AUDIT_RESULT_DIR:-/var/log/mc-cartolive-release-audit}"
DATABASE="${MC_CARTOLIVE_DATABASE:-$APP_DIR/data/meshcore-live.db}"
SNAPSHOT_DIR="${MC_CARTOLIVE_AUDIT_SNAPSHOT_DIR:-/mnt/mc-cartolive-audit-snapshots}"
READY_URL="${MC_CARTOLIVE_AUDIT_READY_URL:-http://127.0.0.1:39476/readyz}"
PUBLIC_STATE_URL="${MC_CARTOLIVE_AUDIT_PUBLIC_STATE_URL:-http://127.0.0.1:39476/api/v1/public/state}"
METRICS_URL="${MC_CARTOLIVE_AUDIT_METRICS_URL:-http://127.0.0.1:39090/metrics}"
CONTAINER="${MC_CARTOLIVE_CONTAINER:-meshcore-canada-live-map}"
WATCHDOG_STATE="${MC_CARTOLIVE_WATCHDOG_STATE:-/var/lib/mc-cartolive-watchdog/state.env}"
SQL_TIMEOUT_SECONDS="${MC_CARTOLIVE_AUDIT_SQL_TIMEOUT_SECONDS:-120}"
EXPECTED_SCHEMA_VERSION="${MC_CARTOLIVE_AUDIT_SCHEMA_VERSION:-32000}"
MIN_GATE_FREE_GIB="${MC_CARTOLIVE_AUDIT_MIN_GATE_FREE_GIB:-9}"
MIN_FREE_PERCENT="${MC_CARTOLIVE_AUDIT_MIN_FREE_PERCENT:-20}"
NOW_EPOCH="${MC_CARTOLIVE_AUDIT_NOW_EPOCH:-$(date -u +%s)}"

case "$SQL_TIMEOUT_SECONDS:$EXPECTED_SCHEMA_VERSION:$MIN_GATE_FREE_GIB:$MIN_FREE_PERCENT:$NOW_EPOCH" in
	*[!0-9:]*) printf 'post-release audit: numeric configuration is invalid\n' >&2; exit 2 ;;
esac
if [ "$SQL_TIMEOUT_SECONDS" -le 0 ] || [ "$EXPECTED_SCHEMA_VERSION" -le 0 ]; then exit 2; fi
if [ "$MIN_GATE_FREE_GIB" -le 0 ] || [ "$MIN_FREE_PERCENT" -le 0 ]; then exit 2; fi

for dependency in awk cp curl date df dirname docker flock jq mktemp mv rm sha256sum sqlite3 stat systemctl timeout tr; do
	command -v "$dependency" >/dev/null 2>&1 || {
		printf 'post-release audit: required command is missing: %s\n' "$dependency" >&2
		exit 2
	}
done

[ -f "$DEPLOY_CURRENT" ] || {
	printf 'post-release audit: deployment identity is unavailable\n' >&2
	exit 2
}
[ -f "$DATABASE" ] || {
	printf 'post-release audit: production database is unavailable\n' >&2
	exit 1
}

mkdir -p "$STATE_DIR" "$RESULT_DIR"
chmod 0700 "$STATE_DIR" "$RESULT_DIR" 2>/dev/null || true
exec 9>"$STATE_DIR/audit.lock"
flock -n 9 || exit 0

read_key() {
	file="$1"
	key="$2"
	awk -F= -v wanted="$key" '$1 == wanted {sub(/^[^=]*=/, ""); print; exit}' "$file"
}

image="$(read_key "$DEPLOY_CURRENT" MC_CARTOLIVE_IMAGE)"
deployed_at="$(read_key "$DEPLOY_CURRENT" MC_CARTOLIVE_DEPLOYED_AT)"
version="$(read_key "$DEPLOY_CURRENT" MC_CARTOLIVE_VERSION)"
git_sha="$(read_key "$DEPLOY_CURRENT" MC_CARTOLIVE_GIT_SHA)"
database_mode="$(read_key "$DEPLOY_CURRENT" MC_CARTOLIVE_DATABASE_MODE)"
baseline_accepted="$(read_key "$DEPLOY_CURRENT" MC_CARTOLIVE_BASELINE_ACCEPTED_TOTAL)"
baseline_processed="$(read_key "$DEPLOY_CURRENT" MC_CARTOLIVE_BASELINE_PROCESSED_TOTAL)"
baseline_public_seq="$(read_key "$DEPLOY_CURRENT" MC_CARTOLIVE_BASELINE_PUBLIC_SEQ)"
backup_verification_sha256="$(read_key "$DEPLOY_CURRENT" MC_CARTOLIVE_BACKUP_VERIFICATION_SHA256)"
case "$image" in *@sha256:*) ;; *) printf 'post-release audit: immutable deployment identity is invalid\n' >&2; exit 2 ;; esac
image_digest="${image##*@}"
case "$image_digest" in sha256:*[!0-9a-f]*|sha256:) exit 2 ;; esac
[ "${#image_digest}" -eq 71 ] || exit 2
case "$version" in ''|*[!0-9.]*) printf 'post-release audit: release version is invalid\n' >&2; exit 2 ;; esac
[ "${#git_sha}" -eq 40 ] || { printf 'post-release audit: release Git identity is invalid\n' >&2; exit 2; }
case "$git_sha" in *[!0-9a-f]*) exit 2 ;; esac
case "$database_mode" in
	fresh|preserved) min_gate_free_gib="$MIN_GATE_FREE_GIB" ;;
	*) printf 'post-release audit: database mode is invalid\n' >&2; exit 2 ;;
esac
for baseline_value in "$baseline_accepted" "$baseline_processed" "$baseline_public_seq"; do
	case "$baseline_value" in ''|*[!0-9]*) printf 'post-release audit: deployment metric baseline is invalid\n' >&2; exit 2 ;; esac
done
if [ "$database_mode" = preserved ]; then
	case "$backup_verification_sha256" in *[!0-9a-f]*|'') printf 'post-release audit: backup verification hash is invalid\n' >&2; exit 2 ;; esac
	[ "${#backup_verification_sha256}" -eq 64 ] || exit 2
elif [ "$backup_verification_sha256" != not_required ]; then
	printf 'post-release audit: fresh deployment backup evidence must be not_required\n' >&2
	exit 2
fi
deployed_epoch="$(date -u -d "$deployed_at" +%s 2>/dev/null || true)"
case "$deployed_epoch" in ''|*[!0-9]*) printf 'post-release audit: deployment timestamp is invalid\n' >&2; exit 2 ;; esac
[ "$NOW_EPOCH" -ge "$deployed_epoch" ] || {
	printf 'post-release audit: deployment timestamp is in the future\n' >&2
	exit 2
}
deployment_age=$((NOW_EPOCH - deployed_epoch))
deployment_key="$(printf '%s\n%s\n%s\n' "$image_digest" "$git_sha" "$deployed_at" | sha256sum | awk '{print substr($1, 1, 20)}')"

due_phases=()
phase_result() { printf '%s/%s.%s.json' "$RESULT_DIR" "$deployment_key" "$1"; }
if [ "$deployment_age" -ge 300 ] && [ ! -f "$(phase_result 5m)" ]; then due_phases+=(5m); fi
[ "${#due_phases[@]}" -gt 0 ] || exit 0

tmp_dir="$(mktemp -d "$STATE_DIR/audit.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT
common_errors="$tmp_dir/common-errors"
: >"$common_errors"
add_common_error() { printf '%s\n' "$1" >>"$common_errors"; }

ready_file="$tmp_dir/ready.json"
public_state_file="$tmp_dir/public-state.json"
metrics_file="$tmp_dir/metrics.txt"
if ! curl --fail --silent --show-error --max-time 10 --output "$ready_file" "$READY_URL"; then
	: >"$ready_file"
	add_common_error ready_request_failed
fi
if ! curl --fail --silent --show-error --max-time 10 --output "$metrics_file" "$METRICS_URL"; then
	: >"$metrics_file"
	add_common_error metrics_request_failed
fi
if ! curl --fail --silent --show-error --max-time 10 --output "$public_state_file" "$PUBLIC_STATE_URL"; then
	: >"$public_state_file"
	add_common_error public_state_request_failed
fi

ready=false
dataset_state=unknown
storage_state=unknown
mqtt_session_ready=false
db_ready=false
cache_state=unknown
public_state_ready=false
ready_version=""
ready_git_sha=""
ready_version_matches=false
ready_git_sha_matches=false
if jq -e 'type == "object"' "$ready_file" >/dev/null 2>&1; then
	ready="$(jq -r '.ready == true' "$ready_file")"
	dataset_state="$(jq -r '.datasetState // "unknown" | tostring' "$ready_file")"
	storage_state="$(jq -r '.storagePressureState // "unknown" | tostring' "$ready_file")"
	mqtt_session_ready="$(jq -r '.mqttSessionReady == true' "$ready_file")"
	db_ready="$(jq -r '.dbReady == true' "$ready_file")"
	public_state_ready="$(jq -r '.publicStateReady == true' "$ready_file")"
	ready_version="$(jq -r '.version // "" | tostring' "$ready_file")"
	ready_git_sha="$(jq -r '.gitSha // "" | tostring' "$ready_file")"
	if [ "$ready_version" = "$version" ]; then ready_version_matches=true; fi
	if [ "$ready_git_sha" = "$git_sha" ]; then ready_git_sha_matches=true; fi
	if [ "$public_state_ready" = true ]; then cache_state=ready; else cache_state=unready; fi
else
	add_common_error ready_response_invalid
fi
[ "$ready" = true ] || add_common_error readiness_failed
[ "$db_ready" = true ] || add_common_error database_not_ready
[ "$mqtt_session_ready" = true ] || add_common_error mqtt_session_not_ready
[ "$public_state_ready" = true ] || add_common_error public_state_not_ready
[ "$ready_version_matches" = true ] || add_common_error ready_version_identity_mismatch
[ "$ready_git_sha_matches" = true ] || add_common_error ready_git_identity_mismatch
case "$storage_state" in ok) ;; warn|critical) add_common_error storage_pressure_not_ok ;; *) storage_state=unknown; add_common_error storage_pressure_invalid ;; esac
case "$dataset_state" in fresh_start|warming|live) ;; *) dataset_state=unknown; add_common_error dataset_state_invalid ;; esac

metric() {
	awk -v wanted="$1" '$1 == wanted {print $2; exit}' "$metrics_file"
}
uint_metric() {
	value="$(metric "$1")"
	case "$value" in ''|*[!0-9]*) add_common_error "metric_missing_$1"; printf '0' ;; *) printf '%s' "$value" ;; esac
}

mqtt_ready_metric="$(uint_metric meshcore_mqtt_session_ready)"
queue_depth="$(uint_metric meshcore_mqtt_queue_depth)"
queue_age_ms="$(uint_metric meshcore_mqtt_queue_oldest_item_age_ms)"
accepted_total="$(uint_metric meshcore_mqtt_messages_accepted_total)"
processed_total="$(uint_metric meshcore_mqtt_messages_processed_total)"
dropped_total="$(uint_metric meshcore_mqtt_messages_dropped_total)"
write_retries_total="$(uint_metric meshcore_store_write_retries_total)"
write_failures_total="$(uint_metric meshcore_store_write_failures_total)"
full_errors_total="$(uint_metric meshcore_store_write_full_errors_total)"
busy_errors_total="$(uint_metric meshcore_store_write_busy_errors_total)"
write_latency_ms="$(uint_metric meshcore_store_write_last_latency_ms)"
duplicate_total="$(uint_metric meshcore_ingest_duplicate_suppressions_total)"
derived_depth="$(uint_metric meshcore_derived_queue_depth)"
derived_age_ms="$(uint_metric meshcore_derived_queue_oldest_item_age_ms)"
derived_dropped_total="$(uint_metric meshcore_derived_dropped_total)"
derived_accepted_total="$(uint_metric meshcore_derived_accepted_total)"
derived_processed_total="$(uint_metric meshcore_derived_processed_total)"
derived_failures_total="$(uint_metric meshcore_derived_failures_total)"
cache_failures_total="$(uint_metric meshcore_cache_refresh_failures_total)"
primary_deadline_failures_total="$(uint_metric meshcore_primary_deadline_failures_total)"
derived_projection_failures_total="$(uint_metric meshcore_derived_projection_failures_total)"
derived_projection_depth="$(uint_metric meshcore_derived_projection_queue_depth)"
derived_projection_age_ms="$(uint_metric meshcore_derived_projection_queue_oldest_age_ms)"
broadcast_latency_ms="$(uint_metric meshcore_observation_to_broadcast_latency_ms)"
broadcast_max_latency_ms="$(uint_metric meshcore_observation_to_broadcast_max_latency_ms)"
uptime_seconds="$(uint_metric meshcore_uptime_seconds)"
current_public_seq="$(jq -r '.latestSeq // 0' "$public_state_file" 2>/dev/null || printf '0')"
case "$current_public_seq" in ''|*[!0-9]*) current_public_seq=0; add_common_error public_state_sequence_invalid ;; esac
accepted_since_deploy=$((accepted_total - baseline_accepted))
processed_since_deploy=$((processed_total - baseline_processed))
public_events_since_deploy=$((current_public_seq - baseline_public_seq))
[ "$accepted_since_deploy" -ge 0 ] || { accepted_since_deploy=0; add_common_error accepted_counter_reset; }
[ "$processed_since_deploy" -ge 0 ] || { processed_since_deploy=0; add_common_error processed_counter_reset; }
[ "$public_events_since_deploy" -ge 0 ] || { public_events_since_deploy=0; add_common_error public_sequence_reset; }
[ "$mqtt_ready_metric" -eq 1 ] || add_common_error mqtt_session_metric_not_ready
[ "$queue_age_ms" -le 2000 ] || add_common_error primary_queue_oldest_over_2s
[ "$derived_age_ms" -le 2000 ] || add_common_error derived_queue_oldest_over_2s
[ "$write_latency_ms" -le 5000 ] || add_common_error sqlite_write_latency_over_5s
[ "$dropped_total" -eq 0 ] || add_common_error primary_queue_drops_detected
[ "$processed_total" -le "$accepted_total" ] || add_common_error primary_processed_exceeds_accepted
[ "$write_failures_total" -eq 0 ] || add_common_error sqlite_write_failures_detected
[ "$full_errors_total" -eq 0 ] || add_common_error sqlite_full_errors_detected
[ "$busy_errors_total" -eq 0 ] || add_common_error sqlite_busy_failures_detected
[ "$derived_dropped_total" -eq 0 ] || add_common_error derived_queue_drops_detected
[ "$derived_processed_total" -le "$derived_accepted_total" ] || add_common_error derived_processed_exceeds_accepted
[ "$derived_failures_total" -eq 0 ] || add_common_error derived_projection_failures_detected
[ "$cache_failures_total" -eq 0 ] || add_common_error cache_refresh_failures_detected
[ "$primary_deadline_failures_total" -eq 0 ] || add_common_error primary_deadline_failures_detected
[ "$derived_projection_failures_total" -eq 0 ] || add_common_error derived_projection_failures_detected
[ "$derived_projection_age_ms" -le 5000 ] || add_common_error derived_projection_queue_oldest_over_5s
[ "$broadcast_max_latency_ms" -le 5000 ] || add_common_error observation_to_broadcast_latency_over_5s

integrity_check=not_run
foreign_key_check=not_run
integrity_source=not_run
snapshot_sha256=""
snapshot_bytes=0
schema_version=0
oldest_observation_ms=""
oldest_event_ms=""
if [ "$ready" = true ] && [ "$storage_state" = ok ] && [ "$queue_age_ms" -le 2000 ] && [ "$derived_age_ms" -le 2000 ]; then
schema_version="$(timeout "$SQL_TIMEOUT_SECONDS" sqlite3 -batch -readonly -cmd '.timeout 5000' "$DATABASE" 'PRAGMA user_version;' 2>/dev/null || true)"
case "$schema_version" in ''|*[!0-9]*) schema_version=0 ;; esac
[ "$schema_version" -eq "$EXPECTED_SCHEMA_VERSION" ] || add_common_error sqlite_schema_version_mismatch
if timeout "$SQL_TIMEOUT_SECONDS" sqlite3 -batch -readonly -cmd '.timeout 5000' "$DATABASE" \
	'SELECT heard_at_ms FROM packet_observations ORDER BY heard_at_ms ASC LIMIT 1;' >"$tmp_dir/oldest-observation" 2>/dev/null; then
	oldest_observation_ms="$(tr -d '\r\n' <"$tmp_dir/oldest-observation")"
else
	oldest_observation_ms=""
	add_common_error observation_retention_query_failed
fi
if timeout "$SQL_TIMEOUT_SECONDS" sqlite3 -batch -readonly -cmd '.timeout 5000' "$DATABASE" \
	'SELECT occurred_at_ms FROM public_events ORDER BY occurred_at_ms ASC LIMIT 1;' >"$tmp_dir/oldest-event" 2>/dev/null; then
	oldest_event_ms="$(tr -d '\r\n' <"$tmp_dir/oldest-event")"
else
	oldest_event_ms=""
	add_common_error public_event_retention_query_failed
fi
case "$oldest_observation_ms" in '') ;; *[!0-9]*) oldest_observation_ms=""; add_common_error observation_retention_value_invalid ;; esac
case "$oldest_event_ms" in '') ;; *[!0-9]*) oldest_event_ms=""; add_common_error public_event_retention_value_invalid ;; esac
else
	add_common_error sqlite_audit_deferred_due_runtime_pressure
fi

if ! database_bytes="$(stat -c %s "$DATABASE" 2>/dev/null)"; then database_bytes=0; add_common_error database_size_unavailable; fi
wal_bytes=0
if [ -f "$DATABASE-wal" ] && ! wal_bytes="$(stat -c %s "$DATABASE-wal" 2>/dev/null)"; then wal_bytes=0; add_common_error wal_size_unavailable; fi
case "$database_bytes:$wal_bytes" in *[!0-9:]*) database_bytes=0; wal_bytes=0; add_common_error database_size_unavailable ;; esac
database_and_wal_bytes=$((database_bytes + wal_bytes))

run_gate_integrity=false
for due_phase in "${due_phases[@]}"; do
	[ "$due_phase" = 5m ] && run_gate_integrity=true
done
if [ "$run_gate_integrity" = true ]; then
	if [ "$ready" != true ] || [ "$storage_state" != ok ] || [ "$queue_age_ms" -gt 2000 ] || [ "$derived_age_ms" -gt 2000 ]; then
		add_common_error snapshot_integrity_deferred_due_runtime_pressure
	elif [ ! -d "$SNAPSHOT_DIR" ] || [ -L "$SNAPSHOT_DIR" ]; then
		add_common_error snapshot_directory_unavailable
	else
		snapshot_dir="$(CDPATH='' cd "$SNAPSHOT_DIR" && pwd -P)"
		case "$snapshot_dir" in *[!A-Za-z0-9_./-]*) add_common_error snapshot_directory_path_unsafe; snapshot_dir="" ;; esac
		if [ -n "$snapshot_dir" ]; then
			database_device="$(stat -c %d "$DATABASE" 2>/dev/null || true)"
			snapshot_device="$(stat -c %d "$snapshot_dir" 2>/dev/null || true)"
			if [ -z "$database_device" ] || [ -z "$snapshot_device" ] || [ "$database_device" = "$snapshot_device" ]; then
				add_common_error snapshot_directory_not_separate_filesystem
			else
				snapshot_free_kib="$(df -Pk "$snapshot_dir" 2>/dev/null | awk 'NR > 1 {line=$0} END {print line}' | awk '{print $4}')"
				case "$snapshot_free_kib" in ''|*[!0-9]*) snapshot_free_kib=0 ;; esac
				required_snapshot_bytes=$((database_bytes + wal_bytes + 536870912))
				if [ $((snapshot_free_kib * 1024)) -lt "$required_snapshot_bytes" ]; then
					add_common_error snapshot_filesystem_space_insufficient
				else
					snapshot_path="$snapshot_dir/$deployment_key.5m.$$.db"
					rm -f -- "$snapshot_path"
					if timeout "$SQL_TIMEOUT_SECONDS" sqlite3 -batch -readonly -cmd '.timeout 5000' "$DATABASE" ".backup '$snapshot_path'" >/dev/null 2>&1 && [ -f "$snapshot_path" ]; then
						chmod 0600 "$snapshot_path"
						integrity_source=consistent_sqlite_backup
						snapshot_bytes="$(stat -c %s "$snapshot_path" 2>/dev/null || printf '0')"
						snapshot_sha256="$(sha256sum "$snapshot_path" | awk '{print $1}')"
						if timeout "$SQL_TIMEOUT_SECONDS" sqlite3 -batch -readonly -cmd '.timeout 5000' "$snapshot_path" 'PRAGMA integrity_check;' >"$tmp_dir/integrity" 2>/dev/null; then
							if [ "$(tr -d '\r\n' <"$tmp_dir/integrity")" = ok ]; then integrity_check=ok; else integrity_check=failed; fi
						fi
						[ "$integrity_check" = ok ] || add_common_error sqlite_snapshot_integrity_check_failed
						if timeout "$SQL_TIMEOUT_SECONDS" sqlite3 -batch -readonly -cmd '.timeout 5000' "$snapshot_path" \
							'SELECT "violation" FROM pragma_foreign_key_check LIMIT 1;' >"$tmp_dir/fk" 2>/dev/null; then
							if [ ! -s "$tmp_dir/fk" ]; then foreign_key_check=ok; else foreign_key_check=failed; fi
						fi
						[ "$foreign_key_check" = ok ] || add_common_error sqlite_snapshot_foreign_key_check_failed
						snapshot_schema="$(timeout "$SQL_TIMEOUT_SECONDS" sqlite3 -batch -readonly -cmd '.timeout 5000' "$snapshot_path" 'PRAGMA user_version;' 2>/dev/null || true)"
						[ "$snapshot_schema" = "$EXPECTED_SCHEMA_VERSION" ] || add_common_error sqlite_snapshot_schema_version_mismatch
					else
						add_common_error sqlite_consistent_backup_failed
					fi
					rm -f -- "$snapshot_path"
				fi
			fi
		fi
	fi
fi

df_line="$(df -Pk "$(dirname "$DATABASE")" 2>/dev/null | awk 'NR > 1 {line=$0} END {print line}' || true)"
free_kib="$(printf '%s\n' "$df_line" | awk '{print $4}')"
used_percent="$(printf '%s\n' "$df_line" | awk '{gsub(/%/, "", $5); print $5}')"
case "$free_kib:$used_percent" in *[!0-9:]*) free_kib=0; used_percent=100; add_common_error filesystem_capacity_unavailable ;; esac
free_bytes=$((free_kib * 1024))
free_percent=$((100 - used_percent))
[ "$free_percent" -ge "$MIN_FREE_PERCENT" ] || add_common_error filesystem_free_percent_low

container_status="$(timeout 10 docker inspect --format '{{.State.Status}}' "$CONTAINER" 2>/dev/null || true)"
container_restarts="$(timeout 10 docker inspect --format '{{.RestartCount}}' "$CONTAINER" 2>/dev/null || true)"
container_oom="$(timeout 10 docker inspect --format '{{.State.OOMKilled}}' "$CONTAINER" 2>/dev/null || true)"
container_image="$(timeout 10 docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || true)"
container_identity_matches=false
if [ "$container_image" = "$image" ]; then container_identity_matches=true; else add_common_error container_image_identity_mismatch; fi
case "$container_restarts" in ''|*[!0-9]*) container_restarts=0; add_common_error container_restart_count_unavailable ;; esac
case "$container_status" in running|created|exited|restarting|dead|paused|removing) ;; *) container_status=unknown ;; esac
case "$container_oom" in
	false) container_oom_json=false ;;
	true) container_oom_json=true; add_common_error container_oom_detected ;;
	*) container_oom_json=null; add_common_error container_oom_state_unavailable ;;
esac
[ "$container_status" = running ] || add_common_error container_not_running
[ "$container_restarts" -eq 0 ] || add_common_error container_restarts_detected

watchdog_timer_active=false
if timeout 10 systemctl is-active --quiet mc-cartolive-watchdog.timer; then watchdog_timer_active=true; else add_common_error watchdog_timer_inactive; fi
watchdog_failures=0
watchdog_restart_1=0
watchdog_restart_2=0
if [ -f "$WATCHDOG_STATE" ]; then
	watchdog_failures="$(read_key "$WATCHDOG_STATE" failures)"
	watchdog_restart_1="$(read_key "$WATCHDOG_STATE" restart_1)"
	watchdog_restart_2="$(read_key "$WATCHDOG_STATE" restart_2)"
else
	add_common_error watchdog_state_unavailable
fi
case "$watchdog_failures:$watchdog_restart_1:$watchdog_restart_2" in
	*[!0-9:]*) watchdog_failures=0; watchdog_restart_1=0; watchdog_restart_2=0; add_common_error watchdog_state_invalid ;;
esac
[ "$watchdog_failures" -eq 0 ] || add_common_error watchdog_failures_pending
watchdog_recent_restarts=0
window_start=$((NOW_EPOCH - 21600))
[ "$watchdog_restart_1" -lt "$window_start" ] || watchdog_recent_restarts=$((watchdog_recent_restarts + 1))
[ "$watchdog_restart_2" -lt "$window_start" ] || watchdog_recent_restarts=$((watchdog_recent_restarts + 1))
[ "$watchdog_recent_restarts" -eq 0 ] || add_common_error watchdog_restart_in_last_6h

now_ms=$((NOW_EPOCH * 1000))
observation_age_json=null
event_age_json=null
if [ -n "$oldest_observation_ms" ]; then observation_age_json=$((now_ms - oldest_observation_ms)); fi
if [ -n "$oldest_event_ms" ]; then event_age_json=$((now_ms - oldest_event_ms)); fi

status=0
write_phase_result() {
	phase="$1"
	phase_errors="$tmp_dir/errors-$phase"
	cp "$common_errors" "$phase_errors"
	min_free_bytes=$((min_gate_free_gib * 1024 * 1024 * 1024))
	[ "$free_bytes" -ge "$min_free_bytes" ] || printf '%s\n' filesystem_free_below_5m_gate >>"$phase_errors"
	[ "$accepted_since_deploy" -ge 1000 ] || printf '%s\n' accepted_messages_below_5m_gate >>"$phase_errors"
	[ "$processed_since_deploy" -ge 1000 ] || printf '%s\n' processed_messages_below_5m_gate >>"$phase_errors"

	errors_json="$(jq -Rsc 'split("\n") | map(select(length > 0)) | unique' "$phase_errors")"
	passed=false
	if [ "$(jq 'length' <<<"$errors_json")" -eq 0 ]; then passed=true; fi
	completed_at="$(date -u -d "@$NOW_EPOCH" +%Y-%m-%dT%H:%M:%SZ)"
	result_tmp="$tmp_dir/result-$phase.json"
	jq -n \
		--arg phase "$phase" --arg completedAt "$completed_at" --arg deployedAt "$deployed_at" \
		--arg version "$version" --arg gitSha "$git_sha" --arg imageDigest "$image_digest" --arg databaseMode "$database_mode" --arg backupVerificationSha256 "$backup_verification_sha256" \
		--arg datasetState "$dataset_state" --arg storageState "$storage_state" --arg cacheState "$cache_state" \
		--arg containerStatus "$container_status" --arg integrityCheck "$integrity_check" --arg foreignKeyCheck "$foreign_key_check" --arg integritySource "$integrity_source" --arg snapshotSha256 "$snapshot_sha256" \
		--argjson passed "$passed" --argjson errors "$errors_json" --argjson deploymentAgeSeconds "$deployment_age" \
		--argjson ready "$ready" --argjson dbReady "$db_ready" --argjson mqttSessionReady "$mqtt_session_ready" --argjson publicStateReady "$public_state_ready" \
		--argjson versionMatches "$ready_version_matches" --argjson gitShaMatches "$ready_git_sha_matches" \
		--argjson schemaVersion "$schema_version" --argjson observationAgeMs "$observation_age_json" \
		--argjson publicEventAgeMs "$event_age_json" --argjson databaseBytes "$database_bytes" \
		--argjson walBytes "$wal_bytes" --argjson databaseAndWalBytes "$database_and_wal_bytes" --argjson snapshotBytes "$snapshot_bytes" \
		--argjson freeBytes "$free_bytes" --argjson freePercent "$free_percent" --argjson minGateFreeGiB "$min_gate_free_gib" \
		--argjson queueDepth "$queue_depth" --argjson queueOldestAgeMs "$queue_age_ms" \
		--argjson accepted "$accepted_total" --argjson processed "$processed_total" --argjson dropped "$dropped_total" \
		--argjson acceptedSinceDeploy "$accepted_since_deploy" --argjson processedSinceDeploy "$processed_since_deploy" --argjson publicEventsSinceDeploy "$public_events_since_deploy" --argjson baselinePublicSeq "$baseline_public_seq" \
		--argjson writeRetries "$write_retries_total" --argjson writeFailures "$write_failures_total" \
		--argjson fullErrors "$full_errors_total" --argjson busyErrors "$busy_errors_total" \
		--argjson writeLatencyMs "$write_latency_ms" --argjson duplicateSuppressions "$duplicate_total" \
		--argjson derivedDepth "$derived_depth" --argjson derivedOldestAgeMs "$derived_age_ms" \
		--argjson derivedDropped "$derived_dropped_total" --argjson cacheFailures "$cache_failures_total" \
		--argjson derivedAccepted "$derived_accepted_total" --argjson derivedProcessed "$derived_processed_total" --argjson derivedFailures "$derived_failures_total" \
		--argjson primaryDeadlineFailures "$primary_deadline_failures_total" --argjson derivedProjectionFailures "$derived_projection_failures_total" --argjson broadcastLatency "$broadcast_latency_ms" \
		--argjson broadcastMaxLatency "$broadcast_max_latency_ms" \
		--argjson derivedProjectionDepth "$derived_projection_depth" --argjson derivedProjectionAge "$derived_projection_age_ms" \
		--argjson uptimeSeconds "$uptime_seconds" --argjson containerRestarts "$container_restarts" --argjson containerIdentityMatches "$container_identity_matches" \
		--argjson containerOOM "$container_oom_json" --argjson watchdogTimerActive "$watchdog_timer_active" \
		--argjson watchdogFailures "$watchdog_failures" --argjson watchdogRecentRestarts "$watchdog_recent_restarts" \
		'{formatVersion:2,phase:$phase,completedAt:$completedAt,passed:$passed,errors:$errors,release:{version:$version,gitSha:$gitSha,imageDigest:$imageDigest,deployedAt:$deployedAt,deploymentAgeSeconds:$deploymentAgeSeconds,databaseMode:$databaseMode,backupVerificationSha256:$backupVerificationSha256},readiness:{ready:$ready,dbReady:$dbReady,mqttSessionReady:$mqttSessionReady,publicStateReady:$publicStateReady,versionMatchesDeployment:$versionMatches,gitShaMatchesDeployment:$gitShaMatches,datasetState:$datasetState,storagePressureState:$storageState,publicCacheState:$cacheState},database:{schemaVersion:$schemaVersion,integritySource:$integritySource,integrityCheck:$integrityCheck,foreignKeyCheck:$foreignKeyCheck,snapshotSha256:(if $snapshotSha256 == "" then null else $snapshotSha256 end),snapshotBytes:$snapshotBytes,oldestObservationAgeMs:$observationAgeMs,oldestPublicEventAgeMs:$publicEventAgeMs,databaseBytes:$databaseBytes,walBytes:$walBytes,databaseAndWalBytes:$databaseAndWalBytes},filesystem:{freeBytes:$freeBytes,freePercent:$freePercent,minGateFreeGiB:$minGateFreeGiB},ingest:{queueDepth:$queueDepth,queueOldestItemAgeMs:$queueOldestAgeMs,acceptedTotal:$accepted,processedTotal:$processed,acceptedSinceDeployment:$acceptedSinceDeploy,processedSinceDeployment:$processedSinceDeploy,publicEventsSinceDeployment:$publicEventsSinceDeploy,baselinePublicSeq:$baselinePublicSeq,droppedTotal:$dropped,writeRetriesTotal:$writeRetries,writeFailuresTotal:$writeFailures,fullErrorsTotal:$fullErrors,busyErrorsTotal:$busyErrors,primaryDeadlineFailuresTotal:$primaryDeadlineFailures,derivedProjectionFailuresTotal:$derivedProjectionFailures,derivedProjectionQueueDepth:$derivedProjectionDepth,derivedProjectionQueueOldestAgeMs:$derivedProjectionAge,lastBroadcastLatencyMs:$broadcastLatency,maxBroadcastLatencyMs:$broadcastMaxLatency,lastWriteLatencyMs:$writeLatencyMs,duplicateSuppressionsTotal:$duplicateSuppressions,derivedQueueDepth:$derivedDepth,derivedQueueOldestItemAgeMs:$derivedOldestAgeMs,derivedAcceptedTotal:$derivedAccepted,derivedProcessedTotal:$derivedProcessed,derivedDroppedTotal:$derivedDropped,derivedFailuresTotal:$derivedFailures,cacheRefreshFailuresTotal:$cacheFailures},process:{uptimeSeconds:$uptimeSeconds,containerStatus:$containerStatus,containerRestartCount:$containerRestarts,containerIdentityMatches:$containerIdentityMatches,oomKilled:$containerOOM},watchdog:{timerActive:$watchdogTimerActive,pendingFailures:$watchdogFailures,restartsInLastSixHours:$watchdogRecentRestarts}}' >"$result_tmp"
	chmod 0600 "$result_tmp"
	if [ "$passed" = true ]; then
		mv -f "$result_tmp" "$(phase_result "$phase")"
		rm -f "$RESULT_DIR/$deployment_key.$phase.latest-failure.json"
		printf 'post-release audit: phase=%s passed result=%s\n' "$phase" "$(phase_result "$phase")"
		return 0
	fi
	mv -f "$result_tmp" "$RESULT_DIR/$deployment_key.$phase.latest-failure.json"
	printf 'post-release audit: phase=%s failed; inspect the privacy-safe result\n' "$phase" >&2
	status=1
}

for phase in "${due_phases[@]}"; do
	write_phase_result "$phase"
done
exit "$status"
