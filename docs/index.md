---
layout: home
title: AgentKit
description: Build tool-using TypeScript agents with practical examples.
hero:
  name: AgentKit
  text: Give your model useful tools.
  tagline: Build small TypeScript agents that can answer, take action, and keep sensitive values out of the model's view.
  actions:
    - theme: brand
      text: Make your first agent
      link: /guide/getting-started
    - theme: alt
      text: Explore examples
      link: /guide/tool-workflows
features:
  - title: Let an agent take action
    details: Connect ordinary AI SDK tools to your model, then let it choose when to call them.
  - title: Pass secrets safely
    details: Keep passwords and tokens in a secure store while tools pass opaque references between steps.
  - title: Fit your app
    details: Get a single answer with run(), or handle live text and progress events with stream().
---

AgentKit is a small layer around the [Vercel AI SDK](https://ai-sdk.dev/) for building agents in TypeScript. You bring the model and the tools; AgentKit helps connect them into a useful workflow.

## Pick a task

- [Make your first agent](/guide/getting-started): connect a model, add a tool, and ask it to do something.
- [Build a tool workflow](/guide/tool-workflows): give the model a few focused actions, with examples for validation and tool availability.
- [Keep a value private between tools](/guide/secure-values): generate a password or token, then pass it to another tool without returning the raw value to the model.
- [Return a typed answer](/guide/structured-output): ask for an object that matches a Zod schema.
- [Show progress as it happens](/guide/streaming): handle text, tool activity, and completion as events.
- [Personalize a prompt](/guide/prompts-and-context): fill in names and other app data before a request is sent.

## What happens when an agent runs?

You give AgentKit a model, a prompt, and a set of tools. The model can answer directly or ask to use a tool. AgentKit runs the tool and gives its result back to the model, which can then choose another action or write a response.

```text
Your app → AgentKit → model
             ↑          ↓
             └── tools ←┘
```

AgentKit does not decide what your tools should do. You write their `execute` functions and choose which operations are safe to expose.

## Before you start

You will need Bun or Node.js, a model provider compatible with the AI SDK, and the provider's model identifier. The first guide starts with a local Ollama example; you can swap in another OpenAI-compatible endpoint in [Models and providers](/guide/models-and-providers).

## Working on AgentKit

If you are contributing to the toolkit itself, see [Development](/guide/development) for setup, checks, and local docs commands.
