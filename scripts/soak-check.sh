#!/usr/bin/env sh
set -eu

BASE_URL="${BASE_URL:-https://carto.canadaverse.org}"
DURATION_MINUTES="${DURATION_MINUTES:-60}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-60}"
MAX_BAD_SAMPLES="${MAX_BAD_SAMPLES:-3}"
OUT_FILE="${OUT_FILE:-mc-cartolive-soak-$(date -u +%Y%m%d-%H%M%S).ndjson}"

end_at=$(( $(date -u +%s) + DURATION_MINUTES * 60 ))
sample=0
bad_samples=0
last_packets=""

while [ "$(date -u +%s)" -lt "$end_at" ]; do
  sample=$((sample + 1))
  now="$(date -u +%s)000"
  from="$((now - 600000))"
  health="$(mktemp)"
  ready="$(mktemp)"
  state="$(mktemp)"
  history="$(mktemp)"
  ok=1
  error=""

  if ! curl -fsS "$BASE_URL/healthz" >"$health"; then ok=0; error="healthz failed"; fi
  if ! curl -fsS "$BASE_URL/readyz" >"$ready"; then ok=0; error="readyz failed"; fi
  if ! curl -fsS "$BASE_URL/api/v1/public/state" >"$state"; then ok=0; error="public state failed"; fi
  if ! curl -fsS "$BASE_URL/api/v1/public/history?from=$from&to=$now&limit=25" >"$history"; then ok=0; error="public history failed"; fi

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

  [ "$health_ok" = "true" ] || ok=0
  [ "$ready_ok" = "true" ] || ok=0
  [ "$mqtt_session" = "true" ] || ok=0
  [ "$storage_state" != "critical" ] || ok=0
  case "$dataset_state" in fresh_start|warming|live) ;; *) ok=0 ;; esac
  if [ -n "$last_packets" ] && [ -n "$packets" ] && [ "$packets" -lt "$last_packets" ]; then ok=0; fi
  last_packets="$packets"
  if [ -n "${last_latest_seq:-}" ] && [ -n "$latest_seq" ] && [ "$latest_seq" -lt "$last_latest_seq" ]; then ok=0; fi
  last_latest_seq="$latest_seq"

  if [ "$ok" -eq 1 ]; then
    ok_json=true
    bad_samples=0
  else
    ok_json=false
    bad_samples=$((bad_samples + 1))
  fi

  printf '{"at":"%s","sample":%s,"ok":%s,"version":"%s","gitSha":"%s","packets":%s,"nodes":%s,"routes":%s,"latestSeq":%s,"datasetState":"%s","mqttSessionReady":%s,"storagePressureState":"%s","historyEvents":%s,"error":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$sample" "$ok_json" "$version" "$git_sha" "${packets:-0}" "${nodes:-0}" "${routes:-0}" "${latest_seq:-0}" "$dataset_state" "${mqtt_session:-false}" "$storage_state" "${history_events:-0}" "$error" >>"$OUT_FILE"

  rm -f "$health" "$ready" "$state" "$history"

  echo "sample $sample: ok=$ok_json packets=${packets:-0} latestSeq=${latest_seq:-0} dataset=$dataset_state storage=$storage_state"
  if [ "$bad_samples" -ge "$MAX_BAD_SAMPLES" ]; then
    echo "soak failed after $bad_samples consecutive bad samples; output: $OUT_FILE" >&2
    exit 1
  fi
  sleep "$INTERVAL_SECONDS"
done

echo "soak check complete: $OUT_FILE"
