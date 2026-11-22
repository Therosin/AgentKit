import Context, { ContextRegistry } from './shared/Context';
import { TextTemplate } from './shared/TextTemplates';
import { AgentProvider } from './AgentProvider';
import {
    generateText,
    streamText,
    stepCountIs,
    Output,
    type DeepPartial,
    type ToolSet,
    type LanguageModelUsage,
} from 'ai';
import type { z } from 'zod';
import type {
    AgentContext,
    AgentTool,
    AgentToolRegistration,
} from './AgentTools';

export interface AgentOptions {
    model: string;
    maxSteps?: number;
}

export interface AgentSettings {
    model: string;
    maxSteps: number;
}

export interface AgentRunOptions<TSchema extends z.ZodType | undefined = undefined> {
    schema?: TSchema;
    context?: Record<string, unknown>; // TextTemplate variables, not agent.context
    abortSignal?: AbortSignal;
}

type InferOutput<TSchema> = TSchema extends z.ZodType ? z.infer<TSchema> : string;

export interface AgentRunResult<T = string> {
    message: string;
    output: T;
    usage: LanguageModelUsage;
    finishReason: string;
}

export type AgentStreamEvent<T = string> =
    | { kind: 'response:start'; model: string }
    | { kind: 'response:step-start'; step: number }
    | { kind: 'response:chunk'; text: string }
    | { kind: 'response:partial'; data: DeepPartial<T> }
    | { kind: 'response:reasoning'; text: string }
    | { kind: 'response:tool-input-start'; id: string; name: string }
    | { kind: 'response:tool-input-delta'; id: string; text: string }
    | { kind: 'response:tool-call'; id: string; name: string; input: unknown }
    | { kind: 'response:tool-result'; id: string; name: string; output: unknown }
    | { kind: 'response:tool-error'; id: string; name: string; error: unknown }
    | { kind: 'response:step-finish'; step: number }
    | { kind: 'response:finish'; result: AgentRunResult<T> }
    | { kind: 'response:error'; error: unknown };

type StreamQueueItem<T> =
    | { kind: 'event'; value: AgentStreamEvent<T> }
    | { kind: 'done' }
    | { kind: 'error'; error: unknown };

/** Merge concurrently consumed SDK streams without polling. */
class AsyncEventQueue<T> {
    private readonly items: T[] = [];
    private wake?: () => void;

    push(item: T): void {
        this.items.push(item);
        this.wake?.();
        this.wake = undefined;
    }

    async shift(): Promise<T> {
        while (this.items.length === 0) {
            await new Promise<void>(resolve => { this.wake = resolve; });
        }
        return this.items.shift()!;
    }
}

export default class Agent {
    protected agent_settings: AgentSettings;
    protected readonly tools = new Map<string, AgentTool>();
    public readonly context = new Map<string, unknown>();

    constructor(
        protected provider: AgentProvider,
        options: AgentOptions,
    ) {
        if (!options.model?.trim()) throw new Error('Invalid model name.');
        this.agent_settings = {
            model: options.model,
            maxSteps: options.maxSteps ?? 5,
        };
        this.assertMaxSteps(this.agent_settings.maxSteps);
    }

    private assertMaxSteps(value: number): void {
        if (!Number.isInteger(value) || value < 1) {
            throw new Error('maxSteps must be a positive integer.');
        }
    }

    protected get model() {
        return this.provider.use()(this.agent_settings.model);
    }

    protected async renderPrompt(
        prompt: string,
        context: Record<string, unknown> = {},
    ): Promise<string> {
        return await new TextTemplate(prompt)(context);
    }

    /** Atomically register SDK tools, named tools, and named groups. */
    public registerTools(...registrations: AgentToolRegistration[]): this {
        const pending = new Map<string, AgentTool>();

        const add = (name: string, tool: AgentTool) => {
            if (!name.trim()) throw new Error('Tool name cannot be empty.');
            if (this.tools.has(name) || pending.has(name)) {
                throw new Error(`Tool "${name}" is already registered.`);
            }
            if (!tool || typeof tool !== 'object') {
                throw new TypeError(`Invalid AI SDK tool "${name}".`);
            }
            pending.set(name, tool);
        };

        for (const registration of registrations) {
            if ('name' in registration && 'tool' in registration) {
                add(registration.name as string, registration.tool);
            } else if ('name' in registration && 'tools' in registration) {
                for (const [name, tool] of Object.entries(registration.tools)) {
                    add(name, tool);
                }
            } else {
                for (const [name, tool] of Object.entries(registration)) {
                    add(name, tool as AgentTool);
                }
            }
        }

        for (const [name, tool] of pending) this.tools.set(name, tool);
        return this;
    }

    public unregisterTools(...names: string[]): this {
        for (const name of names) this.tools.delete(name);
        return this;
    }

    public getTools(): ReadonlyMap<string, AgentTool> {
        return new Map(this.tools);
    }

    public hasTool(name: string): boolean {
        return this.tools.has(name);
    }

    public clearTools(): this {
        this.tools.clear();
        return this;
    }

    /**
     * Capture definitions for one run. Availability is evaluated against the
     * live context on every step; registry changes affect the next run.
     */
    protected prepareTools(): {
        definitions: ToolSet;
        active: () => Promise<string[]>;
    } {
        const registered = [...this.tools.entries()];
        const definitions: ToolSet = {};

        for (const [name, definition] of registered) {
            const { available, validate, execute, ...sdkDefinition } = definition;

            // Keep AI SDK metadata intact. Hook fields never go to the SDK.
            // The SDK invokes execute only after its own input-schema validation.
            definitions[name] = {
                ...sdkDefinition,
                ...(execute ? {
                    execute: async (input: unknown, options: any) => {
                        if (available && !await available(this.context)) {
                            throw new Error(`Tool "${name}" is unavailable.`);
                        }
                        if (validate && !await validate(input, this.context)) {
                            throw new Error(`Tool "${name}" failed validation.`);
                        }
                        return await execute(input, options);
                    },
                } : {}),
            } as ToolSet[string];
        }

        return {
            definitions,
            active: async () => {
                const active: string[] = [];
                for (const [name, definition] of registered) {
                    if (!definition.available || await definition.available(this.context)) {
                        active.push(name);
                    }
                }
                return active;
            },
        };
    }

    public async run<TSchema extends z.ZodType | undefined = undefined>(
        prompt: string,
        options: AgentRunOptions<TSchema> = {},
    ): Promise<AgentRunResult<InferOutput<TSchema>>> {
        const message = await this.renderPrompt(prompt, options.context);
        const tools = this.prepareTools();
        const response = await generateText({
            model: this.model,
            prompt: message,
            tools: tools.definitions,
            prepareStep: async () => ({ activeTools: await tools.active() }),
            stopWhen: stepCountIs(this.agent_settings.maxSteps),
            output: options.schema
                ? Output.object({ schema: options.schema })
                : Output.text(),
            abortSignal: options.abortSignal,
        });

        return {
            message: response.text,
            output: response.output as InferOutput<TSchema>,
            usage: response.totalUsage,
            finishReason: response.finishReason,
        };
    }

    public async *stream<TSchema extends z.ZodType | undefined = undefined>(
        prompt: string,
        options: AgentRunOptions<TSchema> = {},
    ): AsyncGenerator<AgentStreamEvent<InferOutput<TSchema>>> {
        type TOutput = InferOutput<TSchema>;
        type Event = AgentStreamEvent<TOutput>;

        try {
            const message = await this.renderPrompt(prompt, options.context);
            const tools = this.prepareTools();
            const response = streamText({
                model: this.model,
                prompt: message,
                tools: tools.definitions,
                prepareStep: async () => ({ activeTools: await tools.active() }),
                stopWhen: stepCountIs(this.agent_settings.maxSteps),
                output: options.schema
                    ? Output.object({ schema: options.schema })
                    : Output.text(),
                abortSignal: options.abortSignal,
            });

            yield { kind: 'response:start', model: this.agent_settings.model };

            const queue = new AsyncEventQueue<StreamQueueItem<TOutput>>();
            const push = (value: Event) => queue.push({ kind: 'event', value });

            const consume = async (fn: () => Promise<void>): Promise<void> => {
                try {
                    await fn();
                } catch (error) {
                    queue.push({ kind: 'error', error });
                } finally {
                    queue.push({ kind: 'done' });
                }
            };

            let step = 0;
            const eventsTask = consume(async () => {
                for await (const part of response.fullStream) {
                    switch (part.type) {
                        case 'start-step':
                            push({ kind: 'response:step-start', step: ++step });
                            break;
                        case 'finish-step':
                            push({ kind: 'response:step-finish', step });
                            break;
                        case 'text-delta':
                            // Structured output goes to response:partial instead.
                            if (!options.schema) {
                                push({ kind: 'response:chunk', text: part.text });
                            }
                            break;
                        case 'reasoning-delta':
                            push({ kind: 'response:reasoning', text: part.text });
                            break;
                        case 'tool-input-start':
                            push({
                                kind: 'response:tool-input-start',
                                id: part.id,
                                name: part.toolName,
                            });
                            break;
                        case 'tool-input-delta':
                            push({
                                kind: 'response:tool-input-delta',
                                id: part.id,
                                text: part.delta,
                            });
                            break;
                        case 'tool-call':
                            push({
                                kind: 'response:tool-call',
                                id: part.toolCallId,
                                name: part.toolName,
                                input: part.input,
                            });
                            break;
                        case 'tool-result':
                            push({
                                kind: 'response:tool-result',
                                id: part.toolCallId,
                                name: part.toolName,
                                output: part.output,
                            });
                            break;
                        case 'tool-error':
                            push({
                                kind: 'response:tool-error',
                                id: part.toolCallId,
                                name: part.toolName,
                                error: part.error,
                            });
                            break;
                        case 'error':
                            throw part.error;
                        case 'abort':
                            throw part.reason ?? new Error('Generation aborted.');
                    }
                }
            });

            // These are distinct SDK output streams; consume both concurrently.
            // Each partial is a cumulative DeepPartial<TOutput> snapshot.
            const partialTask = options.schema
                ? consume(async () => {
                    for await (const partial of response.partialOutputStream) {
                        push({
                            kind: 'response:partial',
                            data: partial as DeepPartial<TOutput>,
                        });
                    }
                })
                : Promise.resolve();

            let completed = options.schema ? 0 : 1;
            let failure: { error: unknown } | undefined;
            while (completed < 2) {
                const item = await queue.shift();
                if (item.kind === 'done') completed++;
                else if (item.kind === 'error') failure ??= { error: item.error };
                else if (!failure) yield item.value;
            }

            await Promise.all([eventsTask, partialTask]);
            if (failure) throw failure.error;

            const [output, text, usage, finishReason] = await Promise.all([
                response.output,
                response.text,
                response.totalUsage,
                response.finishReason,
            ]);

            yield {
                kind: 'response:finish',
                result: {
                    message: text,
                    output: output as TOutput,
                    usage,
                    finishReason,
                },
            };
        } catch (error) {
            yield { kind: 'response:error', error };
        }
    }

    public setModel(model: string): this {
        if (!model?.trim()) throw new Error('Invalid model name.');
        this.agent_settings.model = model;
        return this;
    }

    public getModel(): string {
        return this.agent_settings.model;
    }

    public setMaxSteps(steps: number): this {
        this.assertMaxSteps(steps);
        this.agent_settings.maxSteps = steps;
        return this;
    }

    public getSettings(): Readonly<AgentSettings> {
        return { ...this.agent_settings };
    }
}
