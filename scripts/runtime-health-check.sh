#!/usr/bin/env bash
set -Eeuo pipefail

# Minute-level release monitoring deliberately avoids SQLite scans. Durable database
# integrity is checked by post-release-audit.sh against a consistent backup at
# the five-minute gate.
READY_URL="${MC_CARTOLIVE_AUDIT_READY_URL:-http://127.0.0.1:39476/readyz}"
METRICS_URL="${MC_CARTOLIVE_AUDIT_METRICS_URL:-http://127.0.0.1:39090/metrics}"
RESULT_DIR="${MC_CARTOLIVE_AUDIT_RESULT_DIR:-/var/log/mc-cartolive-release-audit}"
CONTAINER="${MC_CARTOLIVE_CONTAINER:-meshcore-canada-live-map}"

for dependency in awk curl date docker jq mktemp mkdir mv rm; do
	command -v "$dependency" >/dev/null 2>&1 || { printf 'runtime health check: missing %s\n' "$dependency" >&2; exit 2; }
done

mkdir -p "$RESULT_DIR"
tmp_dir="$(mktemp -d "$RESULT_DIR/runtime.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT
ready_file="$tmp_dir/ready.json"
metrics_file="$tmp_dir/metrics.txt"
errors_file="$tmp_dir/errors"
: >"$errors_file"

curl --fail --silent --show-error --max-time 10 --output "$ready_file" "$READY_URL" || { : >"$ready_file"; printf '%s\n' ready_request_failed >>"$errors_file"; }
curl --fail --silent --show-error --max-time 10 --output "$metrics_file" "$METRICS_URL" || { : >"$metrics_file"; printf '%s\n' metrics_request_failed >>"$errors_file"; }

ready=false
version=""
git_sha=""
if jq -e 'type == "object"' "$ready_file" >/dev/null 2>&1; then
	ready="$(jq -r '.ready == true' "$ready_file")"
	version="$(jq -r '.version // "" | tostring' "$ready_file")"
	git_sha="$(jq -r '.gitSha // "" | tostring' "$ready_file")"
	[ "$ready" = true ] || printf '%s\n' readiness_failed >>"$errors_file"
	jq -e '.dbReady == true and .mqttSessionReady == true and .publicStateReady == true and .storagePressureState == "ok"' "$ready_file" >/dev/null 2>&1 || printf '%s\n' readiness_components_failed >>"$errors_file"
else
	printf '%s\n' ready_response_invalid >>"$errors_file"
fi

metric() { awk -v wanted="$1" '$1 == wanted {print $2; exit}' "$metrics_file"; }
uint_metric() {
	value="$(metric "$1")"
	case "$value" in ''|*[!0-9]*) printf '%s\n' "metric_missing_$1" >>"$errors_file"; printf '0' ;; *) printf '%s' "$value" ;; esac
}

accepted="$(uint_metric meshcore_mqtt_messages_accepted_total)"
processed="$(uint_metric meshcore_mqtt_messages_processed_total)"
dropped="$(uint_metric meshcore_mqtt_messages_dropped_total)"
write_failures="$(uint_metric meshcore_store_write_failures_total)"
busy_failures="$(uint_metric meshcore_store_write_busy_errors_total)"
derived_drops="$(uint_metric meshcore_derived_dropped_total)"
derived_failures="$(uint_metric meshcore_derived_failures_total)"
primary_deadline_failures="$(uint_metric meshcore_primary_deadline_failures_total)"
derived_projection_failures="$(uint_metric meshcore_derived_projection_failures_total)"
derived_projection_depth="$(uint_metric meshcore_derived_projection_queue_depth)"
derived_projection_age="$(uint_metric meshcore_derived_projection_queue_oldest_age_ms)"
broadcast_latency="$(uint_metric meshcore_observation_to_broadcast_latency_ms)"
broadcast_max_latency="$(uint_metric meshcore_observation_to_broadcast_max_latency_ms)"
queue_age="$(uint_metric meshcore_mqtt_queue_oldest_item_age_ms)"
derived_age="$(uint_metric meshcore_derived_queue_oldest_item_age_ms)"

[ "$processed" -le "$accepted" ] || printf '%s\n' primary_processed_exceeds_accepted >>"$errors_file"
[ "$dropped" -eq 0 ] || printf '%s\n' primary_drops_detected >>"$errors_file"
[ "$write_failures" -eq 0 ] || printf '%s\n' write_failures_detected >>"$errors_file"
[ "$busy_failures" -eq 0 ] || printf '%s\n' sqlite_busy_failures_detected >>"$errors_file"
[ "$derived_drops" -eq 0 ] || printf '%s\n' derived_drops_detected >>"$errors_file"
[ "$derived_failures" -eq 0 ] || printf '%s\n' derived_failures_detected >>"$errors_file"
[ "$primary_deadline_failures" -eq 0 ] || printf '%s\n' primary_deadline_failures_detected >>"$errors_file"
[ "$derived_projection_failures" -eq 0 ] || printf '%s\n' derived_projection_failures_detected >>"$errors_file"
[ "$derived_projection_age" -le 5000 ] || printf '%s\n' derived_projection_queue_over_5s >>"$errors_file"
[ "$broadcast_max_latency" -le 5000 ] || printf '%s\n' broadcast_latency_over_5s >>"$errors_file"
[ "$queue_age" -le 2000 ] || printf '%s\n' primary_queue_over_2s >>"$errors_file"
[ "$derived_age" -le 2000 ] || printf '%s\n' derived_queue_over_2s >>"$errors_file"

container_status="$(docker inspect --format '{{.State.Status}}' "$CONTAINER" 2>/dev/null || true)"
container_restarts="$(docker inspect --format '{{.RestartCount}}' "$CONTAINER" 2>/dev/null || true)"
container_oom="$(docker inspect --format '{{.State.OOMKilled}}' "$CONTAINER" 2>/dev/null || true)"
[ "$container_status" = running ] || printf '%s\n' container_not_running >>"$errors_file"
[ "$container_restarts" = 0 ] || printf '%s\n' container_restarted >>"$errors_file"
[ "$container_oom" = false ] || printf '%s\n' container_oom_detected >>"$errors_file"

errors_json="$(jq -Rsc 'split("\n") | map(select(length > 0)) | unique' "$errors_file")"
passed=false
[ "$(jq 'length' <<<"$errors_json")" -eq 0 ] && passed=true
result="$tmp_dir/result.json"
jq -n --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg version "$version" --arg gitSha "$git_sha" \
	--argjson passed "$passed" --argjson errors "$errors_json" --argjson accepted "$accepted" --argjson processed "$processed" \
	--argjson queueAge "$queue_age" --argjson derivedAge "$derived_age" --argjson writeFailures "$write_failures" --argjson busyFailures "$busy_failures" \
	--argjson deadlineFailures "$primary_deadline_failures" --argjson projectionFailures "$derived_projection_failures" --argjson projectionDepth "$derived_projection_depth" --argjson projectionAge "$derived_projection_age" --argjson broadcastLatency "$broadcast_latency" --argjson broadcastMaxLatency "$broadcast_max_latency" \
	'{formatVersion:1,checkedAt:$at,passed:$passed,errors:$errors,release:{version:$version,gitSha:$gitSha},runtime:{acceptedTotal:$accepted,processedTotal:$processed,primaryQueueOldestAgeMs:$queueAge,derivedQueueOldestAgeMs:$derivedAge,writeFailuresTotal:$writeFailures,busyFailuresTotal:$busyFailures,primaryDeadlineFailuresTotal:$deadlineFailures,derivedProjectionFailuresTotal:$projectionFailures,derivedProjectionQueueDepth:$projectionDepth,derivedProjectionQueueOldestAgeMs:$projectionAge,lastBroadcastLatencyMs:$broadcastLatency,maxBroadcastLatencyMs:$broadcastMaxLatency},databaseIntegrity:"deferred_to_consistent_5m_snapshot"}' >"$result"
chmod 0600 "$result"
mv -f "$result" "$RESULT_DIR/runtime-health.latest.json"

[ "$passed" = true ] || { printf 'runtime health check failed; inspect runtime-health.latest.json\n' >&2; exit 1; }
printf 'runtime health check passed without scanning the active database\n'
