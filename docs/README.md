# MC-CartoLive Documentation

Start here when working in this repository. Current operator and development
docs are kept short; historical release evidence is preserved by version.

## Current Docs

- [Production deployment](production.md): first deploy, upgrades, runtime notes,
  and production readiness.
- [Operator runbook](operator-runbook.md): smoke checks, diagnostics, backup,
  restore, and privacy checks.
- [Development](development.md): local Podman, fixtures, backend/frontend
  commands, and release checks.
- [Privacy model](privacy.md): private inputs, public outputs, route truth, and
  test expectations.
- [Roadmap](roadmap.md): current baseline and active 2.9.x direction.

## Release Docs

- [2.9.1 release notes](2.9.1/release_notes.md)
- [2.9.1 validation checklist](2.9.1/validation_checklist.md)
- [2.9.1 master plan](2.9.1/master_plan.md)
- [2.9.0 release notes](2.9.0/release_notes.md)
- [2.9.0 validation checklist](2.9.0/validation_checklist.md)
- [2.9.0 master plan](2.9.0/master_plan.md)
- [2.8.2 release notes](2.8.2/release_notes.md)
- [2.8.1 release notes](2.8.1/release_notes.md)
- [2.8.0 release evidence](2.8.0/10_release_completion_evidence_2.8.0.md)

## Historical Roadmaps

These files are intentionally concise archive summaries. Detailed patch history
belongs in [CHANGELOG.md](../CHANGELOG.md).

- [2.9.0 UX roadmap](2.9.0/roadmap.md)
- [2.9.0 frontend performance audit](2.9.0/frontend_performance_audit.md)
- [2.7.5 to 2.7.7 archive](roadmap-2.7.5-to-2.7.7.md)
- [2.6.3 to 2.6.6 archive](roadmap-2.6.3-to-2.6.6.md)
- [2.5.2 to 2.6.0 archive](roadmap-2.5.2-to-2.6.0.md)

## Documentation Rules

- Keep current docs focused on how to operate, develop, validate, and deploy the
  current release.
- Put release-by-release history in `CHANGELOG.md`.
- Put release evidence under `docs/<version>/`.
- Do not add long planning notes, temporary task cards, or investigation drafts
  to the active docs tree. Git history is enough for that material.
