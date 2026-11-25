# AgentKit

AgentKit helps you build TypeScript agents that can use tools, return structured answers, and pass sensitive values between tools without exposing the raw values to the model.

It is built on the [Vercel AI SDK](https://ai-sdk.dev/). You define what the model can do; AgentKit connects those tools to a model and handles the run or stream.

## See how it works

```ts
import Agent, { AgentProvider } from "agentkit";
import { tool } from "ai";
import { z } from "zod";

const provider = new AgentProvider("local", {
  baseUrl: "http://localhost:11434/v1",
  apiKey: "local",
});
const agent = new Agent(provider, { model: "llama3.2:latest" });

agent.registerTools({
  look_up_order: tool({
    description: "Look up an order by its order number.",
    inputSchema: z.object({ orderNumber: z.string() }),
    execute: async ({ orderNumber }) => ({
      orderNumber,
      status: "in transit",
    }),
  }),
});

const result = await agent.run("Check order A-104 and summarize its status.");
console.log(result.output);
```

The model can choose to call `look_up_order`, use the result, and then answer. The [getting started guide](./docs/guide/getting-started.md) walks through a complete setup, and the [documentation home](./docs/index.md) has examples for common tasks.

## Work on AgentKit

```sh
bun install
bun run typecheck
bun run test:offline
bun run build
```

The offline suite does not contact an inference endpoint. End-to-end tests use an Ollama-compatible endpoint:

```sh
bun run test:e2e
```

Run the docs locally with `bun run docs:dev`. See [Development](./docs/guide/development.md) for environment variables and the full set of docs commands.
