# AgentKit

AgentKit is a TypeScript agent toolkit built on the Vercel AI SDK. The documentation source is in [`docs/`](./docs/).

## Development

```sh
bun install
bun run typecheck
bun run test:offline
bun run build
```

The offline test suite does not contact an inference endpoint. End-to-end tests use Ollama:

```sh
bun run test:e2e
```

## Documentation

```sh
bun run docs:dev
bun run docs:build
bun run docs:preview
```
