#!/usr/bin/env bash
set -Eeuo pipefail

LOCAL_COPY=""
OFFHOST_COPY=""
EVIDENCE_FILE=""
REMOVE_LOCAL=0
CONFIRM=""

usage() {
	printf '%s\n' 'Usage: verify-backup-copy.sh --local-copy FILE --offhost-copy FILE --evidence FILE [--remove-local-after-match --confirm REMOVE-VERIFIED-LOCAL-BACKUP]'
}
die() { printf 'backup verification refused: %s\n' "$*" >&2; exit 2; }
while [ "$#" -gt 0 ]; do
	case "$1" in
		--local-copy) LOCAL_COPY="${2:-}"; shift 2 ;;
		--offhost-copy) OFFHOST_COPY="${2:-}"; shift 2 ;;
		--evidence) EVIDENCE_FILE="${2:-}"; shift 2 ;;
		--remove-local-after-match) REMOVE_LOCAL=1; shift ;;
		--confirm) CONFIRM="${2:-}"; shift 2 ;;
		-h|--help) usage; exit 0 ;;
		*) die "unknown argument $1" ;;
	esac
done

for dependency in date df dirname jq mkdir mv readlink rm sha256sum stat; do command -v "$dependency" >/dev/null 2>&1 || die "missing $dependency"; done
[ -f "$LOCAL_COPY" ] || die 'local copy must be a regular non-symlink file'
[ ! -L "$LOCAL_COPY" ] || die 'local copy must be a regular non-symlink file'
[ -f "$OFFHOST_COPY" ] || die 'off-host copy must be a regular non-symlink file'
[ ! -L "$OFFHOST_COPY" ] || die 'off-host copy must be a regular non-symlink file'
[ -n "$EVIDENCE_FILE" ] || die '--evidence is required'
local_path="$(readlink -f "$LOCAL_COPY")"
offhost_path="$(readlink -f "$OFFHOST_COPY")"
[ "$local_path" != "$offhost_path" ] || die 'local and off-host paths resolve to the same file'
local_device="$(stat -c %d "$local_path")"
offhost_device="$(stat -c %d "$offhost_path")"
[ "$local_device" != "$offhost_device" ] || die 'off-host copy must be on a different mounted filesystem'
local_bytes="$(stat -c %s "$local_path")"
offhost_bytes="$(stat -c %s "$offhost_path")"
[ "$local_bytes" -gt 0 ] || die 'backup sizes do not match'
[ "$local_bytes" -eq "$offhost_bytes" ] || die 'backup sizes do not match'
local_sha="$(sha256sum "$local_path" | awk '{print $1}')"
offhost_sha="$(sha256sum "$offhost_path" | awk '{print $1}')"
[ "$local_sha" = "$offhost_sha" ] || die 'backup checksums do not match'

removed=false
if [ "$REMOVE_LOCAL" -eq 1 ]; then
	[ "$CONFIRM" = REMOVE-VERIFIED-LOCAL-BACKUP ] || die 'removal requires --confirm REMOVE-VERIFIED-LOCAL-BACKUP'
	case "$local_path" in */data/meshcore-live.db|*/data/meshcore-live.db-wal|*/data/meshcore-live.db-shm) die 'refusing to remove a live database file' ;; esac
	rm -- "$local_path"
	[ ! -e "$local_path" ] || die 'local copy still exists after removal'
	[ -f "$offhost_path" ] || die 'off-host copy disappeared during removal'
	[ "$(sha256sum "$offhost_path" | awk '{print $1}')" = "$offhost_sha" ] || die 'off-host checksum changed during removal'
	removed=true
fi

free_kib="$(df -Pk "$(dirname "$local_path")" | awk 'NR > 1 {line=$0} END {print line}' | awk '{print $4}')"
evidence_dir="$(dirname "$EVIDENCE_FILE")"
mkdir -p "$evidence_dir"
tmp="$EVIDENCE_FILE.tmp.$$"
jq -n --arg verifiedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg sha256 "$local_sha" \
	--argjson bytes "$local_bytes" --argjson localRemoved "$removed" --argjson freeBytes "$((free_kib * 1024))" \
	'{formatVersion:1,verifiedAt:$verifiedAt,matched:true,sha256:$sha256,bytes:$bytes,separateFilesystems:true,localRemoved:$localRemoved,freeBytesAfter:$freeBytes}' >"$tmp"
chmod 0600 "$tmp"
mv -f "$tmp" "$EVIDENCE_FILE"
printf 'backup verification passed: bytes=%s sha256=%s localRemoved=%s evidence=%s\n' "$local_bytes" "$local_sha" "$removed" "$EVIDENCE_FILE"
