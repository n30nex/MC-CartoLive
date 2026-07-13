# 3.2.2 Security And Operations

The public privacy boundary is unchanged. Release evidence contains aggregate
counters and hashes only; it must never include `.env`, live database rows,
packet captures, raw payloads, full public keys, or broker credentials.

Candidate creation requires successful protected-main CI and canonical full
performance proof from the exact release-branch head. The candidate workflow
builds distinct world and Canada amd64/arm64 manifests once, records their
digests and provenance, and never permits a performance fast-track.

Before canary deployment:

1. Run `verify-backup-copy.sh` against the redundant root-filesystem backup and
   its off-host/block-volume copy. Local removal requires checksum and size
   equality, different mounted filesystems, an explicit removal flag/token,
   and never permits deleting the live database.
2. Confirm the live filesystem has at least 9 GiB and 20 percent free.
3. Mount a separate writable snapshot filesystem at
   `/mnt/mc-cartolive-audit-snapshots` and install the staged systemd units.
4. Deploy the exact Canada candidate digest in preserved mode, retaining the
   exact 3.2.1 digest for immediate rollback.

Publication is fail-closed until the five-minute audit, browser proof, canary
counters, canonical performance runs, and `release-verification.json` contract
all pass.

The tag workflow requires repository secrets `MC_CARTOLIVE_DEPLOY_SSH_KEY` and
`MC_CARTOLIVE_DEPLOY_KNOWN_HOSTS`. Grant that key read-only access to the
privacy-safe `/var/log/mc-cartolive-release-audit/*.5m.json` results. Pin the
droplet host key in the known-hosts secret; do not permit interactive host-key
acceptance or copy live databases into Actions.
