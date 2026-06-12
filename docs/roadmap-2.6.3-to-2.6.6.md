# Archived Roadmap: 2.6.3 To 2.6.6

This archive summarizes the 2.6.x planning track. Detailed release history
belongs in [CHANGELOG.md](../CHANGELOG.md).

## Outcome

The 2.6.x line focused on:

- cleaner public map chrome
- Packets and Chat workspace ergonomics
- OpenFreeMap/3D performance
- terrain and elevation context for selected public routes
- early propagation-event research

Most of this work was later folded into the 2.8.x and 2.9.0 release lines.

## Current Guidance

- Keep elevation, terrain, and propagation features explanatory.
- Never infer or draw RF routes from coordinates, terrain, weather, or
  proximity alone.
- Keep propagation and terrain surfaces opt-in for first-time visitors.
