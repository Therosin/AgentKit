import type { Tool, ToolSet } from 'ai';
import type { SecureStore } from './shared/Secure';

/** Shared, mutable agent state. Predicates receive a read-only view. */
export type AgentContext = ReadonlyMap<string, unknown>;

/** Extra lifecycle hooks for an otherwise ordinary AI SDK tool. */
export interface AgentToolHooks<TInput = unknown> {
    /** Called before EVERY model step. False removes the tool from that step. */
    available?: (context: AgentContext, secure: SecureStore) => boolean | Promise<boolean>;

    /** Called after SDK input-schema validation, immediately before execute. */
    validate?: (
        input: TInput,
        context: AgentContext,
        secure: SecureStore,
    ) => boolean | Promise<boolean>;

    /** Dot-paths into the tool's returned value to extract as secure. */
    secure?: string[];

    /** Dot-paths into the tool's input to resolve secure refs before execute. */
    secureInputs?: string[];
}

export type AgentTool<TInput = any, TOutput = any> =
    Tool<TInput, TOutput> & AgentToolHooks<TInput>;

export type AgentToolSet = Record<string, AgentTool>;

export interface AgentNamedTool {
    name: string;
    tool: AgentTool;
}

export interface AgentToolGroup {
    name: string;
    tools: AgentToolSet;
}

/** Register an individual tool, a named group, or an AI SDK toolset. */
export type AgentToolRegistration =
    | AgentNamedTool
    | AgentToolGroup
    | AgentToolSet;

/**
 * Add hooks to an existing AI SDK tool without losing its inferred input/output types.
 * The returned object remains a normal AI SDK-compatible Tool.
 *
 * Usage:
 *   const guarded = withAgentHooks(tool({ inputSchema: ..., execute: ... }), {
 *       available: ctx => ctx.get('ready') === true,
 *       validate: input => input.count > 0,
 *   });
 */
export function withAgentHooks<TInput, TOutput>(
    definition: Tool<TInput, TOutput>,
    hooks: AgentToolHooks<TInput>,
): AgentTool<TInput, TOutput> {
    return { ...definition, ...hooks };
}

/** Plain SDK ToolSets are also accepted by registerTools(). */
export function asAgentTools(tools: ToolSet): AgentToolSet {
    return tools as AgentToolSet;
}
