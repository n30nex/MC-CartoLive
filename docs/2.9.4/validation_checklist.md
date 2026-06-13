# MC-CartoLive 2.9.4 Validation Checklist

Date: 2026-06-13

## Local Gates

- [x] `cd backend && go test ./...`
- [x] `cd web && npm test -- --run` - 64 files, 272 tests
- [x] `cd web && npm run build`
- [x] `node scripts/check-version-sync.mjs`
- [x] `git diff --check`
- [x] `node --check scripts/browser-smoke.mjs`

## UI Gates

- [x] Focused Labs/LinkBar/weather tests pass.
- [x] Browser smoke visits all nine Labs experiment routes.
- [x] Browser smoke opens `/#/nodes` and verifies the searchable node browser.
- [x] Desktop Labs workbench shows the toolbar, canvas, metrics, inspector, and
  payload mix without clipping.
- [x] Mobile Labs workbench remains scrollable without horizontal overflow.
- [x] Weather cloud opacity fades to zero before detail-mode zoom.

## Package Gates

- [x] Podman image build passes for `ghcr.io/n30nex/mc-cartolive:2.9.4`.
- [x] Package smoke passes against the Podman image using `--host 172.25.129.67`.
- [x] Public privacy scan passes against synthetic and world package-smoke runs.
- [x] Package browser smoke passes against `http://172.25.129.67:18184`.

## Deployment Gates

- [ ] Pushed commit is deployed on the Canada droplet.
- [ ] `/healthz` reports version `2.9.4`.
- [ ] Live smoke passes against `https://carto.canadaverse.org`.
- [ ] Live browser smoke passes against `https://carto.canadaverse.org`.

## Notes

- Labs remains frontend-only and public-safe.
- No database migration is required.
- Weather cloud changes are visual-only and do not affect public API shapes.
