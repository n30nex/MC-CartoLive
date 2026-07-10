# 3.2.0 performance and load gate

The release performance gate is credential-free, uses synthetic data only, and
does not build a container. It drives fixture traffic through the production
normalized MQTT queue and single-writer path, measures the loopback origin API
over a real SQLite database, and opens real public WebSocket connections.

The harness is GitHub-Actions-only. Pull requests that change its covered paths
run the scaled `smoke` profile automatically. It can also be selected from the
**Release performance gate** workflow's manual-dispatch form. Do not run the
harness, its smoke profile, or its full load profile on an operator workstation
or on the production droplet.

Run the locked release profile on `codex/release-3.2.0` with the GitHub Actions
**Release performance gate** workflow. The full defaults are:

- 20 normalized messages/second for 30 minutes;
- 100 normalized messages/second for 60 seconds;
- at least 5,000,000 `packet_observations`, 10,000 projected public paths, and
  20,000 retained public events;
- 200 timed requests per measured API route; and
- 250 public WebSocket clients for 30 minutes, including a deliberately slow
  client and a 70-second quiet tail.

The workflow exposes the main duration and count overrides for scaled smoke
diagnosis. Every setting is also configurable through `PERF_*` variables; see
the configuration block at the top of `scripts/performance-gate.mjs`. The full
profile rejects every override, records the GitHub run identity in its report,
and is accepted only with the unchanged locked defaults.

## Strict assertions

The ingest phases require exact accepted, processed, database-row, and unique
`ingest_id` counts; zero primary/derived queue drops; zero retry duplicate
suppressions; zero failed, busy, or full-disk writes; queue-oldest p99 below two
seconds; peak normalized-queue occupancy below 75%; Go system-memory p95 below
600 MiB; and no process goroutine growth after drain.

The API phase requires no 5xx response, cached state origin p95 below 50 ms,
public packet-path p95 below 300 ms, retained-event resume p95 below 100 ms,
cursor reset p95 below 50 ms, bootstrap at most 150 KiB gzip, and legacy state
at most 400 KiB gzip. `afterSeq=0` must return HTTP 200 with
`resetRequired=true`; it is never allowed to scan retained history.

The WebSocket phase requires every normal client to receive every generated
event with no lagged frame, isolates the deliberately slow client without
blocking normal delivery, preserves every normal connection through the quiet
interval without reconnecting, and reclaims clients and goroutines afterward.
The workflow also runs the watchdog contract proving that quiet traffic,
`warming`, and storage pressure do not cause a restart.

## Evidence and interpretation

The machine-readable result is
`artifacts/performance-gate/report.json`; phase logs are written beside it and
uploaded even on failure. Timings are direct loopback origin timings, so the
public-path 300 ms budget (which includes ingress) remains more permissive than
the measured origin result. `meshcore_memory_sys_bytes` is the enforced
cross-platform Go process-memory measure. The harness does not represent
Cloudflare latency, DigitalOcean host contention, or the separate 30-minute
production candidate observation; those remain deployment-window proofs.
