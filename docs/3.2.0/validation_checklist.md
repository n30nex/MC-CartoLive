# MC-CartoLive 3.2.0 Validation Checklist

This is a fail-closed release record. Check an item only when evidence was
collected for the exact candidate digest and commit.

## Pre-release infrastructure evidence (2026-07-10)

- [x] Reclaimed 9.582 GiB of unused builder cache while the active DB/container
  stayed untouched; root returned to 74% used (8.9 GiB free).
- [x] DigitalOcean monitoring agent 3.18.14 is installed, enabled, and active.
- [x] Cloud Firewall permits SSH only from the current operator source, port 80
  only from current Cloudflare IPv4/IPv6 ranges, blocks direct port 39476, and
  leaves required outbound traffic available; a second SSH session and public
  Cloudflare readiness were verified after attachment.
- [x] Disk 80/90, memory 85, CPU 90, five-minute global readiness downtime, and
  TLS-expiry alerts exist. DigitalOcean's supported CPU window is ten minutes,
  so that platform constraint replaces the planned 15-minute window.

## Source and CI

- [ ] `VERSION`, package metadata, docs, OpenAPI, Docker defaults, and tag agree
  on `3.2.0`.
- [ ] Go test, vet, race, module verification, and `govulncheck` pass with zero
  reachable vulnerabilities.
- [ ] The complete bounded-thread frontend suite, npm high audit, production
  build, schema/privacy checks, and bundle budgets pass.
- [ ] Shellcheck, deploy/watchdog contract tests, Compose validation, CodeQL,
  dependency review, secret scan, and Trivy pass.
- [ ] Desktop 1440x900 and mobile 390x844 browser smoke pass, including focus,
  reduced motion, cursor reset, service-worker update, Replay Studio cleanup,
  and public privacy checks.

## Candidate and package

- [ ] The candidate is one `linux/amd64,linux/arm64` manifest at
  `sha-<full-commit>` and reports the exact compiled version/SHA/build time.
- [ ] Synthetic and worldwide fixture package smoke passes against the exact
  Canada-asset production candidate digest.
- [ ] No unwaived high/critical image vulnerability exists.
- [ ] OCI/GitHub provenance and SPDX SBOM attestations verify.
- [ ] Deployment archive, release manifest, OpenAPI, SBOM, SARIF, and checksums
  contain no secret or live-data artifact.
- [ ] `3.2.0`, `3.2`, and `latest` resolve to the candidate digest after
  promotion.

## Performance and resilience

- [ ] 20 normalized messages/s for 30 minutes and 100/s for 60 seconds produce
  no queue drop or duplicate; queue-oldest p99 is below two seconds and memory
  p95 below 600 MiB.
- [ ] Five-million-row synthetic API tests meet: state origin p95 under 50 ms,
  public path under 300 ms, event resume under 100 ms, reset under 50 ms,
  bootstrap under 150 KiB gzip, and legacy state under 400 KiB gzip.
- [ ] 250 WebSocket clients run 30 minutes; slow clients reset without blocking
  ingest and quiet RF causes no reconnect/restart loop.
- [ ] Initial first-view JS+CSS is at most 500 KiB gzip, main at most 100 KiB,
  app CSS at most 32 KiB; MapLibre vendor CSS is reported separately, and
  showcase/export chunks are lazy.

## Hosted fresh cutover

- [ ] Build cache is reclaimed without changing the running service; root has
  at least 9 GiB free before maintenance.
- [ ] Host packages/reboot complete and the old service returns healthy before
  any data deletion.
- [ ] Candidate and previous digests are pre-pulled; loopback 39477 candidate
  smoke and privacy checks pass.
- [ ] Fresh-delete confirmation is recorded; `.env` and `data/config.yaml` are
  preserved while stale identity variables, DB/WAL/SHM, and backups are removed.
- [ ] Schema 32000 initializes cleanly; `quick_check=ok`, foreign-key check is
  empty, event reset is immediate, and release metadata matches.
- [ ] Root has at least 25 GiB free after deletion.
- [ ] MQTT session is ready within 60 seconds. Traffic advances sequence/packet
  state when present; absent traffic remains `warming` without restart.
- [ ] Thirty-minute immediate soak has no restart, OOM, full/busy storm, queue
  drop, cache failure, MQTT loss, public 5xx, or privacy finding.

## Follow-up

- [ ] 24-hour soak and alert delivery are verified.
- [ ] Day-8 retention/WAL/free-space checks pass.
- [ ] Day-14 database-plus-WAL growth is less than 10% from day 8.
