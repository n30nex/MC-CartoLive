#!/usr/bin/env sh
set -eu

BASE_URL="${BASE_URL:-https://carto.canadaverse.org}"
METRICS_URL="${METRICS_URL:-http://127.0.0.1:39090/metrics}"
DURATION_MINUTES="${DURATION_MINUTES:-5}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-60}"
MAX_BAD_SAMPLES="${MAX_BAD_SAMPLES:-3}"
OUT_FILE="${OUT_FILE:-mc-cartolive-soak-$(date -u +%Y%m%d-%H%M%S).ndjson}"
ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"

command -v node >/dev/null 2>&1 || { echo "soak requires Node.js for the WebSocket flow probe" >&2; exit 2; }
ws_result="$(mktemp)"
ws_timeout_ms=$((DURATION_MINUTES * 60 * 1000))
if [ "$ws_timeout_ms" -lt 1000 ]; then ws_timeout_ms=1000; fi
node "$ROOT/scripts/websocket-flow-probe.mjs" "$BASE_URL" --origin "$BASE_URL" --timeout-ms "$ws_timeout_ms" --output "$ws_result" >/dev/null 2>&1 &
ws_pid=$!
cleanup() {
  kill "$ws_pid" >/dev/null 2>&1 || true
  rm -f "$ws_result"
}
trap cleanup EXIT INT TERM

end_at=$(( $(date -u +%s) + DURATION_MINUTES * 60 ))
sample=0
bad_samples=0
last_packets=""
first_latest_seq=""
first_accepted=""
first_processed=""
first_derived_accepted=""
first_derived_processed=""
last_accepted=""
last_processed=""
last_derived_accepted=""
last_derived_processed=""

while [ "$(date -u +%s)" -lt "$end_at" ]; do
  sample=$((sample + 1))
  now="$(date -u +%s)000"
  from="$((now - 600000))"
  health="$(mktemp)"
  ready="$(mktemp)"
  state="$(mktemp)"
  history="$(mktemp)"
  metrics="$(mktemp)"
  ok=1
  error=""

  if ! curl -fsS "$BASE_URL/healthz" >"$health"; then ok=0; error="healthz failed"; fi
  if ! curl -fsS "$BASE_URL/readyz" >"$ready"; then ok=0; error="readyz failed"; fi
  if ! curl -fsS "$BASE_URL/api/v1/public/state" >"$state"; then ok=0; error="public state failed"; fi
  if ! curl -fsS "$BASE_URL/api/v1/public/history?from=$from&to=$now&limit=25" >"$history"; then ok=0; error="public history failed"; fi
  if ! curl -fsS "$METRICS_URL" >"$metrics"; then ok=0; error="loopback metrics failed"; fi

  version="$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "$health")"
  git_sha="$(sed -n 's/.*"gitSha":"\([^"]*\)".*/\1/p' "$health")"
  packets="$(sed -n 's/.*"packets":\([0-9][0-9]*\).*/\1/p' "$state")"
  nodes="$(sed -n 's/.*"activeNodes":\([0-9][0-9]*\).*/\1/p' "$state")"
  routes="$(sed -n 's/.*"activeRoutes":\([0-9][0-9]*\).*/\1/p' "$state")"
  latest_seq="$(sed -n 's/.*"latestSeq":\([0-9][0-9]*\).*/\1/p' "$state")"
  health_ok="$(sed -n 's/.*"ok":\(true\|false\).*/\1/p' "$health")"
  ready_ok="$(sed -n 's/.*"ready":\(true\|false\).*/\1/p' "$ready")"
  dataset_state="$(sed -n 's/.*"datasetState":"\([^"]*\)".*/\1/p' "$ready")"
  storage_state="$(sed -n 's/.*"storagePressureState":"\([^"]*\)".*/\1/p' "$ready")"
  mqtt_session="$(sed -n 's/.*"mqttSessionReady":\(true\|false\).*/\1/p' "$ready")"
  history_events="$(sed -n 's/.*"count":\([0-9][0-9]*\).*/\1/p' "$history")"
  accepted="$(awk '$1 == "meshcore_mqtt_messages_accepted_total" {print $2; exit}' "$metrics")"
  processed="$(awk '$1 == "meshcore_mqtt_messages_processed_total" {print $2; exit}' "$metrics")"
  derived_accepted="$(awk '$1 == "meshcore_derived_accepted_total" {print $2; exit}' "$metrics")"
  derived_processed="$(awk '$1 == "meshcore_derived_processed_total" {print $2; exit}' "$metrics")"
  dropped="$(awk '$1 == "meshcore_mqtt_messages_dropped_total" {print $2; exit}' "$metrics")"
  derived_dropped="$(awk '$1 == "meshcore_derived_dropped_total" {print $2; exit}' "$metrics")"
  derived_failures="$(awk '$1 == "meshcore_derived_failures_total" {print $2; exit}' "$metrics")"
  cache_failures="$(awk '$1 == "meshcore_cache_refresh_failures_total" {print $2; exit}' "$metrics")"
  store_failures="$(awk '$1 == "meshcore_store_write_failures_total" {print $2; exit}' "$metrics")"
  store_full="$(awk '$1 == "meshcore_store_write_full_errors_total" {print $2; exit}' "$metrics")"
  store_busy="$(awk '$1 == "meshcore_store_write_busy_errors_total" {print $2; exit}' "$metrics")"

  [ "$health_ok" = "true" ] || ok=0
  [ "$ready_ok" = "true" ] || ok=0
  [ "$mqtt_session" = "true" ] || ok=0
  [ "$storage_state" != "critical" ] || ok=0
  case "$dataset_state" in fresh_start|warming|live) ;; *) ok=0 ;; esac
  if [ -z "$accepted" ] || [ -z "$processed" ] || [ -z "$derived_accepted" ] || [ -z "$derived_processed" ] || [ -z "$dropped" ] || [ -z "$derived_dropped" ] || [ -z "$derived_failures" ] || [ -z "$cache_failures" ] || [ -z "$store_failures" ] || [ -z "$store_full" ] || [ -z "$store_busy" ]; then ok=0; fi
  case "$accepted:$processed:$derived_accepted:$derived_processed:$dropped:$derived_dropped:$derived_failures:$cache_failures:$store_failures:$store_full:$store_busy" in *[!0-9:]*) ok=0 ;; esac
  [ "${dropped:-1}" -eq 0 ] || ok=0
  [ "${derived_dropped:-1}" -eq 0 ] || ok=0
  [ "${derived_failures:-1}" -eq 0 ] || ok=0
  [ "${cache_failures:-1}" -eq 0 ] || ok=0
  [ "${store_failures:-1}" -eq 0 ] || ok=0
  [ "${store_full:-1}" -eq 0 ] || ok=0
  [ "${store_busy:-1}" -eq 0 ] || ok=0
  if [ -n "$accepted" ] && [ -n "$processed" ] && [ "$processed" -gt "$accepted" ]; then ok=0; fi
  if [ -n "$derived_accepted" ] && [ -n "$derived_processed" ] && [ "$derived_processed" -gt "$derived_accepted" ]; then ok=0; fi
  if [ -n "$last_packets" ] && [ -n "$packets" ] && [ "$packets" -lt "$last_packets" ]; then ok=0; fi
  last_packets="$packets"
  if [ -n "${last_latest_seq:-}" ] && [ -n "$latest_seq" ] && [ "$latest_seq" -lt "$last_latest_seq" ]; then ok=0; fi
  last_latest_seq="$latest_seq"
  if [ -n "$last_accepted" ] && [ -n "$accepted" ] && [ "$accepted" -lt "$last_accepted" ]; then ok=0; fi
  if [ -n "$last_processed" ] && [ -n "$processed" ] && [ "$processed" -lt "$last_processed" ]; then ok=0; fi
  if [ -n "$last_derived_accepted" ] && [ -n "$derived_accepted" ] && [ "$derived_accepted" -lt "$last_derived_accepted" ]; then ok=0; fi
  if [ -n "$last_derived_processed" ] && [ -n "$derived_processed" ] && [ "$derived_processed" -lt "$last_derived_processed" ]; then ok=0; fi
  if [ -z "$first_latest_seq" ] && [ -n "$latest_seq" ]; then first_latest_seq="$latest_seq"; fi
  if [ -z "$first_accepted" ] && [ -n "$accepted" ]; then
    first_accepted="$accepted"
    first_processed="$processed"
    first_derived_accepted="$derived_accepted"
    first_derived_processed="$derived_processed"
  fi
  last_accepted="$accepted"
  last_processed="$processed"
  last_derived_accepted="$derived_accepted"
  last_derived_processed="$derived_processed"

  if [ "$ok" -eq 1 ]; then
    ok_json=true
    bad_samples=0
  else
    ok_json=false
    bad_samples=$((bad_samples + 1))
  fi

  printf '{"at":"%s","sample":%s,"ok":%s,"version":"%s","gitSha":"%s","packets":%s,"nodes":%s,"routes":%s,"latestSeq":%s,"mqttAccepted":%s,"mqttProcessed":%s,"mqttDropped":%s,"derivedAccepted":%s,"derivedProcessed":%s,"derivedDropped":%s,"derivedFailures":%s,"cacheRefreshFailures":%s,"storeWriteFailures":%s,"storeWriteFullErrors":%s,"storeWriteBusyErrors":%s,"datasetState":"%s","mqttSessionReady":%s,"storagePressureState":"%s","historyEvents":%s,"error":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$sample" "$ok_json" "$version" "$git_sha" "${packets:-0}" "${nodes:-0}" "${routes:-0}" "${latest_seq:-0}" "${accepted:-0}" "${processed:-0}" "${dropped:-0}" "${derived_accepted:-0}" "${derived_processed:-0}" "${derived_dropped:-0}" "${derived_failures:-0}" "${cache_failures:-0}" "${store_failures:-0}" "${store_full:-0}" "${store_busy:-0}" "$dataset_state" "${mqtt_session:-false}" "$storage_state" "${history_events:-0}" "$error" >>"$OUT_FILE"

  rm -f "$health" "$ready" "$state" "$history" "$metrics"

  echo "sample $sample: ok=$ok_json packets=${packets:-0} latestSeq=${latest_seq:-0} dataset=$dataset_state storage=$storage_state"
  if [ "$bad_samples" -ge "$MAX_BAD_SAMPLES" ]; then
    echo "soak failed after $bad_samples consecutive bad samples; output: $OUT_FILE" >&2
    exit 1
  fi
  sleep "$INTERVAL_SECONDS"
done

if wait "$ws_pid"; then ws_ok=1; else ws_ok=0; fi
if [ -z "$first_accepted" ] || [ -z "$last_accepted" ]; then
  echo "soak failed: MQTT evidence was incomplete" >&2
  exit 1
fi
if [ "$last_accepted" -gt "$first_accepted" ]; then
  if [ -z "$first_processed" ] || [ -z "$last_processed" ] || [ "$last_processed" -le "$first_processed" ]; then
    echo "soak failed: processed MQTT traffic did not advance" >&2
    exit 1
  fi
  if [ -z "$first_derived_accepted" ] || [ -z "$last_derived_accepted" ] || [ "$last_derived_accepted" -le "$first_derived_accepted" ]; then
    echo "soak failed: accepted derived projection work did not advance" >&2
    exit 1
  fi
  if [ -z "$first_derived_processed" ] || [ -z "$last_derived_processed" ] || [ "$last_derived_processed" -le "$first_derived_processed" ]; then
    echo "soak failed: processed derived projection work did not advance" >&2
    exit 1
  fi
  if [ -z "$first_latest_seq" ] || [ -z "$last_latest_seq" ] || [ "$last_latest_seq" -le "$first_latest_seq" ]; then
    echo "soak failed: public latestSeq did not advance with active traffic" >&2
    exit 1
  fi
  if [ "$ws_ok" -ne 1 ] || ! grep -q '"eventReceived":true' "$ws_result"; then
    echo "soak failed: no live WebSocket event was received while MQTT advanced" >&2
    exit 1
  fi
  echo "soak check complete: active MQTT/derived/public/WebSocket flow proven; output: $OUT_FILE"
else
  if [ "$last_accepted" -ne "$first_accepted" ]; then
    echo "soak failed: MQTT acceptance counter moved backwards" >&2
    exit 1
  fi
  if [ "$ws_ok" -ne 1 ] || ! grep -q '"helloSeq":' "$ws_result"; then
    echo "soak failed: WebSocket hello was not sustained during the quiet interval" >&2
    exit 1
  fi
  echo "soak check complete: healthy quiet interval (no MQTT acceptance change); output: $OUT_FILE"
fi
