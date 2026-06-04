# Security Policy

## Supported Use

This project is intended to run as a public, read-only MeshCore Canada live map.
The public deployment should use `PUBLIC_MODE=true`, which exposes only:

- `/healthz`
- `/readyz`
- `/api/v1/public/state`
- `/api/v1/public/history`
- `/api/v1/public/history/summary`
- `/api/v1/public/packets`
- `/ws/public`
- the static dashboard

Internal debug APIs must stay disabled for public deployments.

## Private Runtime Data

Never commit or share:

- `.env` or any environment file containing real values
- MQTT usernames or passwords
- MeshCore private keys
- channel secrets used for message decoding
- live SQLite databases, WAL files, or SHM files
- local `data/config.yaml` files with operator-only overrides
- raw packet captures copied from live traffic

The repository ignore rules are configured to keep these files out of git, but
check `git status --ignored` before publishing.

## Reporting Issues

If you find a security or privacy issue, do not open a public issue with
credentials, packet data, or private configuration. Contact the maintainer
privately first, then share only the minimum sanitized reproduction details.

## Public Data Boundary

Public API responses are expected to omit public keys, packet hashes, raw packet
summaries, path hex, observer public keys, and resolver debug reasons. Any
change that touches public response shaping must keep the privacy tests passing.

## Display-String Hardening

MeshCore-controlled display strings, including node names, observer names,
message senders, message text, anchors, and packet-path endpoint labels, are
normalized before they leave the public API/WebSocket boundary. Public display
fields are text only; HTML-significant characters are stripped so crafted node
names cannot become markup in MC-CartoLive or downstream public consumers.

Frontend code should continue to render public strings as text, not HTML.
