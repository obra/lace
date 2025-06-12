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
}
