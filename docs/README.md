# MC-CartoLive Documentation

Start here when working in this repository. Current docs stay focused on
operating, developing, validating, and deploying the live map. Release evidence
is preserved by version.

## Start Here

| Document | Purpose |
| --- | --- |
| [Production deployment](production.md) | First deploy, upgrades, runtime notes, and production readiness. |
| [Operator runbook](operator-runbook.md) | Smoke checks, diagnostics, backup, restore, and privacy checks. |
| [Development](development.md) | Local Podman, fixtures, backend/frontend commands, and release checks. |
| [Privacy model](privacy.md) | Private inputs, public outputs, route truth, and test expectations. |
| [Roadmap](roadmap.md) | Current baseline and active 3.x direction. |

## 3.1.0 Release Package

| Document | Purpose |
| --- | --- |
| [Release notes](3.1.0/release_notes.md) | Product-facing 3.1.0 overhaul summary and compatibility notes. |
| [Validation checklist](3.1.0/validation_checklist.md) | Local, package, privacy, browser, and live deployment validation checklist. |

## 3.0.2 Release Package

| Document | Purpose |
| --- | --- |
| [Release notes](3.0.2/release_notes.md) | Product-facing 3.0.2 loading motion summary and compatibility notes. |
| [Validation checklist](3.0.2/validation_checklist.md) | Local, skipped-browser, privacy, and live deployment validation checklist. |

## 3.0.1 Shell Package

| Document | Purpose |
| --- | --- |
| [Release notes](3.0.1/release_notes.md) | Product-facing 3.0.1 smooth-shell summary and compatibility notes. |
| [Validation checklist](3.0.1/validation_checklist.md) | Local, browser, and privacy validation checklist. |

## 3.0.0 Asset Pack Package

| Document | Purpose |
| --- | --- |
| [Release notes](3.0.0/release_notes.md) | Product-facing 3.0.0 summary and compatibility notes. |
| [Screenshot tour](3.0.0/screenshot_tour.md) | Current 3.0 map, workspace, NetGraph, Labs, and 3D screenshots. |
| [Operator notes](3.0.0/operator_notes.md) | Deployment-specific 3.0.0 notes for world and Canada presets. |
| [Asset pack notes](3.0.0/asset_pack.md) | v3 asset preset layout, generation workflow, and validation. |
| [Validation checklist](3.0.0/validation_checklist.md) | Local, package, asset, and live deployment evidence. |

## Release Archive

| Version | Primary notes | Additional docs |
| --- | --- | --- |
| 2.9.6 | [release](2.9.6/release_notes.md), [validation](2.9.6/validation_checklist.md) | [operator](2.9.6/operator_notes.md), [Waterfall Labs](2.9.6/waterfall_labs.md) |
| 2.9.5 | [release](2.9.5/release_notes.md), [validation](2.9.5/validation_checklist.md) | [operator](2.9.5/operator_notes.md), [Map Studio](2.9.5/map_studio.md) |
| 2.9.4 | [release](2.9.4/release_notes.md), [validation](2.9.4/validation_checklist.md) | [operator](2.9.4/operator_notes.md), [Labs](2.9.4/labs.md) |
| 2.9.3 | [release](2.9.3/release_notes.md), [validation](2.9.3/validation_checklist.md) | [operator](2.9.3/operator_notes.md) |
| 2.9.2 | [release](2.9.2/release_notes.md), [validation](2.9.2/validation_checklist.md) | [operator](2.9.2/operator_notes.md) |
| 2.9.1 | [release](2.9.1/release_notes.md), [validation](2.9.1/validation_checklist.md) | [master plan](2.9.1/master_plan.md) |
| 2.9.0 | [release](2.9.0/release_notes.md), [validation](2.9.0/validation_checklist.md) | [master plan](2.9.0/master_plan.md), [performance audit](2.9.0/frontend_performance_audit.md) |
| 2.8.x | [2.8.2](2.8.2/release_notes.md), [2.8.1](2.8.1/release_notes.md) | [2.8.0 release evidence](2.8.0/10_release_completion_evidence_2.8.0.md) |

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
