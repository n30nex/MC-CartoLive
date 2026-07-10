# 3.2.0 Security And Operations

## Network boundary

Production Compose publishes diagnostics at `127.0.0.1:39476` and the existing
Cloudflare-facing ingress at port 80. A DigitalOcean Cloud Firewall must allow
port 80 only from the current published Cloudflare IPv4/IPv6 ranges and port 22
only from the operator's current administrative `/32` or `/128`. Confirm a
second SSH session before narrowing SSH rules.

Keep `TRUST_PROXY_HEADERS=false` unless `TRUSTED_PROXY_CIDRS` contains the exact
immediate proxy networks. The backend ignores forwarded client addresses from
untrusted peers. The public application listener always returns 404 for
`/metrics`; production Compose exposes the distinct metrics listener only at
host loopback `127.0.0.1:39090`. The hosted service must keep
`METRICS_PUBLIC=false`.

Production Compose enables forwarded addresses only for the committed official
Cloudflare ranges in `deploy/cloudflare-cidrs.txt`. CI compares that list with
Cloudflare's published [IPv4](https://www.cloudflare.com/ips-v4/) and
[IPv6](https://www.cloudflare.com/ips-v6/) endpoints. When Cloudflare changes the list,
update the file, the Compose default, and the matching DigitalOcean Firewall
rules in one reviewed change; never widen trust to all peers.

## Image and workflow trust

- Production accepts only `image@sha256:<64 hex>` references.
- Base images and GitHub Actions are pinned to immutable digests/commit SHAs.
- The candidate contains amd64 and arm64 manifests with BuildKit provenance and
  SBOM attestations.
- Tag promotion verifies that every release tag resolves to the tested
  candidate digest; it never rebuilds.
- Release archives include an SPDX SBOM, vulnerability SARIF, checksums,
  OpenAPI, and a manifest binding version/SHA/digest/schema.

## Alerts

Configure DigitalOcean alerts to the account operations email:

- disk above 80% for five minutes and a separate 90% critical alert
- memory above 85% for ten minutes
- CPU above 90% for ten minutes (the supported DigitalOcean alert window)
- external `/readyz` failure for three consecutive probes

The application also reports sanitized storage pressure and bounded writer
queue signals. A disk-full state is an operator incident, not a restart trigger.

## Secret and public-data controls

No build argument accepts weather, broker, channel, or other credentials.
Runtime secrets stay only in `.env`; release identity stays only in the signed
artifact. Public scans cover every HTTP route plus the first WebSocket envelope.
Never attach live databases, packet captures, credentials, or `data/config.yaml`
to a release or CI artifact.
