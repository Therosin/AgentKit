---
title: Keep values private between tools
description: Pass passwords, tokens, and other sensitive values between tools using secure references.
---

# Keep values private between tools

Sometimes one tool creates a sensitive value and another needs it. For example, a password generator creates a password that an account-creation tool must receive. The model needs to coordinate those actions, but it does not need to read the password itself.

AgentKit can replace a selected tool-output field with an opaque `secure://` reference before returning that result to the model. A consuming tool can declare the input field it needs; AgentKit resolves a known reference immediately before calling that tool's `execute` function.

## Create the password, then use it

```ts
import { tool } from "ai";
import { z } from "zod";
import { withAgentHooks } from "agentkit";

agent.registerTools({
  generate_password: withAgentHooks(
    tool({
      description: "Generate a random password of the given length.",
      inputSchema: z.object({ length: z.number().int().min(12) }),
      execute: async ({ length }) => ({
        password: await makeRandomPassword(length),
      }),
    }),
    { secure: ["password"] },
  ),

  create_account: withAgentHooks(
    tool({
      description: "Create an account with a username and password.",
      inputSchema: z.object({ username: z.string(), password: z.string() }),
      execute: async ({ username, password }) => {
        await saveAccount({ username, password });
        return { created: true, username };
      },
    }),
    { secureInputs: ["password"] },
  ),
});

const result = await agent.run(
  "Generate a password and create an account for username 'demo'. Tell me whether it worked; do not reveal the password.",
);

console.log(result.output);
```

`secure: ["password"]` marks the generated field for protection. The model receives a result shaped like `{ password: "secure://…" }`, not the raw password. `secureInputs: ["password"]` tells AgentKit to replace a matching stored reference with the original value just before `create_account.execute` runs.

## Why the calls may take more than one step

The model can see both tools at once. AgentKit adds guidance to the consumer tool's description to call the producer first. If the model still tries the consumer too early, AgentKit returns a tool error explaining which producer to call and lets the model try again. Give the agent enough `maxSteps` for the initial attempt, recovery, and final response.

This is a model-guided workflow, not a scheduler: the model must respond to the tool error and retry. Test it with the model you plan to use, especially if the workflow depends on recovery.

## Protect nested fields too

Secure paths use dot notation. If a tool returns `{ credentials: { accessToken: "…" } }`, mark it with `secure: ["credentials.accessToken"]`; the consuming tool can use `secureInputs: ["credentials.accessToken"]` for the corresponding input path.

## When your app needs the value

Your application can access the store on the agent. For example, structured output can return a reference and your server can take the raw value for a trusted operation:

```ts
const result = await agent.run("Return a generated password.", {
  schema: z.object({ password: z.string() }),
  secure: ["password"],
});

const password = agent.secure.take(result.output.password);
```

`take()` returns the stored value and removes that reference. Keep the raw value on the trusted side of your application and avoid logging it.
