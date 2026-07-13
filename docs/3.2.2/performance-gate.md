# 3.2.2 Performance And Live-Flow Gate

The canonical `full` profile is GitHub-Actions-only and configuration locked.
Run it by manually dispatching **Release performance gate** first for the exact
`codex/release-3.2.2` head and then for the merged `main` SHA. Both artifacts
must report `canonicalReleaseProof=true`; there is no waiver or deferred-proof
path.

The full proof requires:

- 20 messages/s for 300 seconds and 100 messages/s for 60 seconds;
- zero primary/derived drops, terminal write/deadline failures, animation loss,
  emergency scheduling, restarts, or OOM;
- primary queue age below 500 ms p99 sustained and two seconds during burst;
- observation-to-public-WebSocket p95 below one second sustained and two
  seconds during burst, with a hard maximum of five seconds;
- a preserved five-million-observation schema-32000 database containing
  expired retention work, realistic nodes/status, resolved one-hop and
  multi-hop topology, public history, and concurrent API/WebSocket/browser
  traffic;
- every eligible connected-live visual starts exactly once, visual age stays
  below five seconds, frame p95 is at most 34 ms, repeated tasks over 50 ms are
  zero, and process RSS p95 remains below 600 MiB;
- ordinary cursor resume/focus recovery avoids historical animation and a full
  snapshot unless the server declares a reset.

Smoke-profile overrides are diagnostics only. They cannot authorize a
candidate or populate release verification.
