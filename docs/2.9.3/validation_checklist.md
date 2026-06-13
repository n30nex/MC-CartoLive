# MC-CartoLive 2.9.3 Validation Checklist

## Local Gates

- [x] `cd backend && go test ./...`
- [x] `cd web && npm test -- --run src/lab.test.ts src/components/LabPanel.test.tsx src/components/LinkBar.test.tsx`
- [x] `cd web && npm test -- --run`
- [x] `cd web && npm run build`
- [x] `node scripts/check-version-sync.mjs`
- [ ] `node scripts/check-public-privacy.mjs http://127.0.0.1:39476`
- [ ] browser smoke for `/#/lab`
- [ ] package smoke

Local package smoke moved to droplet validation after the local Podman WSL
machine failed with a corrupted `podman-machine-default` user database. The
broken local machine was removed with `wsl --unregister podman-machine-default`.

## Droplet Gates

- [ ] pull pushed 2.9.3 commit on `/opt/MC-CartoLive`
- [ ] `cd backend && go test ./...`
- [ ] `cd web && npm test -- --run`
- [ ] `cd web && npm run build`
- [ ] container build/deploy through `scripts/deploy.sh`
- [ ] live public privacy smoke
- [ ] live Labs browser smoke

## Release Evidence

- Version: `2.9.3`
- Scope: Labs workspace, public-safe lab selectors, Web Audio/Canvas experiments,
  top-bar navigation, tests, and docs.
- Public API: no new public endpoint or DTO field.
- Deployment: pending.
