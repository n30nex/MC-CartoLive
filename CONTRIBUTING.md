# Contributing

Thanks for helping improve the MeshCore Canada live map.

## Development Setup

Prerequisites:

- Docker and Docker Compose
- Go 1.25.11+
- Node.js 22+

Local Docker run:

```bash
cp .env.example .env
docker compose up --build
```

Open `http://localhost:39476`.

Without MQTT credentials, use the synthetic fixture path documented in
`docs/development.md`.

## Checks

Run these before sending a pull request:

```bash
cd backend
go test ./...
```

```bash
cd web
npm ci
npm test -- --run
npm run build
```

```bash
docker compose build
```

## Privacy Rules

Do not include real MQTT credentials, channel secrets, private keys, live
databases, WAL files, SHM files, or real packet captures in any commit or issue.
Use synthetic fixtures for reproducible examples.

## Pull Requests

Keep changes scoped and include tests for backend privacy rules, packet
resolution behavior, frontend scheduling/animation behavior, or deployment
changes when those areas are touched.
