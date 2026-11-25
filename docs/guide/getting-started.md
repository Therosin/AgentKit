---
title: Make your first agent
description: Set up a model, give it one useful tool, and run a request.
---

# Make your first agent

This example gives an agent a small catalog tool. Ask for a recommendation, and the model can call the tool before it answers.

## Install the packages

In a new project:

```sh
bun add github:Therosin/AgentKit#main ai zod
```

This installs AgentKit directly from its GitHub `main` branch for now; the project is not yet published to npm or JSR. The `ai` package provides the `tool()` helper, and Zod describes the tool's input. Bun uses `#ref` to select a branch, tag, or commit for a GitHub dependency.

## Connect a model

For a local Ollama server with its OpenAI-compatible API enabled:

```ts
import Agent, { AgentProvider } from "agentkit";

const provider = new AgentProvider("local", {
  baseUrl: "http://localhost:11434/v1",
  apiKey: "local",
});

const agent = new Agent(provider, {
  model: "llama3.2:latest",
  maxSteps: 5,
});
```

`maxSteps` is the maximum number of model turns in one run. Leave room for a tool call and the model's follow-up answer. A model also needs to support the tool-calling features used by your workflow.

If you use a different provider, change the provider URL, credentials, and model name. See [Models and providers](/guide/models-and-providers).

## Give it one useful action

Add a tool that looks up a product by category:

```ts
import { tool } from "ai";
import { z } from "zod";

agent.registerTools({
  find_product: tool({
    description: "Find a product in the catalog by category.",
    inputSchema: z.object({
      category: z.string(),
    }),
    execute: async ({ category }) => {
      const catalog = {
        books: ["The Left Hand of Darkness", "Kindred"],
        tea: ["Jasmine green tea", "Earl Grey"],
      };

      return catalog[category as keyof typeof catalog] ?? [];
    },
  }),
});
```

The description helps the model decide when the action is useful. The schema says what arguments it must provide. The `execute` function is regular application code: replace the sample catalog with your database or service call.

## Ask for a recommendation

```ts
const result = await agent.run(
  "Find a book in the catalog and recommend one in a sentence.",
);

console.log(result.output);
```

The result includes the final text as `output`, a `message` from the model, usage information, and a finish reason. In this simple example, the agent calls `find_product`, receives the list, and uses it to write its answer.

## Try your own task

Start with one action that has a clear purpose. A good first tool is narrow enough that its name, description, inputs, and result are easy to explain. Add more tools when you have a specific workflow for the model to complete.

Next: [Build a tool workflow](/guide/tool-workflows).
