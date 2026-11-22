
import {
    createOpenAICompatible,
    type OpenAICompatibleProvider,
} from '@ai-sdk/openai-compatible';

export interface AgentProviderOptions {
    apiKey: string;
    baseUrl: string;
    includeUsage?: boolean;
}

export class AgentProvider {
    protected provider: OpenAICompatibleProvider;

    constructor(
        public readonly name: string,
        provider_options: AgentProviderOptions
    ) {
        if (!name?.trim()) {
            throw new Error('Invalid provider name.');
        }

        if (!provider_options.baseUrl?.trim()) {
            throw new Error(`Invalid base URL for provider "${name}".`);
        }

        this.provider = createOpenAICompatible({
            name,
            apiKey: provider_options.apiKey,
            baseURL: provider_options.baseUrl,
            includeUsage: provider_options.includeUsage ?? false,

            transformRequestBody: (args, warnings) =>
                this.transformRequest(args, warnings),
        });
    }

    // Override in subclasses to customize outgoing requests.
    protected transformRequest(
        args: Record<string, any>,
        warnings?: any[]
    ): Record<string, any> {
        return args;
    }

    public use(): OpenAICompatibleProvider {
        return this.provider;
    }
}

export default class AgentProviderManager {
    private readonly providers = new Map<string, AgentProvider>();
    private defaultProvider?: string;

    constructor(providers: AgentProvider[] = []) {
        for (const provider of providers) {
            this.register(provider);
        }
    }

    public register<T extends AgentProvider>(provider: T): T {
        if (this.providers.has(provider.name)) {
            throw new Error(
                `Provider "${provider.name}" is already registered.`
            );
        }

        this.providers.set(provider.name, provider);

        // First registered provider becomes the default.
        this.defaultProvider ??= provider.name;

        return provider;
    }

    public get(name?: string): AgentProvider {
        const key = name ?? this.defaultProvider;

        if (!key) {
            throw new Error('No providers registered.');
        }

        const provider = this.providers.get(key);

        if (!provider) {
            throw new Error(`Provider "${key}" not found.`);
        }

        return provider;
    }

    // Retrieve the underlying AI SDK provider.
    public use(name?: string): OpenAICompatibleProvider {
        return this.get(name).use();
    }

    public has(name: string): boolean {
        return this.providers.has(name);
    }

    public remove(name: string): boolean {
        const removed = this.providers.delete(name);

        if (removed && this.defaultProvider === name) {
            this.defaultProvider = this.providers.keys().next().value;
        }

        return removed;
    }

    public replace<T extends AgentProvider>(provider: T): T {
        if (!this.providers.has(provider.name)) {
            throw new Error(
                `Provider "${provider.name}" not found.`
            );
        }

        this.providers.set(provider.name, provider);
        return provider;
    }

    public setDefault(name: string): this {
        if (!this.providers.has(name)) {
            throw new Error(`Provider "${name}" not found.`);
        }

        this.defaultProvider = name;
        return this;
    }

    public getDefault(): string | undefined {
        return this.defaultProvider;
    }

    public list(): string[] {
        return [...this.providers.keys()];
    }

    public clear(): void {
        this.providers.clear();
        this.defaultProvider = undefined;
    }

    public get size(): number {
        return this.providers.size;
    }
}
