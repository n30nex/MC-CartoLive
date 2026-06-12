# Archived Roadmap: 2.7.5 To 2.7.7

This archive summarizes the 2.7.5 to 2.7.7 stabilization track. Detailed
release history belongs in [CHANGELOG.md](../CHANGELOG.md).

## Outcome

The 2.7.x line hardened the app before the 2.8 production push:

- OpenFreeMap/3D scene churn reductions
- system theme support
- node freshness indicators
- route elevation profiles
- backend panic/shutdown hardening
- resolver and MeshCore decoder test expansion
- CI linting and vulnerability-scan groundwork

## Current Guidance

- Keep 3D optional and frontend-only.
- Keep service-worker behavior disabled by default unless a release explicitly
  validates it.
- Keep backend shutdown, WebSocket, MQTT, and resolver tests part of the release
  gate.
