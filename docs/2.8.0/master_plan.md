# MC-CartoLive 2.8.0 Release Summary

2.8.0 was the World Release 2 production stabilization release. It promoted the
deep feature line into a production-ready public map with Packets, Chat,
NetGraph, service-worker cleanup, migration fixes, public packet projection
fallbacks, release checks, privacy scans, and safer deployment rollback.

## Delivered Scope

- Stabilized Packets, Chat, and NetGraph on desktop and mobile.
- Disabled service-worker registration by default and added stale-cache cleanup.
- Fixed production SQLite migrations for older databases.
- Fixed public Packets/history fallback behavior for incomplete projections.
- Added proxy-header trust configuration for public rate limiting.
- Hardened deployment with SQLite backup, readiness checks, dirty-tree refusal,
  diagnostics, and rollback.
- Updated privacy checks, release checks, CI triggers, browser smoke, and docs.

## Historical Evidence

The release evidence record is kept in:

- [10_release_completion_evidence_2.8.0.md](10_release_completion_evidence_2.8.0.md)

Older planning notes, task cards, and backlog drafts were removed from the
active docs tree during the 2.9.0 documentation cleanup. They remain available
through git history if needed.
