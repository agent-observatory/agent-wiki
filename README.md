# Agent Wiki

A personal knowledge space for you and your agents. Store decisions, edit linked Markdown, and retrieve evidence with sources and revision history.

- Workspace isolation, GitHub owner login, scoped agent API keys
- Keyword and glossary-alias search; no embedding dependency
- Source ingestion with NVIDIA Kimi / DeepSeek and PostgreSQL jobs
- Next.js, Fastify, PostgreSQL, Docker Compose, Terraform

**First release in progress.** OCI A1 allocation is currently blocked by host capacity; the application is not yet deployed. See [live implementation and deployment status](docs/OPERATIONS.md).

## Development

Node.js 22+, Docker and PostgreSQL 17 are required.

```sh
npm ci
npm --prefix apps/web ci
npm run typecheck
npm run build
```

Configure separate application and migration database roles before running `scripts/test-local.sh`. Test credentials are synthetic and restricted to localhost / CI.

[Architecture](docs/wiki/architecture.md) · [Diagrams](docs/wiki/README.md) · [Operations](docs/OPERATIONS.md)
