import { describe, expect, test } from 'bun:test';
import type { OpenAICompatibleChatLanguageModel } from '@ai-sdk/openai-compatible';
import AgentProviderManager, { AgentProvider } from '../src/AgentProvider';

class CustomTransformProvider extends AgentProvider {
    protected override transformRequest(
        args: Record<string, any>,
        _warnings?: any[],
    ): Record<string, any> {
        return {
            ...args,
            custom_header_flag: true,
        };
    }
}

describe('AgentProvider & AgentProviderManager', () => {
    describe('AgentProvider', () => {
        test('creates an OpenAI-compatible provider and exposes name and use()', () => {
            const provider = new AgentProvider('ollama', {
                apiKey: 'local',
                baseUrl: 'http://localhost:11434/v1',
                includeUsage: true,
            });

            expect(provider.name).toBe('ollama');
            expect(typeof provider.use()).toBe('function');
            expect(provider.use()('llama3.2:latest').modelId).toBe('llama3.2:latest');
        });

        test('allows subclasses to override transformRequest for outgoing bodies', async () => {
            const provider = new CustomTransformProvider('custom', {
                apiKey: 'key',
                baseUrl: 'http://localhost:11434/v1',
            });

            const chatModel = provider.use().chatModel('test-model') as OpenAICompatibleChatLanguageModel;
            const prepared = await chatModel.prepareRequest({
                prompt: [
                    {
                        role: 'user',
                        content: [{ type: 'text', text: 'hello' }],
                    },
                ],
            });

            expect(prepared.body.custom_header_flag).toBe(true);
            expect(prepared.body.model).toBe('test-model');
        });

        test('throws on empty/whitespace provider name or baseUrl', () => {
            expect(() => new AgentProvider('', { apiKey: 'k', baseUrl: 'http://localhost' }))
                .toThrow('Invalid provider name.');
            expect(() => new AgentProvider('   ', { apiKey: 'k', baseUrl: 'http://localhost' }))
                .toThrow('Invalid provider name.');

            expect(() => new AgentProvider('p1', { apiKey: 'k', baseUrl: '' }))
                .toThrow('Invalid base URL for provider "p1".');
            expect(() => new AgentProvider('p1', { apiKey: 'k', baseUrl: '   ' }))
                .toThrow('Invalid base URL for provider "p1".');
        });
    });

    describe('AgentProviderManager', () => {
        const makeProvider = (name: string) =>
            new AgentProvider(name, { apiKey: 'k', baseUrl: 'http://localhost:11434/v1' });

        test('registers providers, assigns first as default, and manages lifecycle', () => {
            const p1 = makeProvider('first');
            const p2 = makeProvider('second');
            const p3 = makeProvider('third');

            const manager = new AgentProviderManager([p1]);
            expect(manager.size).toBe(1);
            expect(manager.getDefault()).toBe('first');
            expect(manager.get()).toBe(p1);
            expect(manager.has('first')).toBe(true);

            expect(manager.register(p2)).toBe(p2);
            expect(manager.register(p3)).toBe(p3);
            expect(manager.list()).toEqual(['first', 'second', 'third']);
            expect(manager.get('second')).toBe(p2);
            expect(typeof manager.use()).toBe('function');

            // Change default explicitly
            expect(manager.setDefault('second')).toBe(manager);
            expect(manager.getDefault()).toBe('second');
            expect(manager.get()).toBe(p2);

            // Replace preserves registration and updates instance
            const p2Replacement = makeProvider('second');
            expect(manager.replace(p2Replacement)).toBe(p2Replacement);
            expect(manager.get('second')).toBe(p2Replacement);

            // Removing current default promotes next available key
            expect(manager.remove('second')).toBe(true);
            expect(manager.has('second')).toBe(false);
            expect(manager.getDefault()).toBe('first');

            // Clear resets everything
            manager.clear();
            expect(manager.size).toBe(0);
            expect(manager.getDefault()).toBeUndefined();
            expect(manager.list()).toEqual([]);
        });

        test('removing the last provider clears defaultProvider', () => {
            const manager = new AgentProviderManager([makeProvider('only')]);
            expect(manager.remove('only')).toBe(true);
            expect(manager.getDefault()).toBeUndefined();
            expect(() => manager.get()).toThrow('No providers registered.');
        });

        test('throws on duplicate registration, missing providers, and empty manager lookups', () => {
            const manager = new AgentProviderManager();

            expect(() => manager.get()).toThrow('No providers registered.');
            expect(() => manager.use()).toThrow('No providers registered.');
            expect(manager.remove('missing')).toBe(false);

            const p1 = makeProvider('alpha');
            manager.register(p1);

            expect(() => manager.register(makeProvider('alpha')))
                .toThrow('Provider "alpha" is already registered.');
            expect(() => manager.get('beta')).toThrow('Provider "beta" not found.');
            expect(() => manager.use('beta')).toThrow('Provider "beta" not found.');
            expect(() => manager.setDefault('beta')).toThrow('Provider "beta" not found.');
            expect(() => manager.replace(makeProvider('beta'))).toThrow('Provider "beta" not found.');
        });
    });
});
