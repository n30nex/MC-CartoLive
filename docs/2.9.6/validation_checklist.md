# MC-CartoLive 2.9.6 Validation Checklist

## Local

- [ ] `cd backend && go test ./...`
- [ ] `cd web && npm test -- --run`
- [ ] `cd web && npm run build`
- [ ] `node scripts/check-version-sync.mjs`
- [ ] `node scripts/public-schema-check.mjs`
- [ ] `git diff --check`

## Waterfall Labs

- [ ] `/#/lab/waterfall` renders the Packet Waterfall workspace.
- [ ] `/#/lab`, `/#/lab/synth`, and another retired Labs URL redirect to
  `/#/lab/waterfall`.
- [ ] Waterfall controls render without clipping on desktop and mobile.
- [ ] The Waterfall canvas paints nonblank pixels.
- [ ] Audio remains muted until explicitly enabled.
- [ ] Generated Waterfall assets are present under `web/public/labs/waterfall/`.

## Package And Live

- [ ] Container build passes for `ghcr.io/n30nex/mc-cartolive:2.9.6`.
- [ ] Package smoke passes against the built image.
- [ ] Browser smoke passes on desktop and mobile.
- [ ] Droplet fast-forward/rebuild completes.
- [ ] `/healthz` reports version `2.9.6` and the expected git SHA.
- [ ] Live smoke passes against `https://carto.canadaverse.org`.

## Privacy

- [ ] Public privacy scan passes.
- [ ] Waterfall Labs uses only public-safe DTO fields.
- [ ] No generated screenshot, doc, or asset includes private live packet data.

