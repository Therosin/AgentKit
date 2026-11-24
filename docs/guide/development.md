---
title: Development
description: Set up AgentKit locally, run its checks, and work on the documentation site.
---

# Development

## Requirements

- [Bun](https://bun.sh/) for installing dependencies, running tests, and serving the documentation.
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

End-to-end tests use the configured Ollama endpoint and model:

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
