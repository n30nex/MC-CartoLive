# 3.2.1 Security And Operations

3.2.1 keeps the 3.2 public privacy boundary: no broker credentials, full keys,
raw packet/path material, hashes, resolver reasons, live databases, or operator
configuration may enter public responses or release artifacts.

## Supply chain

- World and Canada images are built from one reviewed main commit but have
  separate immutable multi-platform digests.
- The world digest owns the generic version, minor, full-SHA, and latest tags.
  The Canada digest owns the matching `*-canada` aliases and the hosted
  droplet.
- Both variants require package smoke that verifies the selected served PWA
  manifest and pack-local icons, privacy checks, vulnerability scan, SBOM,
  provenance, and registry-native per-platform identity verification.
- Candidate evidence records the source CI, browser check, canonical load proof,
  workflow run/attempt, asset pack, platforms, and digest.
- Release assets and checksums are validated and attested, and GitHub release
  creation is preflighted, before tag promotion copies the already-tested
  manifests without rebuilding.

## Host boundaries

- Public traffic reaches the application through the documented proxy/firewall
  boundary. Diagnostics and Prometheus metrics remain host-loopback only.
- Live smoke obtains metrics through authenticated SSH rather than assuming the
  operator workstation's loopback is the droplet.
- The release-audit service remains read-only. Its only retained capability is
  `CAP_DAC_READ_SEARCH`, needed to traverse the `0750` runtime data directory;
  `ProtectSystem=strict`, `NoNewPrivileges`, private temporary storage, and
  restricted address families remain enabled.
- Deployment refuses a dirty or wrong-SHA checkout before mutating Compose or
  the database.

## Required alerts and evidence

Keep disk, memory, CPU, readiness, TLS, watchdog, restart/OOM, queue/drop,
SQLite busy/full, cache failure, and MQTT-session alerts active. The hourly
release audit records only aggregate privacy-safe evidence at 24 hours, day 8,
and day 14.
