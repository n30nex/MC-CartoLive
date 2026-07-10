#!/usr/bin/env bash
set -Eeuo pipefail

REPO="${MC_CARTOLIVE_APP_DIR:-/opt/MC-CartoLive}"
COMPOSE_FILE="docker-compose.production.yml"
SERVICE="${MC_CARTOLIVE_SERVICE:-meshcore-live-map}"
CONTAINER="${MC_CARTOLIVE_CONTAINER:-meshcore-canada-live-map}"
HEALTH_URL="${MC_CARTOLIVE_READY_URL:-http://127.0.0.1:39476/readyz}"
LOCAL_BASE_URL="${MC_CARTOLIVE_LOCAL_BASE_URL:-http://127.0.0.1:39476}"
STATE_DIR="${MC_CARTOLIVE_DEPLOY_STATE_DIR:-/var/lib/mc-cartolive-deploy}"
MIN_FREE_GB="${MC_CARTOLIVE_MIN_FREE_GB:-25}"
IMAGE=""
PREVIOUS_IMAGE=""
EXPECTED_GIT_SHA=""
FRESH_DATABASE=0
CONFIRM_FRESH_DATABASE=""
CONFIRM_TOKEN="DELETE-MC-CARTOLIVE-PRODUCTION-DATA"

usage() {
	cat <<'EOF'
Usage:
  scripts/deploy.sh --image IMAGE@sha256:DIGEST [options]

Options:
  --previous-image IMAGE@sha256:DIGEST  Immutable rollback image.
  --expected-git-sha FULL_SHA           Required source identity for release cutover.
  --repo PATH                           Checkout/package path.
  --compose-file PATH                   Production Compose file relative to repo.
  --fresh-database                      Permanently delete the live SQLite DB and backups.
  --confirm-fresh-database TOKEN        Required token: DELETE-MC-CARTOLIVE-PRODUCTION-DATA

The script never builds an image and never resets a Git branch. Without
--fresh-database it preserves the existing database. The 3.2.0 production
cutover requires both destructive flags and an immutable rollback digest.
EOF
}

die() {
	printf 'deploy refused: %s\n' "$*" >&2
	exit 2
}

is_digest_ref() {
	[[ "$1" =~ ^[a-zA-Z0-9._:/-]+@sha256:[0-9a-f]{64}$ ]]
}

while [ "$#" -gt 0 ]; do
	case "$1" in
		--image) IMAGE="${2:-}"; shift 2 ;;
		--previous-image) PREVIOUS_IMAGE="${2:-}"; shift 2 ;;
		--expected-git-sha) EXPECTED_GIT_SHA="${2:-}"; shift 2 ;;
		--repo) REPO="${2:-}"; shift 2 ;;
		--compose-file) COMPOSE_FILE="${2:-}"; shift 2 ;;
		--fresh-database) FRESH_DATABASE=1; shift ;;
		--confirm-fresh-database) CONFIRM_FRESH_DATABASE="${2:-}"; shift 2 ;;
		-h|--help) usage; exit 0 ;;
		*) die "unknown argument: $1" ;;
	esac
done

[ -n "$IMAGE" ] || die "--image is required"
is_digest_ref "$IMAGE" || die "--image must be an immutable @sha256 reference"
[ -n "$PREVIOUS_IMAGE" ] || die "--previous-image is required for bounded rollback"
is_digest_ref "$PREVIOUS_IMAGE" || die "--previous-image must be an immutable @sha256 reference"
if [ -n "$EXPECTED_GIT_SHA" ] && [[ ! "$EXPECTED_GIT_SHA" =~ ^[0-9a-f]{40}$ ]]; then
	die "--expected-git-sha must be a full lowercase Git SHA"
fi
[[ "$MIN_FREE_GB" =~ ^[1-9][0-9]*$ ]] || die "MC_CARTOLIVE_MIN_FREE_GB must be a positive integer"
if [ "$FRESH_DATABASE" -eq 1 ]; then
	[ "$CONFIRM_FRESH_DATABASE" = "$CONFIRM_TOKEN" ] || die "fresh database requires --confirm-fresh-database $CONFIRM_TOKEN"
elif [ -n "$CONFIRM_FRESH_DATABASE" ]; then
	die "confirmation token supplied without --fresh-database"
fi

[ -d "$REPO" ] || die "repo directory does not exist: $REPO"
REPO="$(CDPATH='' cd "$REPO" && pwd -P)"
case "$COMPOSE_FILE" in
	/*) COMPOSE_PATH="$COMPOSE_FILE" ;;
	*) COMPOSE_PATH="$REPO/$COMPOSE_FILE" ;;
esac
[ -f "$COMPOSE_PATH" ] || die "Compose file does not exist: $COMPOSE_PATH"
[ -f "$REPO/.env" ] || die "private runtime file is missing: $REPO/.env"
[ -f "$REPO/VERSION" ] || die "VERSION is missing"
command -v docker >/dev/null 2>&1 || die "docker is required"
docker compose version >/dev/null 2>&1 || die "docker compose v2 is required"
command -v curl >/dev/null 2>&1 || die "curl is required"

DATA_DIR="$REPO/data"
BACKUP_DIR="$REPO/backups"
[ ! -L "$DATA_DIR" ] || die "data directory must not be a symlink"
[ ! -e "$BACKUP_DIR" ] || [ ! -L "$BACKUP_DIR" ] || die "backup directory must not be a symlink"
mkdir -p "$DATA_DIR" "$BACKUP_DIR" "$STATE_DIR"
DATA_DIR="$(CDPATH='' cd "$DATA_DIR" && pwd -P)"
BACKUP_DIR="$(CDPATH='' cd "$BACKUP_DIR" && pwd -P)"
case "$DATA_DIR" in "$REPO"/*) ;; *) die "data directory escaped repo" ;; esac
case "$BACKUP_DIR" in "$REPO"/*) ;; *) die "backup directory escaped repo" ;; esac

compose() {
	MC_CARTOLIVE_IMAGE="$1" docker compose --project-directory "$REPO" -f "$COMPOSE_PATH" "${@:2}"
}

hash_if_present() {
	if [ -f "$1" ]; then sha256sum "$1" | awk '{print $1}'; else printf 'missing'; fi
}

free_kb() {
	df -Pk "$REPO" | awk 'NR==2 {print $4}'
}

database_kb() {
	du -sk "$DATA_DIR"/meshcore-live.db* "$BACKUP_DIR" 2>/dev/null | awk '{sum += $1} END {print sum + 0}'
}

wait_ready() {
	deadline=$((SECONDS + 120))
	while [ "$SECONDS" -lt "$deadline" ]; do
		body="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"
		if printf '%s' "$body" | grep -q '"ready"[[:space:]]*:[[:space:]]*true'; then
			return 0
		fi
		sleep 2
	done
	return 1
}

delete_database() {
	config_hash_before="$(hash_if_present "$DATA_DIR/config.yaml")"
	env_hash_before="$(hash_if_present "$REPO/.env")"
	rm -f -- "$DATA_DIR/meshcore-live.db" "$DATA_DIR/meshcore-live.db-wal" "$DATA_DIR/meshcore-live.db-shm"
	# backups/ is dedicated to SQLite backups by the historical deploy scripts.
	# The canonical-path and no-symlink guards above make this bounded deletion
	# cover every old file and directory naming convention without escaping REPO.
	find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
	[ "$(hash_if_present "$DATA_DIR/config.yaml")" = "$config_hash_before" ] || die "data/config.yaml changed during database deletion"
	[ "$(hash_if_present "$REPO/.env")" = "$env_hash_before" ] || die ".env changed during database deletion"
}

sanitize_release_identity_env() {
	env_tmp="$REPO/.env.release.$$"
	awk '
		/^[[:space:]]*(export[[:space:]]+)?(APP_VERSION|GIT_SHA|BUILD_TIME|VITE_GIT_SHA|VITE_BUILD_TIME)[[:space:]]*=/ { removed++; next }
		{ print }
		END { if (removed > 0) printf "removed %d stale release identity override(s)\n", removed > "/dev/stderr" }
	' "$REPO/.env" >"$env_tmp"
	chmod --reference="$REPO/.env" "$env_tmp" 2>/dev/null || chmod 0600 "$env_tmp"
	mv -f "$env_tmp" "$REPO/.env"
}

verify_release() {
	ready_json="$(curl -fsS --max-time 10 "$HEALTH_URL")"
	state_json="$(curl -fsS --max-time 10 "$LOCAL_BASE_URL/api/v1/public/state")"
	events_json="$(curl -fsS --max-time 10 "$LOCAL_BASE_URL/api/v1/public/events?afterSeq=0&limit=25")"
	version="$(tr -d '\r\n' < "$REPO/VERSION")"
	printf '%s' "$ready_json" | grep -q '"ready"[[:space:]]*:[[:space:]]*true'
	printf '%s' "$ready_json" | grep -q "\"version\"[[:space:]]*:[[:space:]]*\"$version\""
	if [ -n "$EXPECTED_GIT_SHA" ]; then
		printf '%s' "$ready_json" | grep -q "\"gitSha\"[[:space:]]*:[[:space:]]*\"$EXPECTED_GIT_SHA\""
	fi
	printf '%s' "$events_json" | grep -q '"resetRequired"[[:space:]]*:[[:space:]]*true'
	printf '%s' "$state_json" >/dev/null
	[ "$(docker inspect --format '{{.Config.Image}}' "$CONTAINER")" = "$IMAGE" ]
	if command -v sqlite3 >/dev/null 2>&1; then
		[ "$(sqlite3 "$DATA_DIR/meshcore-live.db" 'PRAGMA quick_check;' 2>/dev/null)" = "ok" ]
		[ -z "$(sqlite3 "$DATA_DIR/meshcore-live.db" 'PRAGMA foreign_key_check;' 2>/dev/null)" ]
	fi
}

rollback() {
	printf 'Candidate failed; rolling back to %s\n' "$PREVIOUS_IMAGE" >&2
	compose "$IMAGE" down --remove-orphans || true
	if [ "$FRESH_DATABASE" -eq 1 ]; then
		printf 'Fresh-cutover rollback also starts with an empty database.\n' >&2
		delete_database
	fi
	compose "$PREVIOUS_IMAGE" pull "$SERVICE"
	compose "$PREVIOUS_IMAGE" up -d --no-build --remove-orphans "$SERVICE"
	if wait_ready; then
		if [ "${timer_was_active:-0}" -eq 1 ]; then systemctl start mc-cartolive-watchdog.timer; fi
		printf 'Rollback image is ready. Historical data was intentionally not restored.\n' >&2
		return 0
	fi
	printf 'Rollback image failed readiness; watchdog remains disabled.\n' >&2
	return 1
}

printf 'Pre-pulling immutable candidate: %s\n' "$IMAGE"
compose "$IMAGE" pull "$SERVICE"
if [ -n "$PREVIOUS_IMAGE" ]; then
	printf 'Pre-pulling immutable rollback: %s\n' "$PREVIOUS_IMAGE"
	compose "$PREVIOUS_IMAGE" pull "$SERVICE"
fi

if [ "$FRESH_DATABASE" -eq 1 ]; then
	projected_kb=$(( $(free_kb) + $(database_kb) ))
	required_kb=$(( MIN_FREE_GB * 1024 * 1024 ))
	[ "$projected_kb" -ge "$required_kb" ] || die "projected free space after deletion is below ${MIN_FREE_GB} GiB"
fi

timer_was_active=0
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet mc-cartolive-watchdog.timer; then
	timer_was_active=1
	systemctl stop mc-cartolive-watchdog.timer
fi

if [ "$FRESH_DATABASE" -eq 1 ]; then
	printf 'Stopping writer and permanently deleting live SQLite data and backups.\n'
	compose "$IMAGE" down --remove-orphans || true
	sanitize_release_identity_env
	delete_database
	actual_free_kb="$(free_kb)"
	if [ "$actual_free_kb" -lt "$required_kb" ]; then
		printf 'Free space after deletion is below %s GiB; rolling back application digest.\n' "$MIN_FREE_GB" >&2
		rollback || true
		exit 1
	fi
fi

printf 'Starting candidate without an on-host build.\n'
if ! compose "$IMAGE" up -d --no-build --remove-orphans "$SERVICE"; then
	if [ -n "$PREVIOUS_IMAGE" ]; then rollback || true; fi
	exit 1
fi
if ! wait_ready || ! verify_release; then
	compose "$IMAGE" logs --tail=240 "$SERVICE" >&2 || true
	if [ -n "$PREVIOUS_IMAGE" ]; then rollback || true; fi
	exit 1
fi

cat >"$STATE_DIR/current.env" <<EOF
MC_CARTOLIVE_IMAGE=$IMAGE
MC_CARTOLIVE_PREVIOUS_IMAGE=$PREVIOUS_IMAGE
MC_CARTOLIVE_DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
MC_CARTOLIVE_VERSION=$(tr -d '\r\n' < "$REPO/VERSION")
EOF
chmod 0600 "$STATE_DIR/current.env"

if [ "$timer_was_active" -eq 1 ]; then
	systemctl start mc-cartolive-watchdog.timer
fi

printf 'Deployment healthy: %s\n' "$IMAGE"
printf 'Free space: %s GiB\n' "$(awk -v kb="$(free_kb)" 'BEGIN {printf "%.1f", kb/1024/1024}')"
