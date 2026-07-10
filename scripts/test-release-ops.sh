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
mkdir -p "$tmp/bin" "$tmp/state"

cat >"$tmp/bin/curl" <<'EOF'
#!/usr/bin/env sh
out=""
while [ "$#" -gt 0 ]; do
	case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac
done
printf '%s' "$MOCK_JSON" >"$out"
printf '200'
EOF
cat >"$tmp/bin/docker" <<'EOF'
#!/usr/bin/env sh
printf '%s\n' "$*" >>"$MOCK_DOCKER_LOG"
EOF
chmod +x "$tmp/bin/curl" "$tmp/bin/docker"

run_watchdog() {
	MOCK_JSON="$1" \
	MOCK_DOCKER_LOG="$tmp/docker.log" \
	MC_CARTOLIVE_STATE_DIR="$tmp/state" \
	MC_CARTOLIVE_LOG_FILE="$tmp/watchdog.log" \
	MC_CARTOLIVE_BASE_COOLDOWN_SECONDS=1 \
	PATH="$tmp/bin:$PATH" \
	sh "$ROOT/scripts/mc-cartolive-watchdog.sh"
}

run_watchdog '{"ready":true,"datasetState":"warming","storagePressureState":"ok","publicCacheState":"warming","mqttSessionReady":true,"dbReady":true}'
run_watchdog '{"ready":false,"datasetState":"live","storagePressureState":"critical","publicCacheState":"stale","mqttSessionReady":true,"dbReady":false}'
run_watchdog '{"ready":true,"datasetState":"live","storagePressureState":"ok","publicCacheState":"fresh","mqttSessionReady":true,"dbReady":true,"publicLiveFresh":false}'
test ! -s "$tmp/docker.log"

failed='{"ready":false,"datasetState":"live","storagePressureState":"ok","publicCacheState":"failed","mqttSessionReady":true,"dbReady":true}'
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
printf '%s image=%s\n' "$*" "${MC_CARTOLIVE_IMAGE:-}" >>"$MOCK_DOCKER_LOG"
if [ "${1:-}" = "image" ] && [ "${2:-}" = "inspect" ]; then
	case " $* " in
		*org.opencontainers.image.revision*) printf '%s\n' "$MOCK_MERGE_SHA" ;;
		*org.opencontainers.image.source*) printf '%s\n' 'https://github.com/n30nex/MC-CartoLive' ;;
		*org.opencontainers.image.version*) printf '%s\n' '3.2.0' ;;
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
			;;
		*" up "*)
			if [ "$MOCK_SCENARIO" = "rollback_fail" ] && [ "$MC_CARTOLIVE_IMAGE" = "$MOCK_PREVIOUS_IMAGE" ]; then exit 1; fi
			printf '%s' "$MC_CARTOLIVE_IMAGE" >"$MOCK_CURRENT_IMAGE_FILE"
			;;
	esac
	exit 0
fi
if [ "${1:-}" = "inspect" ]; then
	cat "$MOCK_CURRENT_IMAGE_FILE"
	exit 0
fi
exit 0
EOF
cat >"$tmp/bin/curl" <<'EOF'
#!/usr/bin/env sh
out=""
write_code=0
while [ "$#" -gt 0 ]; do
	case "$1" in
		-o) out="$2"; shift 2 ;;
		-w) write_code=1; shift 2 ;;
		*) shift ;;
	esac
done
if [ "$(cat "$MOCK_CURRENT_IMAGE_FILE" 2>/dev/null)" = "$MOCK_PREVIOUS_IMAGE" ]; then
	body='{"ready":true}'
else
	body='{"ready":false}'
fi
if [ -n "$out" ]; then printf '%s' "$body" >"$out"; else printf '%s' "$body"; fi
[ "$write_code" -eq 0 ] || printf '200'
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
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\nmock 100000000 1 99999999 1%% /\n'
EOF
chmod +x "$tmp/bin/docker" "$tmp/bin/curl" "$tmp/bin/systemctl" "$tmp/bin/df"

prepare_repo() {
	name="$1"
	repo="$tmp/$name/repo"
	mkdir -p "$repo/data" "$repo/backups" "$tmp/$name/deploy-state"
	printf '3.2.0\n' >"$repo/VERSION"
	printf 'PUBLIC_MODE=true\nAPP_VERSION=old\nGIT_SHA=old\n' >"$repo/.env"
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
}

run_failed_deploy() {
	name="$1"
	scenario="$2"
	shift 2
	repo="$tmp/$name/repo"
	if MOCK_SCENARIO="$scenario" \
	  MOCK_CURRENT_IMAGE_FILE="$tmp/$name/current-image" \
	  MOCK_PREVIOUS_IMAGE="$PREVIOUS" \
	  MOCK_MERGE_SHA="$MERGE_SHA" \
	  MOCK_SYSTEMCTL_LOG="$tmp/$name/systemctl.log" \
	  MOCK_DOCKER_LOG="$tmp/$name/docker.log" \
	  MOCK_DOWN_COUNT_FILE="$tmp/$name/down-count" \
	  MOCK_DF_COUNT_FILE="$tmp/$name/df-count" \
	  MC_CARTOLIVE_DEPLOY_STATE_DIR="$tmp/$name/deploy-state" \
	  MC_CARTOLIVE_READY_TIMEOUT_SECONDS=1 \
	  MC_CARTOLIVE_MIN_FREE_GB=1 \
	  PATH="$tmp/bin:$PATH" \
	  "$ROOT/scripts/deploy.sh" --repo "$repo" --image "$DIGEST" --previous-image "$PREVIOUS" --expected-git-sha "$MERGE_SHA" "$@" >/dev/null 2>&1; then
		echo "deploy scenario $name unexpectedly succeeded" >&2
		exit 1
	fi
}

# Explicit candidate-readiness failure: rollback succeeds and restores timer.
prepare_repo unready
run_failed_deploy unready unready
grep -q '^stop mc-cartolive-watchdog.timer$' "$tmp/unready/systemctl.log"
grep -q '^start mc-cartolive-watchdog.timer$' "$tmp/unready/systemctl.log"
grep -q "image=$PREVIOUS" "$tmp/unready/docker.log"

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
test ! -e "$tmp/after_delete/repo/data/meshcore-live.db"
test ! -e "$tmp/after_delete/repo/backups/legacy.db"
test -f "$tmp/after_delete/repo/data/config.yaml"
grep -q '^PUBLIC_MODE=true$' "$tmp/after_delete/repo/.env"
if grep -Eq '^(APP_VERSION|GIT_SHA)=' "$tmp/after_delete/repo/.env"; then exit 1; fi
grep -q '^start mc-cartolive-watchdog.timer$' "$tmp/after_delete/systemctl.log"

# Failed rollback readiness/up remains fail-closed with watchdog disabled.
prepare_repo rollback_fail
run_failed_deploy rollback_fail rollback_fail
if grep -q '^start mc-cartolive-watchdog.timer$' "$tmp/rollback_fail/systemctl.log"; then
	echo "watchdog restarted despite failed rollback" >&2
	exit 1
fi

echo "release operations contracts ok"
