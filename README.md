# Agent Wiki

A personal knowledge space for you and your agents. Store decisions, edit linked Markdown, and retrieve evidence with sources and revision history.

- Workspace isolation, GitHub owner login, scoped agent API keys
- Keyword and glossary-alias search; no embedding dependency
- Background text refinement with source spans and revision lineage
- Next.js, Fastify, PostgreSQL, Docker Compose, Terraform

**First release deployed:** [agent-wiki.duckdns.org](https://agent-wiki.duckdns.org). Owner-only GitHub login. Source collection, knowledge APIs, and URL-based pages are live. See [implementation and deployment status](docs/OPERATIONS.md).

A read-only Collector and remote AI Worker run outside the active conversation. Workspace settings control the provider, model, credentials and optional limits. The `agent-wiki-client` package in `packages/cli` includes `agent-wiki-cli`, `agent-wiki-collector` and the retrieval Skill. The Skill guides retrieval decisions, the CLI executes queries, and the Collector runs independently. See the installation guide below. Development mode allows a clean data reset; backward compatibility is not required.

## Development

Node.js 22.21+, Docker and PostgreSQL 17 are required.

```sh
npm ci
npm --prefix apps/web ci
npm run typecheck
npm run build
```

Configure separate application and migration database roles before running `scripts/test-local.sh`. Test credentials are synthetic and restricted to localhost / CI.

[Agent workflow](docs/wiki/agent-memory.md) · [Architecture](docs/wiki/architecture.md) · [Diagrams](docs/wiki/README.md) · [Operations](docs/OPERATIONS.md)
