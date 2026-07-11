# 3.2.1 Performance And Load Gate

The canonical `full` profile remains the release proof and must run for the
exact release-branch head and merged main commit. Fast-track variables are not
accepted for 3.2.1.

Required phases include:

- sustained ingest at 20 normalized messages per second for 30 minutes;
- burst ingest at 100 per second for 60 seconds;
- a five-million-row public API dataset;
- 250 WebSocket clients for 30 minutes, a quiet-liveness window, and an isolated
  slow-client overflow test;
- primary queue capacity 4096, derived queue capacity 1024, zero drops/failures,
  and confirmed derived accepted/processed completion;
- process RSS p95 below 600 MiB;
- public state/bootstrap/event reset/path latency and compressed-size budgets;
- browser resource-growth and frontend asset budgets.

The report is canonical only when its GitHub repository, event, workflow,
workflow ref, full commit SHA, version, and all exact configuration values
match the release contract. Candidate and tag workflows download and validate
that JSON evidence rather than trusting a check name alone.

Backfill contention and sparse public sequences are release regressions. The
fixture/probe must include deduplicated event inserts and resolvable routed
traffic so public projection, not just primary ingest, is proven complete.
