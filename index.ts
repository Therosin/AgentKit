export {
    SecureStore,
    type SecureCreateOptions,
    type SecureEntry,
    isSecureRef,
    hasPath,
    getPath,
    setPath,
    deletePath,
    normalizeSecureSpec,
    extractSecure,
    resolveSecureInputs,
    suppressSecure,
    cloneValue,
} from './src/shared/Secure';

export {
    default,
    default as Agent,
    type AgentOptions,
    type AgentSettings,
    type AgentRunOptions,
    type AgentRunResult,
    type AgentStreamEvent,
} from './src/Agent';

export {
    default as AgentProviderManager,
    AgentProvider,
    type AgentProviderOptions,
} from './src/AgentProvider';

export {
    withAgentHooks,
    asAgentTools,
    type AgentContext,
    type AgentToolHooks,
    type AgentTool,
    type AgentToolSet,
    type AgentNamedTool,
    type AgentToolGroup,
    type AgentToolRegistration,
} from './src/AgentTools';
