import { describe, expect, test } from 'bun:test';
import Context, { ContextRegistry } from '../src/shared/Context';

interface SampleShape {
    host: string;
    port: number;
    enabled: boolean;
    optionalNote?: string;
}

describe('ContextRegistry & Context', () => {
    describe('happy paths', () => {
        test('registers, reads, overwrites, and deletes values on an isolated registry', () => {
            const registry = new ContextRegistry();

            expect(registry.has('apiUrl')).toBe(false);
            expect(registry.set('apiUrl', 'http://localhost:3000')).toBe(true);
            expect(registry.has('apiUrl')).toBe(true);
            expect(registry.get<string>('apiUrl')).toBe('http://localhost:3000');
            expect(registry.tryGet<string>('apiUrl')).toBe('http://localhost:3000');

            // Overwrite existing key
            expect(registry.set('apiUrl', 'http://localhost:4000')).toBe(true);
            expect(registry.get<string>('apiUrl')).toBe('http://localhost:4000');

            // Delete existing key
            expect(registry.delete('apiUrl')).toBe(true);
            expect(registry.has('apiUrl')).toBe(false);
            expect(registry.tryGet<string>('apiUrl')).toBeUndefined();
        });

        test('default Context export is a shared ContextRegistry singleton distinct from new instances', () => {
            const key = '__test_singleton_key__';
            const isolated = new ContextRegistry();

            Context.set(key, 'shared-value');
            try {
                expect(Context).toBeInstanceOf(ContextRegistry);
                expect(Context.get<string>(key)).toBe('shared-value');
                expect(isolated.has(key)).toBe(false);
            } finally {
                Context.delete(key);
            }
        });

        test('view<T>() reflects live state without copying', () => {
            const registry = new ContextRegistry();
            const view = registry.view<SampleShape>();

            expect(view.has('host')).toBe(false);
            expect(view.set('host', '127.0.0.1')).toBe(true);
            expect(view.set('port', 8080)).toBe(true);
            expect(view.set('enabled', true)).toBe(true);

            // Changes through view are visible on underlying registry and vice versa
            expect(registry.get<string>('host')).toBe('127.0.0.1');
            registry.set('port', 9090);
            expect(view.get('port')).toBe(9090);

            expect(view.tryGet('optionalNote')).toBeUndefined();
            expect(view.delete('enabled')).toBe(true);
            expect(registry.has('enabled')).toBe(false);
        });
    });

    describe('edge cases & negative paths', () => {
        test('get() and view.get() throw on missing or deleted keys', () => {
            const registry = new ContextRegistry();
            const view = registry.view<SampleShape>();

            expect(() => registry.get('missing')).toThrow('Context value "missing" is not registered');
            expect(() => view.get('host')).toThrow('Context value "host" is not registered');

            view.set('host', 'localhost');
            view.delete('host');
            expect(() => view.get('host')).toThrow('Context value "host" is not registered');
        });

        test('tryGet() returns undefined without throwing for missing keys', () => {
            const registry = new ContextRegistry();
            expect(registry.tryGet('does-not-exist')).toBeUndefined();
        });

        test('delete() returns false when key does not exist', () => {
            const registry = new ContextRegistry();
            expect(registry.delete('nonexistent')).toBe(false);
        });

        test('preserves falsy and nullish values (undefined, null, false, 0, "", NaN) as registered', () => {
            const registry = new ContextRegistry();

            registry.set('undef', undefined);
            registry.set('nil', null);
            registry.set('bool', false);
            registry.set('zero', 0);
            registry.set('empty', '');
            registry.set('notNum', Number.NaN);

            expect(registry.has('undef')).toBe(true);
            expect(registry.get('undef')).toBeUndefined();

            expect(registry.has('nil')).toBe(true);
            expect(registry.get('nil')).toBeNull();

            expect(registry.has('bool')).toBe(true);
            expect(registry.get('bool')).toBe(false);

            expect(registry.has('zero')).toBe(true);
            expect(registry.get('zero')).toBe(0);

            expect(registry.has('empty')).toBe(true);
            expect(registry.get('empty')).toBe('');

            expect(registry.has('notNum')).toBe(true);
            expect(Number.isNaN(registry.get<number>('notNum'))).toBe(true);
        });
    });
});
