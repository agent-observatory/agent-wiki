# Agent Wiki

An evidence-backed knowledge source for agents answering questions and doing work. The web wiki supports editing and source review. Workspaces isolate knowledge and access; folders and tags organize it.

**Status: design only.** No application or infrastructure has been deployed.

```text
Raw sources → Ingest → Wiki → Query → Answers
```

Keyword search first; embeddings later. NVIDIA-hosted Kimi and DeepSeek handle knowledge extraction. The deployment plan uses OCI Container Instances for the app and a separate Compute VM for single-instance PostgreSQL. Caddy stores certificate state in private OCI Object Storage via an S3 storage module. Free OCI eligibility and runtime integration remain unverified.

- [Documentation](docs/README.md)
- [Architecture and diagrams](docs/wiki/README.md)
- [Design guidelines](docs/DESIGN.md)

Regenerate diagrams: `python3 scripts/generate-wiki-diagrams.py`

SVGs use Noto Sans KR Regular/Bold. [Icon sources and licenses](docs/assets/icons/SOURCES.md).
