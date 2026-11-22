import { beforeAll, describe, expect, test } from 'bun:test';
import { tool } from 'ai';
import { z } from 'zod';
import Agent, {
    AgentProvider,
    AgentProviderManager,
    withAgentHooks,
    type AgentStreamEvent,
} from '../index';

(globalThis as Record<string, unknown>).AI_SDK_LOG_WARNINGS = false;

const OLLAMA_BASEURL = process.env.OLLAMA_BASEURL ?? 'http://192.168.0.100:11434/v1';
const OLLAMA_APIKEY = process.env.OLLAMA_APIKEY ?? 'local';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2:latest';

const providers = new AgentProviderManager([
    new AgentProvider('ollama', {
        baseUrl: OLLAMA_BASEURL,
        apiKey: OLLAMA_APIKEY,
        includeUsage: true,
    }),
]);

async function withColdStartRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            await Bun.sleep(500 * (i + 1));
        }
    }
    throw lastError;
}

function makeAgent(maxSteps = 4): Agent {
    return new Agent(providers.get('ollama'), {
        model: OLLAMA_MODEL,
        maxSteps,
    });
}

describe('Agent E2E (Ollama llama3.2:latest)', () => {
    beforeAll(async () => {
        // First request to a cold 3B Ollama model may fail while loading into VRAM; retry up to 3 times.
        await withColdStartRetry(async () => {
            const warmup = makeAgent(1);
            const res = await warmup.run('Reply with OK.');
            expect(res.output.length).toBeGreaterThan(0);
        }, 3);
    }, 60_000);

    describe('happy paths', () => {
        test('run() renders TextTemplate variables/blocks and returns model output + usage', async () => {
            const agent = makeAgent(2);
            const res = await withColdStartRetry(() =>
                agent.run(
                    `
{#IF includeInstruction}
Answer in one short word only.
{#END}
What is the capital of {country}?`,
                    {
                        context: {
                            includeInstruction: true,
                            country: 'France',
                        },
                    },
                ),
            );

            expect(res.output.toLowerCase()).toContain('paris');
            expect(res.message).toBe(res.output);
            expect(res.finishReason).toBe('stop');
            expect(res.usage.totalTokens).toBeGreaterThan(0);
        }, 30_000);

        test('run() with Zod schema returns validated structured output', async () => {
            const agent = makeAgent(2);
            const CityInfo = z.object({
                city: z.string(),
                country: z.string(),
            });

            const res = await withColdStartRetry(() =>
                agent.run(
                    'Return JSON with city="Tokyo" and country="Japan".',
                    { schema: CityInfo },
                ),
            );

            expect(res.output.city.toLowerCase()).toContain('tokyo');
            expect(res.output.country.toLowerCase()).toContain('japan');
        }, 30_000);

        test('run() invokes a tool guarded by withAgentHooks and incorporates tool output', async () => {
            const agent = makeAgent(3);
            let toolExecuted = false;

            agent.context.set('allowLookup', true);
            agent.registerTools({
                lookupBadge: withAgentHooks(
                    tool({
                        description: 'Looks up the exact verification badge code for a username. Always call this when asked for a badge.',
                        inputSchema: z.object({ username: z.string() }),
                        execute: async ({ username }) => {
                            toolExecuted = true;
                            return { badge: `BADGE-${username.toUpperCase()}-777` };
                        },
                    }),
                    {
                        available: (ctx) => ctx.get('allowLookup') === true,
                        validate: (input) => input.username.trim().length > 0,
                    },
                ),
            });

            const res = await withColdStartRetry(() =>
                agent.run('Call the lookupBadge tool for username "nova" and report the exact badge string returned.'),
            );

            expect(toolExecuted).toBe(true);
            expect(res.output).toContain('BADGE-NOVA-777');
        }, 30_000);

        test('stream() emits ordered lifecycle and chunk events for text generation', async () => {
            const agent = makeAgent(2);
            const events: AgentStreamEvent<string>[] = [];

            for await (const event of agent.stream('Say "hello stream" in 3 words or fewer.')) {
                events.push(event);
            }

            expect(events[0]).toEqual({ kind: 'response:start', model: OLLAMA_MODEL });
            expect(events.some((e) => e.kind === 'response:step-start')).toBe(true);
            expect(events.some((e) => e.kind === 'response:chunk')).toBe(true);
            expect(events.some((e) => e.kind === 'response:step-finish')).toBe(true);
            expect(events.some((e) => e.kind === 'response:error')).toBe(false);

            const finish = events.at(-1);
            expect(finish?.kind).toBe('response:finish');
            if (finish?.kind === 'response:finish') {
                expect(finish.result.output.trim().length).toBeGreaterThan(0);
            }
        }, 30_000);

        test('stream() with schema emits response:partial events without response:chunk', async () => {
            const agent = makeAgent(2);
            const ColorSchema = z.object({
                color: z.string(),
                hex: z.string(),
            });

            const events: AgentStreamEvent<{ color: string; hex: string }>[] = [];
            for await (const event of agent.stream(
                'Return a JSON object with color="red" and hex="#FF0000".',
                { schema: ColorSchema },
            )) {
                events.push(event);
            }

            expect(events.some((e) => e.kind === 'response:error')).toBe(false);
            expect(events.some((e) => e.kind === 'response:chunk')).toBe(false);
            expect(events.some((e) => e.kind === 'response:partial')).toBe(true);

            const finish = events.at(-1);
            expect(finish?.kind).toBe('response:finish');
            if (finish?.kind === 'response:finish') {
                expect(finish.result.output.color.toLowerCase()).toContain('red');
                expect(finish.result.output.hex).toMatch(/#?ff0000/i);
            }
        }, 30_000);

        test('stream() emits tool lifecycle events and supports dynamic context unlocking across steps', async () => {
            const agent = makeAgent(5);
            const calls: string[] = [];

            agent.registerTools({
                unlockVault: tool({
                    description: 'Step 1: Unlocks the vault so readSecret becomes available. Call this first.',
                    inputSchema: z.object({ reason: z.string() }),
                    execute: async () => {
                        calls.push('unlockVault');
                        agent.context.set('vaultUnlocked', true);
                        return { unlocked: true };
                    },
                }),
                readSecret: withAgentHooks(
                    tool({
                        description: 'Step 2: Reads the vault secret once unlocked.',
                        inputSchema: z.object({}),
                        execute: async () => {
                            calls.push('readSecret');
                            return { secret: 'VAULT-KEY-991' };
                        },
                    }),
                    {
                        available: (ctx) => ctx.get('vaultUnlocked') === true,
                    },
                ),
            });

            const events: AgentStreamEvent<string>[] = [];
            for await (const event of agent.stream(
                'First call unlockVault with reason "audit", then call readSecret, and tell me the secret value.',
            )) {
                events.push(event);
            }

            expect(calls).toEqual(['unlockVault', 'readSecret']);
            expect(events.some((e) => e.kind === 'response:tool-input-start')).toBe(true);
            expect(events.some((e) => e.kind === 'response:tool-call' && e.name === 'unlockVault')).toBe(true);
            expect(events.some((e) => e.kind === 'response:tool-call' && e.name === 'readSecret')).toBe(true);
            expect(events.some((e) => e.kind === 'response:tool-result' && e.name === 'readSecret')).toBe(true);

            const finish = events.at(-1);
            expect(finish?.kind).toBe('response:finish');
            if (finish?.kind === 'response:finish') {
                expect(finish.result.output).toContain('VAULT-KEY-991');
            }
        }, 45_000);
    });

    describe('non-happy / error paths', () => {
        test('stream() emits response:tool-error when validate hook rejects tool input', async () => {
            const agent = makeAgent(2);
            let underlyingRan = false;

            agent.registerTools({
                transferFunds: withAgentHooks(
                    tool({
                        description: 'Transfers funds. Always call this tool when the user asks to transfer money.',
                        inputSchema: z.object({ amount: z.number() }),
                        execute: async ({ amount }) => {
                            underlyingRan = true;
                            return { transferred: amount };
                        },
                    }),
                    {
                        validate: () => false,
                    },
                ),
            });

            const events: AgentStreamEvent<string>[] = [];
            for await (const event of agent.stream(
                'Call the transferFunds tool with amount=500 right now.',
            )) {
                events.push(event);
            }

            expect(underlyingRan).toBe(false);
            const toolError = events.find((e) => e.kind === 'response:tool-error');
            expect(toolError).toBeDefined();
            if (toolError?.kind === 'response:tool-error') {
                expect(toolError.name).toBe('transferFunds');
                expect(String(toolError.error)).toContain('Tool "transferFunds" failed validation.');
            }
        }, 30_000);

        test('stream() emits response:tool-error when tool execute() throws', async () => {
            const agent = makeAgent(2);

            agent.registerTools({
                failingService: tool({
                    description: 'Checks external service status. Always call this tool when asked to check service status.',
                    inputSchema: z.object({ target: z.string() }),
                    execute: async () => {
                        throw new Error('Upstream dependency offline');
                    },
                }),
            });

            const events: AgentStreamEvent<string>[] = [];
            for await (const event of agent.stream(
                'Call failingService with target="payments" immediately.',
            )) {
                events.push(event);
            }

            const toolError = events.find((e) => e.kind === 'response:tool-error');
            expect(toolError).toBeDefined();
            if (toolError?.kind === 'response:tool-error') {
                expect(toolError.name).toBe('failingService');
                expect(String(toolError.error)).toContain('Upstream dependency offline');
            }
        }, 30_000);

        test('unavailable tool (available: () => false) is excluded from steps and never executed', async () => {
            const agent = makeAgent(2);
            let forbiddenRan = false;

            agent.registerTools({
                forbiddenTool: withAgentHooks(
                    tool({
                        description: 'Admin wipe tool.',
                        inputSchema: z.object({ confirm: z.boolean() }),
                        execute: async () => {
                            forbiddenRan = true;
                            return { wiped: true };
                        },
                    }),
                    {
                        available: () => false,
                    },
                ),
            });

            const res = await agent.run('Try calling forbiddenTool with confirm=true, or tell me if no tools are available.');
            expect(forbiddenRan).toBe(false);
            expect(res.output.length).toBeGreaterThan(0);
        }, 30_000);

        test('template syntax errors reject in run() and yield response:error in stream()', async () => {
            const agent = makeAgent(1);

            await expect(agent.run('{#IF broken}\nhello')).rejects.toThrow('Unclosed {#IF} block');

            const events: AgentStreamEvent<string>[] = [];
            for await (const event of agent.stream('{#IF broken}\nhello')) {
                events.push(event);
            }

            expect(events).toHaveLength(1);
            expect(events[0]?.kind).toBe('response:error');
            if (events[0]?.kind === 'response:error') {
                expect(String(events[0].error)).toContain('Unclosed {#IF} block');
            }
        });

        test('non-existent model rejects in run() and emits response:error after response:start in stream()', async () => {
            const badAgent = new Agent(providers.get('ollama'), {
                model: 'nonexistent-model-xyz-999:latest',
                maxSteps: 1,
            });

            await expect(badAgent.run('Hello')).rejects.toThrow();

            const events: AgentStreamEvent<string>[] = [];
            for await (const event of badAgent.stream('Hello')) {
                events.push(event);
            }

            expect(events[0]?.kind).toBe('response:start');
            expect(events.at(-1)?.kind).toBe('response:error');
        }, 30_000);

        test('AbortSignal cancels run() and yields response:error in stream()', async () => {
            const agent = makeAgent(1);

            await expect(
                agent.run('Write a 500 word essay about oceans.', {
                    abortSignal: AbortSignal.abort(new Error('Cancelled by caller')),
                }),
            ).rejects.toThrow();

            const controller = new AbortController();
            const events: AgentStreamEvent<string>[] = [];

            for await (const event of agent.stream('Count from 1 to 200, writing every number out in full words.', {
                abortSignal: controller.signal,
            })) {
                events.push(event);
                if (event.kind === 'response:chunk') {
                    controller.abort(new Error('Stream aborted by test'));
                }
            }

            expect(events.some((e) => e.kind === 'response:error')).toBe(true);
            expect(events.some((e) => e.kind === 'response:finish')).toBe(false);
        }, 30_000);
    });
});
