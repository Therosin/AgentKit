---
title: Development
description: Set up AgentKit locally, run its checks, and work on the documentation site.
---

# Development

## Requirements

- [Bun](https://bun.sh/) for installing dependencies, running tests, and serving the documentation.
- Node.js for running the VitePress CLI used by the documentation scripts.
- A reachable Ollama-compatible endpoint only for end-to-end tests.

## Set up the project

```sh
bun install
```

## Checks

The offline suite is the CI-safe test command. It covers unit tests and does not contact Ollama:

```sh
bun run typecheck
bun run test:offline
bun run build
```

End-to-end tests use these environment variables to select the Ollama-compatible endpoint and model:

| Variable | Default |
| --- | --- |
| `OLLAMA_BASEURL` | `http://localhost:11434/v1` |
| `OLLAMA_MODEL` | `llama3.2:latest` |
| `OLLAMA_APIKEY` | `local` |

Set them in the environment before running the suite when your endpoint or model differs from the defaults:

```sh
bun run test:e2e
```

## Work on the docs

Markdown pages live in `docs/`. Start the local development server with:

```sh
bun run docs:dev
```

Build the static site or preview that build locally with:

```sh
bun run docs:build
bun run docs:preview
```

GitHub Actions builds the docs and deploys them to GitHub Pages from `main`.
