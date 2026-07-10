#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
DIGEST="ghcr.io/n30nex/mc-cartolive@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

"$ROOT/scripts/deploy.sh" --help >/dev/null
if "$ROOT/scripts/deploy.sh" --image latest >/dev/null 2>&1; then
	echo "deploy accepted a mutable image" >&2
	exit 1
fi
if "$ROOT/scripts/deploy.sh" --image "$DIGEST" --fresh-database >/dev/null 2>&1; then
	echo "deploy accepted destructive mode without confirmation and rollback digest" >&2
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

# Exercise the deploy failure path with an active watchdog timer. The candidate
# never becomes ready, the immutable rollback does, and deploy still exits
# non-zero while restoring the previously active timer.
mkdir -p "$tmp/repo/data" "$tmp/repo/backups" "$tmp/deploy-state"
printf '3.2.0\n' >"$tmp/repo/VERSION"
printf 'PUBLIC_MODE=true\n' >"$tmp/repo/.env"
# Compose must receive the interpolation literally.
# shellcheck disable=SC2016
printf 'services:\n  meshcore-live-map:\n    image: ${MC_CARTOLIVE_IMAGE}\n' >"$tmp/repo/docker-compose.production.yml"
previous="ghcr.io/n30nex/mc-cartolive@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
: >"$tmp/systemctl.log"
: >"$tmp/current-image"

cat >"$tmp/bin/docker" <<'EOF'
#!/usr/bin/env sh
if [ "${1:-}" = "compose" ]; then
	case " $* " in
		*" version "*) exit 0 ;;
		*" up "*) printf '%s' "$MC_CARTOLIVE_IMAGE" >"$MOCK_CURRENT_IMAGE_FILE" ;;
	esac
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
chmod +x "$tmp/bin/docker" "$tmp/bin/curl" "$tmp/bin/systemctl"

if MOCK_CURRENT_IMAGE_FILE="$tmp/current-image" \
  MOCK_PREVIOUS_IMAGE="$previous" \
  MOCK_SYSTEMCTL_LOG="$tmp/systemctl.log" \
  MC_CARTOLIVE_DEPLOY_STATE_DIR="$tmp/deploy-state" \
  MC_CARTOLIVE_READY_TIMEOUT_SECONDS=1 \
  PATH="$tmp/bin:$PATH" \
  "$ROOT/scripts/deploy.sh" --repo "$tmp/repo" --image "$DIGEST" --previous-image "$previous" >/dev/null 2>&1; then
	echo "deploy unexpectedly succeeded for an unready candidate" >&2
	exit 1
fi
grep -q '^stop mc-cartolive-watchdog.timer$' "$tmp/systemctl.log"
grep -q '^start mc-cartolive-watchdog.timer$' "$tmp/systemctl.log"

echo "release operations contracts ok"
