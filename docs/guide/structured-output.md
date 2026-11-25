---
title: Ask for a typed answer
description: Return an object that follows a Zod schema, and keep selected fields secure.
---

# Ask for a typed answer

Use structured output when the rest of your application needs predictable fields instead of a paragraph. Pass a Zod schema to `run()` and AgentKit asks the model for an object that matches it.

## Turn a request into an object

```ts
import { z } from "zod";

const TripPlan = z.object({
  destination: z.string(),
  days: z.number().int(),
  ideas: z.array(z.string()),
});

const result = await agent.run(
  "Suggest a three-day trip to Kyoto with two activity ideas per day.",
  { schema: TripPlan },
);

console.log(result.output.destination);
console.log(result.output.ideas);
```

The returned `output` is the typed object. You can pass it to another part of your app without first parsing a block of prose.

## Return a reference instead of a raw value

You can mark fields in structured output as secure. The model generates these values, so the model provider receives them. AgentKit replaces the marked fields with references in the returned object and stores their values on the agent. With `stream()`, marked fields are also removed from partial output events before AgentKit emits them. This option does not hide generated values from the model or its provider:

```ts
const Credentials = z.object({
  username: z.string(),
  password: z.string(),
});

const result = await agent.run(
  "Return credentials for the demo account.",
  { schema: Credentials, secure: ["password"] },
);

console.log(result.output.username);
// result.output.password is a secure:// reference.

const password = agent.secure.take(result.output.password);
```

Use the same `secure` option with `stream()` to suppress marked fields from partial structured-output events as they arrive. See [Secure values](/guide/secure-values) for sharing a sensitive value between tools.
