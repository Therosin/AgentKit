import Agent from "./src/Agent";
import AgentProviderManager, { AgentProvider, type AgentProviderOptions } from "./src/AgentProvider";
import Context from "./src/shared/Context";

type ProviderConf = Record<string, AgentProviderOptions>

Context.set<ProviderConf>("provider-conf", {
    "local-ollama": {
        baseUrl: "http://192.168.0.100:11434/v1",
        apiKey: "local"
    }
})

const providers = new AgentProviderManager([
    new AgentProvider("local-ollama", Context.get<ProviderConf>("provider-conf")["local-ollama"] as AgentProviderOptions)
])


const agent = new Agent(providers.get("local-ollama"), {
    model: "llama3.2:latest",
    maxSteps: 5,
})

const response = await agent.run(
    "What is the capital of {location}?",
    {
        context: {
            "location": "france"
        }
    }
)

console.log("RESPONSE:\n", response)