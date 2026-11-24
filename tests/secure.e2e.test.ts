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

const OLLAMA_BASEURL = process.env.OLLAMA_BASEURL ?? 'http://localhost:11434/v1';
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

function makeAgent(maxSteps = 6): Agent {
    return new Agent(providers.get('ollama'), {
        model: OLLAMA_MODEL,
        maxSteps,
    });
}

describe('Secure primitive E2E (Ollama)', () => {
    beforeAll(async () => {
        await withColdStartRetry(async () => {
            const warmup = makeAgent(1);
            const res = await warmup.run('Reply with OK.');
            expect(res.output.length).toBeGreaterThan(0);
        }, 3);
    }, 60_000);

    test('model recovers from an unresolved secure input and retries tools in order', async () => {
        const agent = makeAgent(6);
        const rawPassword = 'P'.repeat(6);
        let receivedPassword: string | undefined;
        let accountExecutions = 0;

        agent.registerTools({
            generate_password: withAgentHooks(
                tool({
                    description: 'Generate a random password of the given length. Always call this when asked to create a password.',
                    inputSchema: z.object({ length: z.coerce.number() }),
                    execute: async ({ length }) => ({
                        success: true,
                        password: 'P'.repeat(length),
                    }),
                }),
                { secure: ['password'] },
            ),
            create_account: withAgentHooks(
                tool({
                    description: 'Create an account with a username and password.',
                    inputSchema: z.object({ username: z.string(), password: z.string() }),
                    execute: async ({ username, password }) => {
                        accountExecutions++;
                        receivedPassword = password;
                        return {
                            created: true,
                            username,
                            passwordLength: password.length,
                        };
                    },
                }),
                { secureInputs: ['password'] },
            ),
        });

        const events: AgentStreamEvent<string>[] = [];
        for await (const event of agent.stream(
            `This is a recovery test. First call create_account exactly once with username "demo" and password "secure://missing-ref-for-retry-test". Do not call generate_password until create_account returns an error. After the error, you must follow the instruction: call generate_password with length=6, then call create_account a second time using the exact secure:// reference returned by generate_password. The task is not complete until create_account returns created=true. Do not stop after generating the password, and never reveal the password.`,
        )) {
            events.push(event);
        }

        const firstAccountErrorIndex = events.findIndex(
            (e) => e.kind === 'response:tool-error' && e.name === 'create_account',
        );
        expect(firstAccountErrorIndex).toBeGreaterThanOrEqual(0);
        const firstAccountError = events[firstAccountErrorIndex];
        if (firstAccountError?.kind === 'response:tool-error') {
            expect(String(firstAccountError.error)).toContain('not ready');
            expect(String(firstAccountError.error)).toContain('generate_password');
        }

        const generateCallIndex = events.findIndex(
            (e) => e.kind === 'response:tool-call' && e.name === 'generate_password',
        );
        const generateResultIndex = events.findIndex(
            (e) => e.kind === 'response:tool-result' && e.name === 'generate_password',
        );
        expect(generateCallIndex).toBeGreaterThan(firstAccountErrorIndex);
        expect(generateResultIndex).toBeGreaterThan(generateCallIndex);

        const genResult = events.find(
            (e) => e.kind === 'response:tool-result' && e.name === 'generate_password',
        );
        expect(genResult).toBeDefined();
        let generatedRef: string | undefined;
        if (genResult && genResult.kind === 'response:tool-result') {
            const out = genResult.output as { password: string };
            expect(out.password.startsWith('secure://')).toBe(true);
            expect(JSON.stringify(genResult.output)).not.toContain(rawPassword);
            generatedRef = out.password;
        }

        const accountCalls = events.filter(
            (e) => e.kind === 'response:tool-call' && e.name === 'create_account',
        );
        expect(accountCalls.length).toBeGreaterThanOrEqual(2);
        const retryCall = accountCalls.at(-1);
        if (retryCall?.kind === 'response:tool-call') {
            expect(retryCall.input).toEqual({
                username: 'demo',
                password: generatedRef,
            });
        }

        const accountResult = events.find(
            (e) => e.kind === 'response:tool-result' && e.name === 'create_account',
        );
        expect(accountResult).toBeDefined();
        if (accountResult?.kind === 'response:tool-result') {
            expect(accountResult.output).toEqual({
                created: true,
                username: 'demo',
                passwordLength: rawPassword.length,
            });
        }
        expect(accountExecutions).toBe(1);
        expect(receivedPassword).toBe(rawPassword);
        expect(JSON.stringify(events)).not.toContain(rawPassword);

        const finish = events.at(-1);
        expect(finish && finish.kind).toBe('response:finish');
        if (finish && finish.kind === 'response:finish') {
            expect(finish.result.output).not.toContain(rawPassword);
        }
    }, 45_000);

    test('structured output extracts secure field into agent.secure', async () => {
        const agent = makeAgent(4);
        const Creds = z.object({ username: z.string(), password: z.string() });

        const res = await withColdStartRetry(() =>
            agent.run(
                'Return JSON with username "demo" and password "abc123".',
                { schema: Creds, secure: ['password'] },
            ),
        );

        expect(res.output.username.toLowerCase()).toContain('demo');
        expect(typeof res.output.password).toBe('string');
        expect((res.output.password as string).startsWith('secure://')).toBe(true);
        expect(res.message).not.toContain('abc123');

        const raw = agent.secure.take(res.output.password as string);
        expect(raw).toBe('abc123');
    }, 30_000);

    test('streamed structured output does not expose the secure field in its message', async () => {
        const agent = makeAgent(4);
        const Creds = z.object({ username: z.string(), password: z.string() });
        const events = [];

        for await (const event of agent.stream(
            'Return JSON with username "demo" and password "stream-secret-123".',
            { schema: Creds, secure: ['password'] },
        )) {
            events.push(event);
        }

        expect(JSON.stringify(events)).not.toContain('stream-secret-123');
        const finish = events.at(-1);
        expect(finish?.kind).toBe('response:finish');
        if (finish?.kind === 'response:finish') {
            expect(finish.result.message).not.toContain('stream-secret-123');
            expect(finish.result.output.password).toMatch(/^secure:\/\//);
            expect(agent.secure.take(finish.result.output.password)).toBe('stream-secret-123');
        }
    }, 30_000);
});
