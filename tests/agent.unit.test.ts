import { describe, expect, test } from 'bun:test';
import { tool } from 'ai';
import { z } from 'zod';
import DefaultAgent, {
    Agent,
    AgentProvider,
    AgentProviderManager,
    asAgentTools,
    withAgentHooks,
} from '../index';
import { Context, ContextRegistry, TextTemplate } from '../src/shared/index';

class TestableAgent extends Agent {
    public exposePrepareTools() {
        return this.prepareTools();
    }

    public exposeRenderPrompt(prompt: string, context?: Record<string, unknown>) {
        return this.renderPrompt(prompt, context);
    }
}

const dummyProvider = new AgentProvider('test', {
    apiKey: 'test-key',
    baseUrl: 'http://localhost:11434/v1',
});

describe('Library Exports', () => {
    test('root and ./shared entrypoints export expected runtime symbols', () => {
        expect(DefaultAgent).toBe(Agent);
        expect(typeof Agent).toBe('function');
        expect(typeof AgentProvider).toBe('function');
        expect(typeof AgentProviderManager).toBe('function');
        expect(typeof withAgentHooks).toBe('function');
        expect(typeof asAgentTools).toBe('function');

        expect(Context).toBeInstanceOf(ContextRegistry);
        expect(typeof TextTemplate).toBe('function');
    });
});

describe('Agent Configuration & Validation', () => {
    test('constructs with default maxSteps=5 and updates settings fluently', () => {
        const agent = new Agent(dummyProvider, { model: 'llama3.2:latest' });

        expect(agent.getModel()).toBe('llama3.2:latest');
        expect(agent.getSettings()).toEqual({ model: 'llama3.2:latest', maxSteps: 5 });

        // Defensive clone check
        const snapshot = agent.getSettings() as { model: string; maxSteps: number };
        snapshot.model = 'tampered';
        snapshot.maxSteps = 999;
        expect(agent.getSettings()).toEqual({ model: 'llama3.2:latest', maxSteps: 5 });

        expect(agent.setModel('qwen2.5:3b')).toBe(agent);
        expect(agent.setMaxSteps(10)).toBe(agent);
        expect(agent.getSettings()).toEqual({ model: 'qwen2.5:3b', maxSteps: 10 });
    });

    test('rejects invalid model names and non-positive/non-integer maxSteps', () => {
        expect(() => new Agent(dummyProvider, { model: '' })).toThrow('Invalid model name.');
        expect(() => new Agent(dummyProvider, { model: '   ' })).toThrow('Invalid model name.');

        for (const badSteps of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => new Agent(dummyProvider, { model: 'm', maxSteps: badSteps }))
                .toThrow('maxSteps must be a positive integer.');
        }

        const agent = new Agent(dummyProvider, { model: 'm', maxSteps: 2 });
        expect(() => agent.setModel('')).toThrow('Invalid model name.');
        expect(() => agent.setModel('  ')).toThrow('Invalid model name.');
        expect(() => agent.setMaxSteps(0)).toThrow('maxSteps must be a positive integer.');
        expect(() => agent.setMaxSteps(2.2)).toThrow('maxSteps must be a positive integer.');

        // Original settings remain untouched after failed mutations
        expect(agent.getSettings()).toEqual({ model: 'm', maxSteps: 2 });
    });
});

describe('Agent Tool Registry & Hooks', () => {
    const echoTool = tool({
        description: 'Echoes input text',
        inputSchema: z.object({ text: z.string() }),
        execute: async ({ text }) => ({ echoed: text }),
    });

    const addTool = tool({
        description: 'Adds two numbers',
        inputSchema: z.object({ a: z.number(), b: z.number() }),
        execute: async ({ a, b }) => ({ sum: a + b }),
    });

    test('registers toolsets, named tools, and tool groups, and manages removal', () => {
        const agent = new Agent(dummyProvider, { model: 'm' });

        agent.registerTools(
            { name: 'echo', tool: echoTool },
            {
                name: 'math',
                tools: asAgentTools({ add: addTool }),
            },
            {
                inline: tool({
                    description: 'Inline tool',
                    inputSchema: z.object({}),
                    execute: async () => 'ok',
                }),
            },
        );

        expect(agent.hasTool('echo')).toBe(true);
        expect(agent.hasTool('add')).toBe(true);
        expect(agent.hasTool('inline')).toBe(true);

        const toolsCopy = agent.getTools();
        expect(toolsCopy.size).toBe(3);

        expect(agent.unregisterTools('echo', 'nonexistent')).toBe(agent);
        expect(agent.hasTool('echo')).toBe(false);
        expect(agent.hasTool('add')).toBe(true);

        expect(agent.clearTools()).toBe(agent);
        expect(agent.getTools().size).toBe(0);
    });

    test('atomically rolls back entire batch when registration fails validation or duplicates', () => {
        const agent = new Agent(dummyProvider, { model: 'm' });
        agent.registerTools({ existing: echoTool });

        // Duplicate against already-registered tool rolls back 'fresh'
        expect(() =>
            agent.registerTools(
                { name: 'fresh', tool: addTool },
                { name: 'existing', tool: echoTool },
            ),
        ).toThrow('Tool "existing" is already registered.');
        expect(agent.hasTool('fresh')).toBe(false);

        // Duplicate within the same registration call rolls back 'dup'
        expect(() =>
            agent.registerTools(
                { name: 'dup', tool: echoTool },
                { dup: addTool },
            ),
        ).toThrow('Tool "dup" is already registered.');
        expect(agent.hasTool('dup')).toBe(false);

        // Empty name rolls back 'validFirst'
        expect(() =>
            agent.registerTools(
                { name: 'validFirst', tool: echoTool },
                { name: '   ', tool: addTool },
            ),
        ).toThrow('Tool name cannot be empty.');
        expect(agent.hasTool('validFirst')).toBe(false);

        // Invalid tool definition rolls back 'validBeforeBad'
        expect(() =>
            agent.registerTools(
                { name: 'validBeforeBad', tool: echoTool },
                { name: 'badTool', tool: null as unknown as typeof echoTool },
            ),
        ).toThrow(TypeError);
        expect(agent.hasTool('validBeforeBad')).toBe(false);
        expect(agent.getTools().size).toBe(1);
    });

    test('prepareTools strips hook metadata and enforces available() and validate() against live context', async () => {
        const agent = new TestableAgent(dummyProvider, { model: 'm' });
        let executeCalls = 0;

        const guarded = withAgentHooks(
            tool({
                description: 'Performs a guarded action',
                inputSchema: z.object({ amount: z.number() }),
                execute: async ({ amount }) => {
                    executeCalls++;
                    return { accepted: amount };
                },
            }),
            {
                available: async (ctx) => ctx.get('unlocked') === true,
                validate: (input, ctx) => {
                    const max = (ctx.get('maxAmount') as number | undefined) ?? 100;
                    return input.amount > 0 && input.amount <= max;
                },
            },
        );

        agent.registerTools({ guarded });
        const prepared = agent.exposePrepareTools();
        const sdkTool = prepared.definitions.guarded as Record<string, unknown>;

        // Hook properties must never leak to SDK definition
        expect('available' in sdkTool).toBe(false);
        expect('validate' in sdkTool).toBe(false);
        expect(typeof sdkTool.execute).toBe('function');

        // Initially unavailable
        expect(await prepared.active()).toEqual([]);
        await expect((sdkTool.execute as any)({ amount: 10 }, {})).rejects.toThrow(
            'Tool "guarded" is unavailable.',
        );
        expect(executeCalls).toBe(0);

        // Unlock via live agent.context
        agent.context.set('unlocked', true);
        agent.context.set('maxAmount', 50);
        expect(await prepared.active()).toEqual(['guarded']);

        // Validate failure blocks execution
        await expect((sdkTool.execute as any)({ amount: 75 }, {})).rejects.toThrow(
            'Tool "guarded" failed validation.',
        );
        expect(executeCalls).toBe(0);

        // Valid input passes both hooks and invokes execute
        const result = await (sdkTool.execute as any)({ amount: 25 }, {});
        expect(result).toEqual({ accepted: 25 });
        expect(executeCalls).toBe(1);
    });
});
