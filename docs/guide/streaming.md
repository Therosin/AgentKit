---
title: Show progress as it happens
description: Use stream() to display text and tool activity while the model is working.
---

# Show progress as it happens

Use `run()` when your app only needs the final answer. Use `stream()` when it helps to show text as it arrives or explain what the agent is doing while it uses tools.

## Read the stream

```ts
for await (const event of agent.stream("Check the latest order and summarize it.")) {
  switch (event.kind) {
    case "response:chunk":
      process.stdout.write(event.text);
      break;

    case "response:tool-call":
      console.log(`\nChecking with ${event.name}…`);
      break;

    case "response:tool-result":
      console.log(`\n${event.name} finished.`);
      break;

    case "response:finish":
      console.log("\nDone.");
      break;

    case "response:error":
      console.error("The request did not finish:", event.error);
      break;
  }
}
```

The stream is an async iterator. Each event has a `kind`, so your interface can choose whether to show text, a progress indicator, tool activity, or an error. Tool events are useful for a status message; they do not mean you need to display every tool input or result to the end user.

## Handle structured output

When you pass a schema, `stream()` yields `response:partial` snapshots as the object is generated, followed by a `response:finish` event containing the complete result:

```ts
const events = agent.stream("Suggest a name and a short description.", {
  schema: z.object({ name: z.string(), description: z.string() }),
});

for await (const event of events) {
  if (event.kind === "response:partial") {
    // Use this partial snapshot for a live preview.
    console.log(event.data);
  }

  if (event.kind === "response:finish") {
    // Use the complete object when the response is done.
    saveSuggestion(event.result.output);
  }
}
```

Partials may not contain every field yet. Treat them as previews and wait for `response:finish` before using the completed object. If a field is marked with the `secure` option, AgentKit removes it from partials and replaces it with a reference in the final output.

## Stop a request

Pass an `AbortSignal` when the user can cancel a long-running request:

```ts
const controller = new AbortController();
const stream = agent.stream("Write a detailed trip plan.", {
  abortSignal: controller.signal,
});

// Call this from your Cancel button handler.
cancelButton.onclick = () => controller.abort();

for await (const event of stream) {
  if (event.kind === "response:chunk") showText(event.text);
  if (event.kind === "response:error") showStoppedOrError(event.error);
}
```

Aborting ends the generation and the stream reports the failure as `response:error`, so your interface can stop its progress indicator and explain what happened.
