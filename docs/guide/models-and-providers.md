---
title: Choose a model provider
description: Connect AgentKit to a local or hosted OpenAI-compatible model endpoint.
---

# Choose a model provider

AgentKit uses the AI SDK's OpenAI-compatible provider. Give it the endpoint URL, API key, and the model identifier your provider expects.

## Connect a hosted endpoint

```ts
import Agent, { AgentProvider } from "agentkit";

const provider = new AgentProvider("hosted", {
  baseUrl: process.env.MODEL_BASE_URL!,
  apiKey: process.env.MODEL_API_KEY!,
});

const agent = new Agent(provider, {
  model: process.env.MODEL_NAME!,
  maxSteps: 5,
});
```

Put credentials in environment variables or your deployment's secret manager. Do not hard-code a real API key in source code. The endpoint and model name depend on the provider you choose.

## Use a local Ollama endpoint

If Ollama is serving its OpenAI-compatible API locally, the setup can look like this:

```ts
const provider = new AgentProvider("local", {
  baseUrl: "http://localhost:11434/v1",
  apiKey: "local",
});

const agent = new Agent(provider, {
  model: "llama3.2:latest",
  maxSteps: 6,
});
```

`maxSteps` limits the number of model turns available for a request. Tool workflows need enough turns for the model to call tools and then respond. Tool calling and structured output support can vary by model, so try the workflow with your chosen model.

## Use more than one provider

`AgentProviderManager` keeps providers by name. The first provider registered becomes the default; choose a specific one with `get(name)`:

```ts
import { AgentProvider, AgentProviderManager } from "agentkit";

const providers = new AgentProviderManager([
  new AgentProvider("local", {
    baseUrl: "http://localhost:11434/v1",
    apiKey: "local",
  }),
  new AgentProvider("hosted", {
    baseUrl: process.env.MODEL_BASE_URL!,
    apiKey: process.env.MODEL_API_KEY!,
  }),
]);

const localAgent = new Agent(providers.get("local"), {
  model: "llama3.2:latest",
});
```

You can also register, replace, list, or remove providers as your app needs. Each agent keeps the provider passed to its constructor.
