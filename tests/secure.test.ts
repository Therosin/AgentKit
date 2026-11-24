import { describe, expect, test } from 'bun:test';
import { tool } from 'ai';
import { z } from 'zod';
import DefaultAgent, { Agent, AgentProvider } from '../index';
import { SecureStore, extractSecure, resolveSecureInputs, suppressSecure, cloneValue, hasPath, getPath, setPath, deletePath } from '../src/shared/Secure';

const dummyProvider = new AgentProvider('test', {
    apiKey: 'test-key',
    baseUrl: 'http://localhost:11434/v1',
});

describe('SecureStore', () => {
    test('create returns ref and stores value', () => {
        const store = new SecureStore();
        const ref = store.create('secret');
        expect(ref.startsWith('secure://')).toBe(true);
        expect(store.get(ref)).toBe('secret');
        expect(store.has(ref)).toBe(true);
        expect(store.size).toBe(1);
    });

    test('take consumes and deletes', () => {
        const store = new SecureStore();
        const ref = store.create('secret');
        expect(store.take(ref)).toBe('secret');
        expect(store.get(ref)).toBeUndefined();
        expect(store.has(ref)).toBe(false);
        expect(store.take(ref)).toBeUndefined();
    });

    test('resolve with once removes entry', () => {
        const store = new SecureStore();
        const ref = store.create('secret', { once: true });
        expect(store.resolve(ref)).toBe('secret');
        expect(store.has(ref)).toBe(false);
    });

    test('resolve without once keeps entry', () => {
        const store = new SecureStore();
        const ref = store.create('secret', { once: false });
        expect(store.resolve(ref)).toBe('secret');
        expect(store.has(ref)).toBe(true);
    });

    test('ttl expiry prunes', async () => {
        const store = new SecureStore();
        const ref = store.create('secret', { ttlMs: 1 });
        await new Promise(r => setTimeout(r, 5));
        expect(store.get(ref)).toBeUndefined();
        expect(store.has(ref)).toBe(false);
        expect(store.size).toBe(0);
    });

    test('zero ttl expires immediately', () => {
        const store = new SecureStore();
        const ref = store.create('secret', { ttlMs: 0 });
        expect(store.get(ref)).toBeUndefined();
        expect(store.has(ref)).toBe(false);
    });

    test('clear empties store', () => {
        const store = new SecureStore();
        store.create('a');
        store.create('b');
        store.clear();
        expect(store.size).toBe(0);
    });
});

describe('Path helpers', () => {
    test('hasPath/getPath/setPath/deletePath', () => {
        const obj: any = { a: { b: 5 } };
        expect(hasPath(obj, 'a.b')).toBe(true);
        expect(getPath(obj, 'a.b')).toBe(5);
        setPath(obj, 'a.c', 7);
        expect(obj.a.c).toBe(7);
        setPath(obj, 'x.y.z', 9);
        expect(obj.x.y.z).toBe(9);
        deletePath(obj, 'a.b');
        expect(hasPath(obj, 'a.b')).toBe(false);
    });

    test('missing path skip', () => {
        const obj: any = { a: 1 };
        expect(hasPath(obj, 'a.b')).toBe(false);
        expect(getPath(obj, 'a.b')).toBeUndefined();
    });
});

describe('extractSecure', () => {
    test('extracts top-level and nested paths', () => {
        const store = new SecureStore();
        const obj: any = { password: 'pw', credentials: { apiKey: 'key' }, ok: true };
        extractSecure(obj, ['password', 'credentials.apiKey'], store, false);
        expect(typeof obj.password).toBe('string');
        expect(obj.password.startsWith('secure://')).toBe(true);
        expect(obj.credentials.apiKey.startsWith('secure://')).toBe(true);
        expect(obj.ok).toBe(true);
        expect(store.get(obj.password)).toBe('pw');
        expect(store.get(obj.credentials.apiKey)).toBe('key');
    });

    test('skips missing paths', () => {
        const store = new SecureStore();
        const obj: any = { a: 1 };
        extractSecure(obj, ['missing', 'a.b'], store);
        expect(obj).toEqual({ a: 1 });
        expect(store.size).toBe(0);
    });

    test('non-object target no-op', () => {
        const store = new SecureStore();
        extractSecure('str', ['x'], store);
        extractSecure(null, ['x'], store);
        expect(store.size).toBe(0);
    });
});

describe('resolveSecureInputs', () => {
    test('resolves refs and consumes once', () => {
        const store = new SecureStore();
        const ref = store.create('pw', { once: true });
        const obj: any = { password: ref };
        resolveSecureInputs(obj, ['password'], store);
        expect(obj.password).toBe('pw');
        // once-consumed
        expect(store.has(ref)).toBe(false);
    });

    test('leaves non-ref values', () => {
        const store = new SecureStore();
        const obj: any = { password: 'plain' };
        resolveSecureInputs(obj, ['password'], store);
        expect(obj.password).toBe('plain');
    });

    test('rejects refs that are missing or expired', () => {
        const store = new SecureStore();
        const obj: any = { password: 'secure://missing' };
        expect(() => resolveSecureInputs(obj, ['password'], store))
            .toThrow('Secure reference is unavailable or expired.');
        expect(obj.password).toBe('secure://missing');
    });
});

describe('suppressSecure', () => {
    test('deletes paths', () => {
        const obj: any = { password: 'x', keep: 1 };
        suppressSecure(obj, ['password']);
        expect(obj).toEqual({ keep: 1 });
    });
});

describe('cloneValue', () => {
    test('clones objects', () => {
        const o = { a: 1 };
        const c = cloneValue(o);
        expect(c).toEqual(o);
        expect(c).not.toBe(o);
    });
});

describe('Tool integration via prepareTools', () => {
    test('extracts secure output and resolves secure inputs', async () => {
        const agent = new (class extends Agent {
            public exposePrepareTools() { return this.prepareTools(); }
        })(dummyProvider, { model: 'm' });

        const genTool = (tool as any)({
            description: 'gen',
            inputSchema: z.object({ length: z.number() }),
            secure: ['password'],
            execute: async ({ length }: any) => ({ success: true, password: 'P'.repeat(length) }),
        });

        const consumeTool = (tool as any)({
            description: 'consume',
            inputSchema: z.object({ password: z.string() }),
            secureInputs: ['password'],
            execute: async ({ password }: any) => ({ received: password }),
        });

        agent.registerTools({ gen: genTool, consume: consumeTool });
        const prepared = agent.exposePrepareTools();

        const genResult = await (prepared.definitions.gen as any).execute({ length: 4 }, {});
        expect(genResult.password).toMatch(/^secure:\/\//);
        const ref = genResult.password;

        const consumeResult = await (prepared.definitions.consume as any).execute({ password: ref }, {});
        expect(consumeResult.received).toBe('PPPP');
    });

    test('outputSchema preserved on tool def', () => {
        const agent = new (class extends Agent {
            public exposePrepareTools() { return this.prepareTools(); }
        })(dummyProvider, { model: 'm' });
        const t = (tool as any)({
            description: 't',
            inputSchema: z.object({}),
            outputSchema: z.object({ x: z.number() }),
            execute: async () => ({ x: 5 }),
        });
        agent.registerTools({ t });
        const prepared = agent.exposePrepareTools();
        expect((prepared.definitions.t as any).outputSchema).toBeDefined();
    });
});

describe('Agent.secure default', () => {
    test('agent has secure store', () => {
        const agent = new Agent(dummyProvider, { model: 'm' });
        expect(agent.secure).toBeInstanceOf(SecureStore);
    });
});
