---
title: Personalize a prompt
description: Fill a prompt with request-specific values and share app state with tools.
---

# Personalize a prompt

When a request includes details from your app, keep the prompt reusable and provide those details at call time.

## Fill in values

```ts
const result = await agent.run(
  "Write a friendly welcome for {firstName}. They are interested in {topic}.",
  {
    context: {
      firstName: "Mina",
      topic: "beginner gardening",
    },
  },
);
```

The `context` option here fills placeholders in the prompt. It is separate from `agent.context`, which stores application state that tool hooks can inspect.

## Add a small conditional

Template directives can include or skip a line based on a value:

```ts
const prompt = `
Write a welcome for {firstName}.
{#IF returningUser}
Mention that it is nice to see them again.
{#ELSE}
Briefly explain how to get started.
{#END}
`;

const result = await agent.run(prompt, {
  context: { firstName: "Mina", returningUser: true },
});
```

Directives occupy their own lines. The supported blocks are `IF`/`ELSE`/`END`, `FOR`/`END`, and `WITH`/`END`; use them when assembling prompt text from ordinary app data.

For example, to include a user's selected topics in a reusable request:

```ts
const result = await agent.run(
  `Suggest one project for each topic:
{#FOR topic IN topics}
- {topic}
{#END}`,
  { context: { topics: ["gardening", "woodworking", "photography"] } },
);
```

The loop repeats its body for each item, so the prompt contains a simple list without your application having to build the whole string by hand.

## Keep tool state separate

Tool hooks receive the agent's live state as a read-only map, and your application can update that state between calls:

```ts
agent.context.set("signedIn", true);

const isSignedIn = agent.context.get("signedIn") === true;
```

For a complete availability example, see [Build a tool workflow](/guide/tool-workflows#make-a-tool-available-only-when-it-makes-sense).
