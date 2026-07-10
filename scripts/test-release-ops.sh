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

echo "release operations contracts ok"
