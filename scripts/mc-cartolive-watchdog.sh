#!/usr/bin/env bash
set -u

APP_DIR="${MC_CARTOLIVE_APP_DIR:-/opt/MC-CartoLive}"
SERVICE="${MC_CARTOLIVE_SERVICE:-meshcore-live-map}"
READY_URL="${MC_CARTOLIVE_READY_URL:-http://127.0.0.1:39476/readyz}"
STATE_DIR="${MC_CARTOLIVE_STATE_DIR:-/var/lib/mc-cartolive-watchdog}"
LOG_FILE="${MC_CARTOLIVE_LOG_FILE:-/var/log/mc-cartolive-watchdog.log}"
MAX_FAILURES="${MC_CARTOLIVE_MAX_FAILURES:-3}"
MIN_RESTART_SECONDS="${MC_CARTOLIVE_MIN_RESTART_SECONDS:-600}"
MAX_CACHE_AGE_MS="${MC_CARTOLIVE_MAX_CACHE_AGE_MS:-120000}"
VERBOSE="${MC_CARTOLIVE_VERBOSE:-0}"

STATE_FILE="$STATE_DIR/state.env"
LOCK_FILE="$STATE_DIR/watchdog.lock"

mkdir -p "$STATE_DIR" "$(dirname "$LOG_FILE")"

if command -v flock >/dev/null 2>&1; then
	exec 9>"$LOCK_FILE"
	flock -n 9 || exit 0
else
	LOCK_DIR="$LOCK_FILE.d"
	if ! mkdir "$LOCK_DIR" 2>/dev/null; then
		exit 0
	fi
	trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
fi

log() {
	printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG_FILE"
}

as_int() {
	case "${1:-}" in
		''|*[!0-9]*) printf '0' ;;
		*) printf '%s' "$1" ;;
	esac
}

failures=0
last_restart=0
last_dropped=-1
if [ -f "$STATE_FILE" ]; then
	. "$STATE_FILE"
fi
failures="$(as_int "$failures")"
last_restart="$(as_int "$last_restart")"
case "${last_dropped:-}" in
	-1) ;;
	''|*[!0-9]*) last_dropped=-1 ;;
esac
MAX_FAILURES="$(as_int "$MAX_FAILURES")"
MIN_RESTART_SECONDS="$(as_int "$MIN_RESTART_SECONDS")"
MAX_CACHE_AGE_MS="$(as_int "$MAX_CACHE_AGE_MS")"
[ "$MAX_FAILURES" -gt 0 ] || MAX_FAILURES=3
[ "$MIN_RESTART_SECONDS" -gt 0 ] || MIN_RESTART_SECONDS=600
[ "$MAX_CACHE_AGE_MS" -gt 0 ] || MAX_CACHE_AGE_MS=120000

write_state() {
	cat >"$STATE_FILE" <<EOF
failures=$1
last_restart=$2
last_dropped=$3
EOF
}

tmp_body="$(mktemp)"
tmp_err="$(mktemp)"
http_code="$(curl -sS --max-time 10 -o "$tmp_body" -w '%{http_code}' "$READY_URL" 2>"$tmp_err" || true)"
json="$(cat "$tmp_body")"
curl_error="$(cat "$tmp_err")"
rm -f "$tmp_body" "$tmp_err"

json_value() {
	key="$1"
	if command -v jq >/dev/null 2>&1; then
		printf '%s' "$json" | jq -r --arg key "$key" '.[$key] // empty' 2>/dev/null
	else
		printf '%s' "$json" | tr -d '\n' | sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\\([^,}]*\\).*/\\1/p" | tr -d '"'
	fi
}

reason=""
add_reason() {
	if [ -z "$reason" ]; then
		reason="$1"
	else
		reason="$reason;$1"
	fi
}

case "$http_code" in
	2*) ;;
	000) add_reason "curl_failed=${curl_error:-unknown}" ;;
	*) add_reason "http=$http_code" ;;
esac

ready="$(json_value ready)"
public_live="$(json_value publicLiveFresh)"
packet_ingest="$(json_value packetIngestFresh)"
cache_state="$(json_value publicCacheState)"
live_confidence="$(json_value liveConfidenceState)"
mqtt_connected="$(json_value mqttConnected)"
cache_age="$(as_int "$(json_value cacheAgeMs)")"
dropped="$(as_int "$(json_value mqttDroppedMessages)")"

[ "$ready" = "true" ] || add_reason "ready=${ready:-missing}"
[ "$public_live" = "true" ] || add_reason "publicLiveFresh=${public_live:-missing}"
[ "$packet_ingest" = "true" ] || add_reason "packetIngestFresh=${packet_ingest:-missing}"
[ "$mqtt_connected" = "true" ] || add_reason "mqttConnected=${mqtt_connected:-missing}"
[ "$cache_state" != "stale" ] || add_reason "publicCacheState=stale"
[ "$live_confidence" != "degraded" ] || add_reason "liveConfidenceState=degraded"
if [ "$cache_age" -gt "$MAX_CACHE_AGE_MS" ]; then
	add_reason "cacheAgeMs=$cache_age"
fi
if [ "$last_dropped" != "-1" ] && [ "$dropped" -gt "$last_dropped" ]; then
	add_reason "mqttDroppedMessages=$last_dropped->$dropped"
fi

now="$(date +%s)"
if [ -z "$reason" ]; then
	if [ "$failures" -gt 0 ] || [ "$VERBOSE" = "1" ]; then
		log "ok ready=true publicLiveFresh=true cacheAgeMs=$cache_age mqttDroppedMessages=$dropped"
	fi
	write_state 0 "$last_restart" "$dropped"
	exit 0
fi

failures=$((failures + 1))
write_state "$failures" "$last_restart" "$dropped"
log "bad_sample failures=$failures reason=$reason"

if [ "$failures" -lt "$MAX_FAILURES" ]; then
	exit 0
fi

since_restart=$((now - last_restart))
if [ "$last_restart" -gt 0 ] && [ "$since_restart" -lt "$MIN_RESTART_SECONDS" ]; then
	log "restart_suppressed sinceLastRestartSeconds=$since_restart minRestartSeconds=$MIN_RESTART_SECONDS"
	exit 0
fi

log "restarting service=$SERVICE appDir=$APP_DIR reason=$reason"
if cd "$APP_DIR" && (docker compose restart "$SERVICE" || docker compose up -d "$SERVICE"); then
	write_state 0 "$now" 0
	log "restart_complete service=$SERVICE"
	exit 0
fi

log "restart_failed service=$SERVICE"
exit 1
