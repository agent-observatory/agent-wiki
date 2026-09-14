# Agent Wiki

A personal knowledge space for you and your agents. Review decisions, preserve evidence, and manage knowledge through your agent and CLI. The web is a read-only viewer.

- Workspace isolation, GitHub owner login, scoped agent API keys
- Keyword and glossary-alias search; no embedding dependency
- Background text refinement with source spans and revision lineage
- Next.js, Fastify, PostgreSQL, K3s, Terraform

**First release deployed:** [agent-wiki.duckdns.org](https://agent-wiki.duckdns.org). Owner-only GitHub login. Source collection, knowledge APIs, and URL-based pages are live. See [implementation and deployment status](docs/OPERATIONS.md).

A read-only Collector and remote AI Worker run outside the active conversation. BYOK settings control the provider, model, credentials and optional limits through the CLI. The `agent-wiki-client` package in `packages/agent-wiki-client` includes `agent-wiki-cli`, `agent-wiki-collector` and the Agent Wiki Skill. The Skill guides retrieval and user-authorized review, the CLI executes queries and management commands, and the Collector runs independently. See the installation guide below. Development mode allows a clean data reset; backward compatibility is not required.

## Development

Node.js 22.21+, Docker and PostgreSQL 17 are required.

```sh
npm ci
npm --prefix apps/agent-wiki-web ci
npm run typecheck
npm run build
```

`scripts/test-local-db.sh` starts a disposable PostgreSQL container with the same image, roles and port as CI, then runs migration and the full test suite. Run `scripts/test-local.sh` directly only when you manage the database yourself. Test credentials are synthetic and restricted to localhost / CI.

[Agent workflow](docs/client-and-api.md) · [Architecture](docs/architecture.md) · [Operations](docs/OPERATIONS.md)
