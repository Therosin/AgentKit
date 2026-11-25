---
title: Build a tool workflow
description: Give an agent a few focused actions and guide it through a multi-step task.
---

# Build a tool workflow

Tools let the model ask your application to do something: search a catalog, check an order, or create a draft. A tool should have a clear job and return only the information the model needs for the next step.

## Register a few tools

```ts
import { tool } from "ai";
import { z } from "zod";

agent.registerTools({
  find_order: tool({
    description: "Find an order by its public order number.",
    inputSchema: z.object({ orderNumber: z.string() }),
    execute: async ({ orderNumber }) => {
      // Replace with a database or service lookup.
      return { orderNumber, status: "in transit", eta: "Friday" };
    },
  }),
  prepare_reply: tool({
    description: "Prepare a short customer-support reply about an order.",
    inputSchema: z.object({ status: z.string(), eta: z.string() }),
    execute: async ({ status, eta }) => ({
      draft: `Your order is ${status} and should arrive ${eta}.`,
    }),
  }),
});

const result = await agent.run(
  "Look up order A-104, prepare a reply, and show me the draft.",
);
```

The model chooses whether to call one or both tools and how to use their results. When actions must happen in a particular order, make that clear in the tool descriptions and in the user's request. The application should still validate important conditions itself.

## Check an action before it runs

Use `validate` when a tool should reject an input before its `execute` function runs:

```ts
import { tool } from "ai";
import { z } from "zod";
import { withAgentHooks } from "agentkit";

const refundOrder = withAgentHooks(
  tool({
    description: "Issue a refund for an order after it has been checked.",
    inputSchema: z.object({
      orderNumber: z.string(),
      amount: z.number().positive(),
    }),
    execute: async ({ orderNumber, amount }) => {
      // Call your payment service here.
      return { refunded: true, orderNumber, amount };
    },
  }),
  {
    validate: async ({ orderNumber, amount }) => {
      const order = await findOrderInYourApp(orderNumber);
      return order.canRefund && amount <= order.refundableAmount;
    },
  },
);

agent.registerTools({ refund_order: refundOrder });
```

Replace `findOrderInYourApp` with your own lookup. If validation returns `false`, AgentKit reports a tool error to the model and does not run the refund function. Keep final authorization and business rules in your application.

## Make a tool available only when it makes sense

An `available` hook controls whether the model can see a tool on each step. For example, a private lookup might only be offered after a user has signed in:

```ts
const readProfile = withAgentHooks(
  tool({
    description: "Read the signed-in user's profile.",
    inputSchema: z.object({}),
    execute: async () => loadCurrentProfile(),
  }),
  {
    available: (context) => context.get("signedIn") === true,
  },
);

agent.context.set("signedIn", true);
agent.registerTools({ read_profile: readProfile });
```

Use `agent.context` to hold app state that tool availability checks need. The hook is checked again before every model step, so a tool can become available after another tool changes that state.

## Register tools in groups

You can register a toolset, a named tool, or a named group. For example:

```ts
agent.registerTools(
  { find_order: findOrderTool },
  { name: "support", tools: { prepare_reply: prepareReplyTool } },
);
```

Use whichever shape makes your tool setup easiest to organize. See [Secure values](/guide/secure-values) for a multi-tool workflow that passes a password safely.
