import Agent from "./src/Agent";
import AgentProviderManager, { AgentProvider, type AgentProviderOptions } from "./src/AgentProvider";
import Context from "./src/shared/Context";
import { withAgentHooks } from "./src/AgentTools";
import { tool } from 'ai';
import { z } from 'zod';

type ProviderConf = Record<string, AgentProviderOptions>;

Context.set<ProviderConf>("provider-conf", {
    "local-ollama": {
        baseUrl: process.env.OLLAMA_BASEURL ?? "http://localhost:11434/v1",
        apiKey: process.env.OLLAMA_APIKEY ?? "local",
    },
});

const providers = new AgentProviderManager([
    new AgentProvider("local-ollama", Context.get<ProviderConf>("provider-conf")["local-ollama"] as AgentProviderOptions),
]);

const agent = new Agent(providers.get("local-ollama"), {
    model: process.env.OLLAMA_MODEL ?? "llama3.2:latest",
    maxSteps: 6,
});

// Tool that produces a sensitive value. The raw password is moved into
// agent.secure and replaced with an opaque secure:// reference before the
// model ever sees the tool result.
agent.registerTools({
    generate_password: withAgentHooks(
        tool({
            description: "Generate a random password of the given length. Always call this when asked to create a password.",
            inputSchema: z.object({ length: z.number() }),
            execute: async ({ length }) => ({
                success: true,
                        password: "P".repeat(length),
            }),
        }),
        { secure: ["password"] },
    ),

    // Tool that consumes a (possibly secure) password reference. AgentKit
    // resolves the reference to the raw value before execute() runs, so the
    // model orchestrates the flow without ever knowing the credential.
    create_account: withAgentHooks(
        tool({
            description: "Create an account with a username and password. The password may be a secure:// reference.",
            inputSchema: z.object({ username: z.string(), password: z.string() }),
            execute: async ({ username, password }) => ({
                created: true,
                username,
                passwordLength: password.length,
            }),
        }),
        { secureInputs: ["password"] },
    ),
});

const response = await agent.run(
    "Generate a 12-character password, then create an account for username 'demo' using that password. Report whether the account was created.",
);

console.log("RESPONSE:\n", response.output);

// Structured output can use the same mechanism via AgentRunOptions.secure.
const Creds = z.object({ username: z.string(), password: z.string() });
const structured = await agent.run(
    "Return JSON with username 'demo' and an 8-character password.",
    { schema: Creds, secure: ["password"] },
);

console.log("STRUCTURED OUTPUT:\n", structured.output);
// The model-facing output contains only a reference; retrieve the raw value
// explicitly through the agent's secure store.
const rawPassword = agent.secure.take(structured.output.password);
console.log("RETRIEVED PASSWORD LENGTH:", (rawPassword as string).length);
