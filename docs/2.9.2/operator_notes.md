# MC-CartoLive 2.9.2 Operator Notes

## Public Event Resume

- `/ws/public` hello frames include `latestSeq`.
- Public event frames carry durable `seq` values when `PUBLIC_EVENTS_ENABLED=true`.
- Browsers backfill missed events with `/api/v1/public/events?afterSeq=<seq>`.
- If backfill is unavailable or empty while `latestSeq` advanced, the frontend
  falls back to `/api/v1/public/state`.

## Feature Flags

Defaults keep the public Canada deployment usable:

```text
PUBLIC_EVENTS_ENABLED=true
PUBLIC_WS_RESUME_ENABLED=true
PUBLIC_WS_SUBSCRIPTIONS_ENABLED=false
PUBLIC_VIEWPORT_ENABLED=true
NOC_MODE_ENABLED=true
COVERAGE_ENABLED=true
LOS_ENABLED=true
PUBLIC_SCHEMA_ENABLED=true
PUBLIC_INTEGRATIONS_ENABLED=true
```

## Canada CDEM LOS Workflow

2.9.2 standardizes on a Canada CDEM import workflow but does not bundle raw
elevation data in the image. Operators should keep source datasets outside the
repo, generate deployment-local tiles or samples, and expose only public-safe
profile points through `/api/v1/public/los/profile`.

Until samples are configured, LOS responses return `sourceStatus:
dataset_workflow_required` with distance, bearing, and sample positions.

## Coverage Guardrails

- Public coverage defaults to coarse cells.
- Coverage data lives in `public_coverage_cells`.
- Do not import raw observer trails or high-precision wardrive data into public
  tables unless a separate privacy review approves it.
