#!/usr/bin/env sh
set -u

CONTAINER="${MC_CARTOLIVE_CONTAINER:-meshcore-canada-live-map}"
READY_URL="${MC_CARTOLIVE_READY_URL:-http://127.0.0.1:39476/readyz}"
STATE_DIR="${MC_CARTOLIVE_STATE_DIR:-/var/lib/mc-cartolive-watchdog}"
LOG_FILE="${MC_CARTOLIVE_LOG_FILE:-/var/log/mc-cartolive-watchdog.log}"
MAX_FAILURES="${MC_CARTOLIVE_MAX_FAILURES:-3}"
MAX_RESTARTS="${MC_CARTOLIVE_MAX_RESTARTS:-2}"
RESTART_WINDOW_SECONDS="${MC_CARTOLIVE_RESTART_WINDOW_SECONDS:-21600}"
BASE_COOLDOWN_SECONDS="${MC_CARTOLIVE_BASE_COOLDOWN_SECONDS:-600}"
VERBOSE="${MC_CARTOLIVE_VERBOSE:-0}"

STATE_FILE="$STATE_DIR/state.env"
LOCK_FILE="$STATE_DIR/watchdog.lock"
mkdir -p "$STATE_DIR" "$(dirname "$LOG_FILE")"
chmod 0700 "$STATE_DIR" 2>/dev/null || true

if command -v flock >/dev/null 2>&1; then
	exec 9>"$LOCK_FILE"
	flock -n 9 || exit 0
else
	LOCK_DIR="$LOCK_FILE.d"
	if ! mkdir "$LOCK_DIR" 2>/dev/null; then exit 0; fi
	trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
fi

log() { printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG_FILE"; }
as_int() {
	case "${1:-}" in ''|*[!0-9]*) printf '0' ;; *) printf '%s' "$1" ;; esac
}

failures=0
restart_1=0
restart_2=0
last_restart=0
if [ -f "$STATE_FILE" ]; then
	# The file is root-owned/mode 0600 and every loaded value is normalized below.
	# shellcheck disable=SC1090
	. "$STATE_FILE"
fi
failures="$(as_int "$failures")"
restart_1="$(as_int "$restart_1")"
restart_2="$(as_int "$restart_2")"
last_restart="$(as_int "$last_restart")"
MAX_FAILURES="$(as_int "$MAX_FAILURES")"
MAX_RESTARTS="$(as_int "$MAX_RESTARTS")"
RESTART_WINDOW_SECONDS="$(as_int "$RESTART_WINDOW_SECONDS")"
BASE_COOLDOWN_SECONDS="$(as_int "$BASE_COOLDOWN_SECONDS")"
[ "$MAX_FAILURES" -gt 0 ] || MAX_FAILURES=3
[ "$MAX_RESTARTS" -gt 0 ] || MAX_RESTARTS=2
# The state format has two slots by design; never allow configuration to widen
# the release invariant beyond two restarts per rolling six-hour window.
[ "$MAX_RESTARTS" -le 2 ] || MAX_RESTARTS=2
[ "$RESTART_WINDOW_SECONDS" -gt 0 ] || RESTART_WINDOW_SECONDS=21600
[ "$BASE_COOLDOWN_SECONDS" -gt 0 ] || BASE_COOLDOWN_SECONDS=600

write_state() {
	state_tmp="$STATE_FILE.tmp.$$"
	cat >"$state_tmp" <<EOF
failures=$1
restart_1=$2
restart_2=$3
last_restart=$4
EOF
	chmod 0600 "$state_tmp"
	mv -f "$state_tmp" "$STATE_FILE"
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

now="$(date +%s)"
window_start=$((now - RESTART_WINDOW_SECONDS))
[ "$restart_1" -ge "$window_start" ] || restart_1=0
[ "$restart_2" -ge "$window_start" ] || restart_2=0
restart_count=0
[ "$restart_1" -gt 0 ] && restart_count=$((restart_count + 1))
[ "$restart_2" -gt 0 ] && restart_count=$((restart_count + 1))

dataset_state="$(json_value datasetState)"
storage_state="$(json_value storagePressureState)"
cache_state="$(json_value publicCacheState)"
mqtt_session="$(json_value mqttSessionReady)"
mqtt_connected="$(json_value mqttConnected)"
db_ready="$(json_value dbReady)"

# Storage pressure, an intentionally empty/warming dataset, and quiet RF traffic
# are operator conditions. Restarting cannot repair them and can make them worse.
case "$storage_state" in
	warn|critical)
		log "restart_suppressed condition=storagePressureState:$storage_state http=$http_code"
		write_state 0 "$restart_1" "$restart_2" "$last_restart"
		exit 0
		;;
esac
case "$dataset_state" in
	fresh_start|warming)
		[ "$VERBOSE" = "1" ] && log "ok condition=datasetState:$dataset_state http=$http_code"
		write_state 0 "$restart_1" "$restart_2" "$last_restart"
		exit 0
		;;
esac

reason=""
case "$http_code" in
	000|'') reason="process_unreachable:${curl_error:-unknown}" ;;
	5*) [ -n "$json" ] || reason="http_$http_code" ;;
esac
if [ -z "$reason" ]; then
	case "$cache_state" in failed|unavailable|stale) reason="public_cache_$cache_state" ;; esac
fi
if [ -z "$reason" ] && [ "$db_ready" = "false" ]; then reason="database_unavailable"; fi
if [ -z "$reason" ]; then
	if [ -n "$mqtt_session" ] && [ "$mqtt_session" = "false" ]; then
		reason="mqtt_session_unready"
	elif [ -z "$mqtt_session" ] && [ "$mqtt_connected" = "false" ]; then
		reason="mqtt_disconnected"
	fi
fi

if [ -z "$reason" ]; then
	if [ "$failures" -gt 0 ] || [ "$VERBOSE" = "1" ]; then
		log "ok http=$http_code datasetState=${dataset_state:-unknown} publicCacheState=${cache_state:-unknown}"
	fi
	write_state 0 "$restart_1" "$restart_2" "$last_restart"
	exit 0
fi

failures=$((failures + 1))
write_state "$failures" "$restart_1" "$restart_2" "$last_restart"
log "bad_sample failures=$failures reason=$reason"
[ "$failures" -ge "$MAX_FAILURES" ] || exit 0

if [ "$restart_count" -ge "$MAX_RESTARTS" ]; then
	log "restart_suppressed reason=window_limit restarts=$restart_count windowSeconds=$RESTART_WINDOW_SECONDS"
	exit 0
fi

# Exponential cooldown: 10 minutes before the first restart, 20 before the
# second. The rolling-window cap remains the primary loop guard.
cooldown=$BASE_COOLDOWN_SECONDS
[ "$restart_count" -eq 0 ] || cooldown=$((BASE_COOLDOWN_SECONDS * 2))
since_restart=$((now - last_restart))
if [ "$last_restart" -gt 0 ] && [ "$since_restart" -lt "$cooldown" ]; then
	log "restart_suppressed reason=cooldown sinceLastRestartSeconds=$since_restart cooldownSeconds=$cooldown"
	exit 0
fi

log "restarting container=$CONTAINER reason=$reason restartNumber=$((restart_count + 1))"
if docker restart "$CONTAINER" >/dev/null; then
	if [ "$restart_1" -eq 0 ]; then restart_1="$now"; else restart_2="$now"; fi
	write_state 0 "$restart_1" "$restart_2" "$now"
	log "restart_complete container=$CONTAINER"
	exit 0
fi

log "restart_failed container=$CONTAINER"
exit 1
