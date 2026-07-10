#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
DIGEST="ghcr.io/n30nex/mc-cartolive@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
PREVIOUS="ghcr.io/n30nex/mc-cartolive@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
MERGE_SHA="0123456789abcdef0123456789abcdef01234567"

"$ROOT/scripts/deploy.sh" --help >/dev/null
if "$ROOT/scripts/deploy.sh" --image latest >/dev/null 2>&1; then
	echo "deploy accepted a mutable image" >&2
	exit 1
fi
if "$ROOT/scripts/deploy.sh" --image "$DIGEST" --fresh-database >/dev/null 2>&1; then
	echo "deploy accepted destructive mode without confirmation and rollback digest" >&2
	exit 1
fi
if "$ROOT/scripts/deploy.sh" --image "$DIGEST" --previous-image "$PREVIOUS" >/dev/null 2>&1; then
	echo "deploy accepted a candidate without the expected merge SHA" >&2
	exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/state" "$tmp/data"

cat >"$tmp/bin/curl" <<'EOF'
#!/usr/bin/env sh
out=""
code="${MOCK_HTTP_CODE:-200}"
while [ "$#" -gt 0 ]; do
	case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac
done
printf '%s' "$MOCK_JSON" >"$out"
printf '%s' "$code"
[ "$code" != 000 ]
EOF
cat >"$tmp/bin/docker" <<'EOF'
#!/usr/bin/env sh
case "${1:-}" in
	logs) printf '%s' "${MOCK_RECENT_LOGS:-}"; exit "${MOCK_LOG_STATUS:-0}" ;;
	restart) printf '%s\n' "$*" >>"$MOCK_DOCKER_LOG"; exit 0 ;;
	*) exit 1 ;;
esac
EOF
cat >"$tmp/bin/df" <<'EOF'
#!/usr/bin/env sh
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf 'mock %s 1 %s 1%% /\n' "${MOCK_TOTAL_KB:-1000}" "${MOCK_FREE_KB:-800}"
EOF
chmod +x "$tmp/bin/curl" "$tmp/bin/docker" "$tmp/bin/df"

run_watchdog() {
	MOCK_JSON="$1" \
	MOCK_HTTP_CODE="${2:-200}" \
	MOCK_RECENT_LOGS="${3:-}" \
	MOCK_TOTAL_KB="${4:-1000}" \
	MOCK_FREE_KB="${5:-800}" \
	MOCK_LOG_STATUS=0 \
	MOCK_DOCKER_LOG="$tmp/docker.log" \
	MC_CARTOLIVE_STATE_DIR="$tmp/state" \
	MC_CARTOLIVE_LOG_FILE="$tmp/watchdog.log" \
	MC_CARTOLIVE_BASE_COOLDOWN_SECONDS=1 \
	MC_CARTOLIVE_DATA_DIR="$tmp/data" \
	PATH="$tmp/bin:$PATH" \
	sh "$ROOT/scripts/mc-cartolive-watchdog.sh"
}

run_watchdog '{"ready":true,"reasons":[],"datasetState":"warming","storagePressureState":"ok","mqttSessionReady":true,"dbReady":true}'
run_watchdog '{"ready":false,"reasons":["storage_critical","public_cache_stale_or_failed"],"datasetState":"live","storagePressureState":"critical","mqttSessionReady":true,"dbReady":false}'
run_watchdog '{"ready":true,"reasons":[],"datasetState":"live","storagePressureState":"ok","mqttSessionReady":true,"dbReady":true}'
test ! -s "$tmp/docker.log"

# An unreachable process is not restarted when the independent data-filesystem
# probe is pressured or bounded recent logs show a full-disk failure.
for _ in 1 2 3; do run_watchdog '' 000 '' 1000 100; done
test ! -s "$tmp/docker.log"
grep -q 'condition=data_filesystem_pressure' "$tmp/watchdog.log"
run_watchdog '' 000 '' 0 800
test ! -s "$tmp/docker.log"
grep -q 'condition=data_filesystem_probe_failed' "$tmp/watchdog.log"
for _ in 1 2 3; do run_watchdog '' 000 'database write failed: SQLITE_FULL' 1000 800; done
test ! -s "$tmp/docker.log"
grep -q 'condition=recent_sqlite_full' "$tmp/watchdog.log"

run_watchdog '{"ready":false,"reasons":["database_unavailable"],"datasetState":"live","storagePressureState":"ok","mqttSessionReady":true,"dbReady":false}'
grep -q 'reason=database_unavailable' "$tmp/watchdog.log"
rm -f "$tmp/state/state.env"

# Warming is not itself a failure and never causes a restart, but it must not
# hide an independently confirmed MQTT session failure.
warming_session_failed='{"ready":false,"reasons":["mqtt_session_not_ready"],"datasetState":"warming","storagePressureState":"ok","mqttSessionReady":false,"dbReady":true}'
for _ in 1 2 3; do run_watchdog "$warming_session_failed"; done
test "$(wc -l < "$tmp/docker.log")" -eq 1
rm -f "$tmp/state/state.env" "$tmp/docker.log"

failed='{"ready":false,"reasons":["public_cache_stale_or_failed"],"datasetState":"live","storagePressureState":"ok","mqttSessionReady":true,"dbReady":true}'
for _ in 1 2 3; do run_watchdog "$failed"; done
test "$(wc -l < "$tmp/docker.log")" -eq 1
sed -i 's/^last_restart=.*/last_restart=0/' "$tmp/state/state.env"
for _ in 1 2 3; do run_watchdog "$failed"; done
test "$(wc -l < "$tmp/docker.log")" -eq 2
sed -i 's/^last_restart=.*/last_restart=0/' "$tmp/state/state.env"
for _ in 1 2 3; do run_watchdog "$failed"; done
test "$(wc -l < "$tmp/docker.log")" -eq 2
grep -q 'reason=window_limit' "$tmp/watchdog.log"

# Deployment mocks exercise unexpected and explicit failure paths without a
# container runtime. All candidate identity labels are bound to MERGE_SHA.
cat >"$tmp/bin/docker" <<'EOF'
#!/usr/bin/env sh
printf '%s image=%s mqtt=%s\n' "$*" "${MC_CARTOLIVE_IMAGE:-}" "${MQTT_ENABLED:-}" >>"$MOCK_DOCKER_LOG"
if [ "${1:-}" = "image" ] && [ "${2:-}" = "inspect" ]; then
	case " $* " in
		*org.opencontainers.image.revision*) printf '%s\n' "$MOCK_MERGE_SHA" ;;
		*org.opencontainers.image.source*) printf '%s\n' 'https://github.com/n30nex/MC-CartoLive' ;;
		*org.opencontainers.image.version*) printf '%s\n' '3.2.0' ;;
		*org.mc-cartolive.candidate.workflow-run-id*) printf '%s\n' '123456789' ;;
		*org.mc-cartolive.candidate.workflow-run-attempt*) printf '%s\n' '1' ;;
		*org.mc-cartolive.candidate.tag*) printf '%s\n' "candidate-$MOCK_MERGE_SHA-123456789-1" ;;
	esac
	exit 0
fi
if [ "${1:-}" = "run" ]; then
	case " $* " in
		*" --entrypoint id "*" -u "*) printf '1000\n' ;;
		*" --entrypoint id "*" -g "*) printf '1000\n' ;;
	esac
	exit 0
fi
if [ "${1:-}" = "compose" ]; then
	case " $* " in
		*" version "*) exit 0 ;;
		*" down "*)
			count="$(cat "$MOCK_DOWN_COUNT_FILE" 2>/dev/null || printf '0')"
			count=$((count + 1))
			printf '%s' "$count" >"$MOCK_DOWN_COUNT_FILE"
			if [ "$MOCK_SCENARIO" = "down_fail" ] && [ "$count" -eq 1 ]; then exit 1; fi
			if [ "$MOCK_SCENARIO" = "rollback_down_fail" ] && [ "$count" -eq 1 ]; then exit 1; fi
			if [ "$MOCK_SCENARIO" = "fresh_rollback_down_fail" ] && [ "$count" -eq 3 ]; then exit 1; fi
			: >"$MOCK_CURRENT_IMAGE_FILE"
			;;
		*" up "*)
			if [ "$MOCK_SCENARIO" = "rollback_fail" ] && [ "$MC_CARTOLIVE_IMAGE" = "$MOCK_PREVIOUS_IMAGE" ]; then exit 1; fi
			printf '%s' "$MC_CARTOLIVE_IMAGE" >"$MOCK_CURRENT_IMAGE_FILE"
			if [ "$MOCK_SCENARIO" != "preserve_success" ]; then : >"$MOCK_DATABASE_FILE"; fi
			;;
	esac
	exit 0
fi
if [ "${1:-}" = "ps" ]; then
	if [ "$MOCK_SCENARIO" = "rollback_absence_fail" ]; then printf 'deadbeef\n'; fi
	exit 0
fi
if [ "${1:-}" = "inspect" ]; then
	[ -s "$MOCK_CURRENT_IMAGE_FILE" ] || exit 1
	cat "$MOCK_CURRENT_IMAGE_FILE"
	exit 0
fi
exit 0
EOF
cat >"$tmp/bin/curl" <<'EOF'
#!/usr/bin/env sh
out=""
write_code=0
url=""
while [ "$#" -gt 0 ]; do
	case "$1" in
		-o) out="$2"; shift 2 ;;
		-w) write_code=1; shift 2 ;;
		http://*|https://*) url="$1"; shift ;;
		*) shift ;;
	esac
done
if [ "$(cat "$MOCK_CURRENT_IMAGE_FILE" 2>/dev/null)" = "$MOCK_PREVIOUS_IMAGE" ]; then
	body='{"ready":true}'
elif [ "$MOCK_SCENARIO" = "fresh_success" ] || [ "$MOCK_SCENARIO" = "preserve_success" ] || [ "$MOCK_SCENARIO" = "privacy_fail" ] || [ "$MOCK_SCENARIO" = "fresh_rollback_down_fail" ] || [ "$MOCK_SCENARIO" = "root_usage_high" ]; then
	case "$url" in
		*/api/v1/public/events*) body='{"resetRequired":true}' ;;
		*/api/v1/public/state*) body='{"stats":{"packets":0,"activeNodes":0,"activeRoutes":0}}' ;;
		*) body="{\"ready\":true,\"version\":\"3.2.0\",\"gitSha\":\"$MOCK_MERGE_SHA\"}" ;;
	esac
else
	body='{"ready":false}'
fi
if [ -n "$out" ]; then printf '%s' "$body" >"$out"; else printf '%s' "$body"; fi
[ "$write_code" -eq 0 ] || printf '200'
EOF
cat >"$tmp/bin/node" <<'EOF'
#!/usr/bin/env sh
printf '%s\n' "$*" >>"$MOCK_NODE_LOG"
[ "${1:-}" != --version ] || {
	if [ "$MOCK_SCENARIO" = node_old ]; then printf 'v16.20.2\n'; else printf 'v22.17.0\n'; fi
	exit 0
}
[ "$MOCK_SCENARIO" != privacy_fail ] && [ "$MOCK_SCENARIO" != fresh_rollback_down_fail ]
EOF
cat >"$tmp/bin/systemctl" <<'EOF'
#!/usr/bin/env sh
printf '%s\n' "$*" >>"$MOCK_SYSTEMCTL_LOG"
case "${1:-}" in is-active|stop|start) exit 0 ;; *) exit 1 ;; esac
EOF
cat >"$tmp/bin/df" <<'EOF'
#!/usr/bin/env sh
count="$(cat "$MOCK_DF_COUNT_FILE" 2>/dev/null || printf '0')"
count=$((count + 1))
printf '%s' "$count" >"$MOCK_DF_COUNT_FILE"
if [ "$MOCK_SCENARIO" = "after_delete" ] && [ "$count" -eq 2 ]; then exit 1; fi
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
if [ "$MOCK_SCENARIO" = "root_usage_high" ] && [ "${2:-}" = "/" ]; then
	printf 'mock 100000000 25000000 75000000 25%% /\n'
else
	printf 'mock 100000000 1 99999999 1%% /\n'
fi
EOF
cat >"$tmp/bin/sqlite3" <<'EOF'
#!/usr/bin/env sh
query="${2:-}"
case "$query" in
	*quick_check*) printf 'ok\n' ;;
	*foreign_key_check*) ;;
	*user_version*) printf '32000\n' ;;
	*'SELECT COUNT'*) printf '0\n' ;;
	*) printf '0\n' ;;
esac
EOF
chmod +x "$tmp/bin/docker" "$tmp/bin/curl" "$tmp/bin/node" "$tmp/bin/systemctl" "$tmp/bin/df" "$tmp/bin/sqlite3"

prepare_repo() {
	name="$1"
	repo="$tmp/$name/repo"
	mkdir -p "$repo/data" "$repo/backups" "$repo/scripts" "$tmp/$name/deploy-state"
	printf '3.2.0\n' >"$repo/VERSION"
	printf 'PUBLIC_MODE=true\nPUBLIC_BASE_URL=https://carto.example.test\nMQTT_ENABLED=true\nAPP_VERSION=old\nGIT_SHA=old\nDATA_RETENTION_DAYS=-1\nPUBLIC_EVENT_RETENTION_HOURS=-1\nALLOW_UNBOUNDED_RETENTION=true\n' >"$repo/.env"
	printf '// credential-free scanner fixture\n' >"$repo/scripts/check-public-privacy.mjs"
	printf '{"database":{"schemaVersion":32000}}\n' >"$repo/release-manifest.json"
	printf 'operator-config\n' >"$repo/data/config.yaml"
	printf 'old-db\n' >"$repo/data/meshcore-live.db"
	printf 'old-backup\n' >"$repo/backups/legacy.db"
	# Compose must receive the interpolation literally.
	# shellcheck disable=SC2016
	printf 'services:\n  meshcore-live-map:\n    image: ${MC_CARTOLIVE_IMAGE}\n' >"$repo/docker-compose.production.yml"
	: >"$tmp/$name/systemctl.log"
	: >"$tmp/$name/docker.log"
	: >"$tmp/$name/current-image"
	: >"$tmp/$name/down-count"
	: >"$tmp/$name/df-count"
	: >"$tmp/$name/node.log"
}

run_failed_deploy() {
	name="$1"
	scenario="$2"
	shift 2
	repo="$tmp/$name/repo"
	if MOCK_SCENARIO="$scenario" \
	  MOCK_CURRENT_IMAGE_FILE="$tmp/$name/current-image" \
	  MOCK_DATABASE_FILE="$repo/data/meshcore-live.db" \
	  MOCK_PREVIOUS_IMAGE="$PREVIOUS" \
	  MOCK_MERGE_SHA="$MERGE_SHA" \
	  MOCK_SYSTEMCTL_LOG="$tmp/$name/systemctl.log" \
	  MOCK_DOCKER_LOG="$tmp/$name/docker.log" \
	  MOCK_DOWN_COUNT_FILE="$tmp/$name/down-count" \
	  MOCK_DF_COUNT_FILE="$tmp/$name/df-count" \
	  MOCK_NODE_LOG="$tmp/$name/node.log" \
	  MC_CARTOLIVE_DEPLOY_STATE_DIR="$tmp/$name/deploy-state" \
	  MC_CARTOLIVE_READY_TIMEOUT_SECONDS=1 \
	  MC_CARTOLIVE_MIN_FREE_GB=25 \
	  PATH="$tmp/bin:$PATH" \
	  "$ROOT/scripts/deploy.sh" --repo "$repo" --image "$DIGEST" --previous-image "$PREVIOUS" --expected-git-sha "$MERGE_SHA" "$@" >/dev/null 2>&1; then
		echo "deploy scenario $name unexpectedly succeeded" >&2
		exit 1
	fi
}

run_successful_fresh_deploy() {
	name="$1"
	repo="$tmp/$name/repo"
	MOCK_SCENARIO=fresh_success \
	  MOCK_CURRENT_IMAGE_FILE="$tmp/$name/current-image" \
	  MOCK_DATABASE_FILE="$repo/data/meshcore-live.db" \
	  MOCK_PREVIOUS_IMAGE="$PREVIOUS" \
	  MOCK_MERGE_SHA="$MERGE_SHA" \
	  MOCK_SYSTEMCTL_LOG="$tmp/$name/systemctl.log" \
	  MOCK_DOCKER_LOG="$tmp/$name/docker.log" \
	  MOCK_DOWN_COUNT_FILE="$tmp/$name/down-count" \
	  MOCK_DF_COUNT_FILE="$tmp/$name/df-count" \
	  MOCK_NODE_LOG="$tmp/$name/node.log" \
	  MC_CARTOLIVE_DEPLOY_STATE_DIR="$tmp/$name/deploy-state" \
	  MC_CARTOLIVE_READY_TIMEOUT_SECONDS=1 \
	  MC_CARTOLIVE_MIN_FREE_GB=25 \
	  PATH="$tmp/bin:$PATH" \
	  "$ROOT/scripts/deploy.sh" --repo "$repo" --image "$DIGEST" --previous-image "$PREVIOUS" --expected-git-sha "$MERGE_SHA" \
	    --fresh-database --confirm-fresh-database DELETE-MC-CARTOLIVE-PRODUCTION-DATA >/dev/null
}

run_successful_preserved_deploy() {
	name="$1"
	repo="$tmp/$name/repo"
	MOCK_SCENARIO=preserve_success \
	  MOCK_CURRENT_IMAGE_FILE="$tmp/$name/current-image" \
	  MOCK_DATABASE_FILE="$repo/data/meshcore-live.db" \
	  MOCK_PREVIOUS_IMAGE="$PREVIOUS" \
	  MOCK_MERGE_SHA="$MERGE_SHA" \
	  MOCK_SYSTEMCTL_LOG="$tmp/$name/systemctl.log" \
	  MOCK_DOCKER_LOG="$tmp/$name/docker.log" \
	  MOCK_DOWN_COUNT_FILE="$tmp/$name/down-count" \
	  MOCK_DF_COUNT_FILE="$tmp/$name/df-count" \
	  MOCK_NODE_LOG="$tmp/$name/node.log" \
	  MC_CARTOLIVE_DEPLOY_STATE_DIR="$tmp/$name/deploy-state" \
	  MC_CARTOLIVE_READY_TIMEOUT_SECONDS=1 \
	  MC_CARTOLIVE_REQUIRE_PRIVACY_SCAN=1 \
	  PATH="$tmp/bin:$PATH" \
	  "$ROOT/scripts/deploy.sh" --repo "$repo" --image "$DIGEST" --previous-image "$PREVIOUS" --expected-git-sha "$MERGE_SHA" >/dev/null
}

# Explicit candidate-readiness failure: rollback succeeds and restores timer.
prepare_repo unready
run_failed_deploy unready unready
grep -q '^stop mc-cartolive-watchdog.timer$' "$tmp/unready/systemctl.log"
grep -q '^start mc-cartolive-watchdog.timer$' "$tmp/unready/systemctl.log"
grep -q "image=$PREVIOUS" "$tmp/unready/docker.log"
test ! -s "$tmp/unready/node.log"

# Unexpected failure immediately after watchdog stop, while stopping the old
# service: EXIT trap rolls back, restores timer, and preserves untouched data.
prepare_repo after_stop
run_failed_deploy after_stop down_fail --fresh-database --confirm-fresh-database DELETE-MC-CARTOLIVE-PRODUCTION-DATA
test -f "$tmp/after_stop/repo/data/meshcore-live.db"
test -f "$tmp/after_stop/repo/backups/legacy.db"
grep -q '^start mc-cartolive-watchdog.timer$' "$tmp/after_stop/systemctl.log"

# Unexpected df failure after authorized deletion: EXIT trap starts the old
# digest with another empty DB, restores timer, and keeps config/secrets.
prepare_repo after_delete
run_failed_deploy after_delete after_delete --fresh-database --confirm-fresh-database DELETE-MC-CARTOLIVE-PRODUCTION-DATA
test -f "$tmp/after_delete/repo/data/meshcore-live.db"
test ! -e "$tmp/after_delete/repo/backups/legacy.db"
test -f "$tmp/after_delete/repo/data/config.yaml"
grep -q '^PUBLIC_MODE=true$' "$tmp/after_delete/repo/.env"
if grep -Eq '^(APP_VERSION|GIT_SHA)=' "$tmp/after_delete/repo/.env"; then exit 1; fi
test "$(grep -c '^DATA_RETENTION_DAYS=7$' "$tmp/after_delete/repo/.env")" -eq 1
test "$(grep -c '^PUBLIC_EVENT_RETENTION_HOURS=24$' "$tmp/after_delete/repo/.env")" -eq 1
test "$(grep -c '^ALLOW_UNBOUNDED_RETENTION=false$' "$tmp/after_delete/repo/.env")" -eq 1
grep -q '^start mc-cartolive-watchdog.timer$' "$tmp/after_delete/systemctl.log"

# The irreversible cutover also refuses to proceed when deletion leaves root
# at 25% usage: the fixed release gate is strictly less than 25%.
prepare_repo root_usage_high
run_failed_deploy root_usage_high root_usage_high --fresh-database --confirm-fresh-database DELETE-MC-CARTOLIVE-PRODUCTION-DATA
grep -q " up .*image=$PREVIOUS" "$tmp/root_usage_high/docker.log"
grep -q '^start mc-cartolive-watchdog.timer$' "$tmp/root_usage_high/systemctl.log"

# Failed rollback readiness/up remains fail-closed with watchdog disabled.
prepare_repo rollback_fail
run_failed_deploy rollback_fail rollback_fail
if grep -q '^start mc-cartolive-watchdog.timer$' "$tmp/rollback_fail/systemctl.log"; then
	echo "watchdog restarted despite failed rollback" >&2
	exit 1
fi

# Rollback may neither delete the fresh candidate DB nor start the old digest
# until compose down succeeds and Docker confirms the named container is gone.
prepare_repo rollback_down_fail
run_failed_deploy rollback_down_fail rollback_down_fail
test -f "$tmp/rollback_down_fail/repo/data/meshcore-live.db"
test -f "$tmp/rollback_down_fail/repo/backups/legacy.db"
test ! -e "$tmp/rollback_down_fail/deploy-state/current.env"
if grep -q " up .*image=$PREVIOUS" "$tmp/rollback_down_fail/docker.log"; then exit 1; fi
if grep -q '^start mc-cartolive-watchdog.timer$' "$tmp/rollback_down_fail/systemctl.log"; then exit 1; fi

prepare_repo rollback_absence_fail
run_failed_deploy rollback_absence_fail rollback_absence_fail
test -f "$tmp/rollback_absence_fail/repo/data/meshcore-live.db"
test -f "$tmp/rollback_absence_fail/repo/backups/legacy.db"
test ! -e "$tmp/rollback_absence_fail/deploy-state/current.env"
if grep -q " up .*image=$PREVIOUS" "$tmp/rollback_absence_fail/docker.log"; then exit 1; fi
if grep -q '^start mc-cartolive-watchdog.timer$' "$tmp/rollback_absence_fail/systemctl.log"; then exit 1; fi

prepare_repo fresh_rollback_down_fail
run_failed_deploy fresh_rollback_down_fail fresh_rollback_down_fail --fresh-database --confirm-fresh-database DELETE-MC-CARTOLIVE-PRODUCTION-DATA
test -f "$tmp/fresh_rollback_down_fail/repo/data/meshcore-live.db"
test ! -e "$tmp/fresh_rollback_down_fail/deploy-state/current.env"
if grep -q " up .*image=$PREVIOUS" "$tmp/fresh_rollback_down_fail/docker.log"; then exit 1; fi
if grep -q '^start mc-cartolive-watchdog.timer$' "$tmp/fresh_rollback_down_fail/systemctl.log"; then exit 1; fi

# The destructive hosted mode fails before stopping the watchdog or deleting
# data when the staged Node.js runtime is older than the credential-free gate.
prepare_repo node_old
run_failed_deploy node_old node_old --fresh-database --confirm-fresh-database DELETE-MC-CARTOLIVE-PRODUCTION-DATA
test -f "$tmp/node_old/repo/data/meshcore-live.db"
test -f "$tmp/node_old/repo/backups/legacy.db"
test ! -s "$tmp/node_old/systemctl.log"

# A destructive candidate that is HTTP-ready but fails the bundled production
# privacy/WebSocket-hello transaction rolls back before writing current.env.
prepare_repo privacy_fail
run_failed_deploy privacy_fail privacy_fail --fresh-database --confirm-fresh-database DELETE-MC-CARTOLIVE-PRODUCTION-DATA
grep -q 'check-public-privacy.mjs http://127.0.0.1:39476 --origin https://carto.example.test' "$tmp/privacy_fail/node.log"
grep -q "image=$PREVIOUS" "$tmp/privacy_fail/docker.log"
grep -q '^start mc-cartolive-watchdog.timer$' "$tmp/privacy_fail/systemctl.log"
test ! -e "$tmp/privacy_fail/deploy-state/current.env"

# A successful destructive cutover proves the schema while MQTT is disabled,
# then starts the same immutable candidate with the preserved production MQTT
# setting. No historical database or backup survives.
prepare_repo fresh_success
run_successful_fresh_deploy fresh_success
test ! -e "$tmp/fresh_success/repo/backups/legacy.db"
test -f "$tmp/fresh_success/repo/data/meshcore-live.db"
test -f "$tmp/fresh_success/repo/data/config.yaml"
grep -q ' up .*image=.*mqtt=false$' "$tmp/fresh_success/docker.log"
test "$(grep -c ' up .*image=.*mqtt=$' "$tmp/fresh_success/docker.log")" -eq 1
grep -q '^start mc-cartolive-watchdog.timer$' "$tmp/fresh_success/systemctl.log"
grep -q "^MC_CARTOLIVE_IMAGE=$DIGEST$" "$tmp/fresh_success/deploy-state/current.env"
grep -q "^MC_CARTOLIVE_GIT_SHA=$MERGE_SHA$" "$tmp/fresh_success/deploy-state/current.env"
grep -q '^MC_CARTOLIVE_DATABASE_MODE=fresh$' "$tmp/fresh_success/deploy-state/current.env"
grep -q '^MC_CARTOLIVE_CANDIDATE_RUN_ID=123456789$' "$tmp/fresh_success/deploy-state/current.env"
grep -q '^MC_CARTOLIVE_CANDIDATE_RUN_ATTEMPT=1$' "$tmp/fresh_success/deploy-state/current.env"
grep -q "^MC_CARTOLIVE_CANDIDATE_TAG=candidate-$MERGE_SHA-123456789-1$" "$tmp/fresh_success/deploy-state/current.env"
grep -q -- '--entrypoint chown ' "$tmp/fresh_success/docker.log"
grep -q -- '--entrypoint chmod ' "$tmp/fresh_success/docker.log"
grep -q 'check-public-privacy.mjs http://127.0.0.1:39476 --origin https://carto.example.test' "$tmp/fresh_success/node.log"

# The hosted path preserves the database/backups, performs the same public
# privacy transaction when requested, and records the mode for later audits.
prepare_repo preserve_success
run_successful_preserved_deploy preserve_success
grep -qx 'old-db' "$tmp/preserve_success/repo/data/meshcore-live.db"
test -f "$tmp/preserve_success/repo/backups/legacy.db"
test -f "$tmp/preserve_success/repo/data/config.yaml"
grep -q '^MC_CARTOLIVE_DATABASE_MODE=preserved$' "$tmp/preserve_success/deploy-state/current.env"
grep -q 'check-public-privacy.mjs http://127.0.0.1:39476 --origin https://carto.example.test' "$tmp/preserve_success/node.log"

echo "release operations contracts ok"
