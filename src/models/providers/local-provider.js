// ABOUTME: Local model provider for on-premise deployments
// ABOUTME: Will support DeepSeek and other local models via Ollama or direct API

import { randomUUID } from "crypto";

export class LocalProvider {
  constructor(config = {}) {
    this.config = config;
    this.sessionId = randomUUID(); // One session per provider instance
    // TODO: Implement local provider (Ollama, etc.)
  }

  async initialize() {
    throw new Error("Local provider not yet implemented");
  }

  registerModels(registry) {
    // Local models - no pricing since they're self-hosted
    registry.registerModelDefinition("deepseek-v3", {
      name: "deepseek-v3",
      provider: "local",
      contextWindow: 64000,
      inputPrice: 0, // Local hosting
      outputPrice: 0,
      capabilities: ["chat", "code_generation", "reasoning"]
    });

    registry.registerModelDefinition("llama-3.3", {
      name: "llama-3.3",
      provider: "local", 
      contextWindow: 128000,
      inputPrice: 0,
      outputPrice: 0,
      capabilities: ["chat", "reasoning", "general"]
    });

    registry.registerModelDefinition("qwen-2.5", {
      name: "qwen-2.5",
      provider: "local",
      contextWindow: 32000,
      inputPrice: 0,
      outputPrice: 0,
      capabilities: ["chat", "reasoning", "efficiency"]
    });
  }

  setSessionId(sessionId) {
    this.sessionId = sessionId;
  }

  async chat(messages, options = {}) {
    // TODO: Implement actual local model API calls
    // Return sessionId in response like AnthropicProvider
    throw new Error("Local provider not yet implemented");
  }

  getInfo() {
    return {
      name: "local",
      models: ["deepseek-v3", "llama-3.3", "qwen-2.5"],
      capabilities: ["chat", "local_inference", "privacy"],
    };
  }

  getMetadata() {
    return {
      name: "local",
      description: "Self-hosted models for privacy and cost control",
      usage_guidance: `Use local models when you need:
- Complete data privacy and control
- Cost-effective inference at scale
- Custom fine-tuned models
- Offline capabilities
- No API rate limits

STRENGTHS:
- Full privacy control
- No API costs after setup
- Custom model support
- Offline operation
- No rate limiting
- Data never leaves your infrastructure

MODELS:
- deepseek-v3: Excellent for coding tasks and technical analysis
- llama-3.3: Strong general purpose reasoning and conversation
- qwen-2.5: Good balance of capability and efficiency

Best for: Privacy-sensitive tasks, high-volume usage, custom models, offline work.`,
      supportedModels: {
        "deepseek-v3": { contextWindow: 64000, capabilities: ["chat", "code_generation", "reasoning"] },
        "llama-3.3": { contextWindow: 128000, capabilities: ["chat", "reasoning", "general"] },
        "qwen-2.5": { contextWindow: 32000, capabilities: ["chat", "reasoning", "efficiency"] }
      },
      capabilities: [
        "chat",
        "local_inference", 
        "privacy",
        "offline_operation",
        "custom_models",
        "cost_effective"
      ],
      defaultModel: "deepseek-v3",
      strengths: [
        "privacy_control",
        "cost_effectiveness", 
        "offline_capability",
        "custom_model_support",
        "no_rate_limits"
      ],
      contextWindow: 64000
    };
  }
}
