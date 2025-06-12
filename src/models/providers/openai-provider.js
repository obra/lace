// ABOUTME: OpenAI API provider for GPT models and specialized tasks
// ABOUTME: Will support o3 for advanced planning and GPT-4 for general reasoning

import { randomUUID } from "crypto";

export class OpenAIProvider {
  constructor(config = {}) {
    this.config = config;
    this.sessionId = randomUUID(); // One session per provider instance
    // TODO: Implement OpenAI provider
  }

  async initialize() {
    throw new Error("OpenAI provider not yet implemented");
  }

  setSessionId(sessionId) {
    this.sessionId = sessionId;
  }

  async chat(messages, options = {}) {
    // TODO: Implement actual OpenAI API calls
    // Return sessionId in response like AnthropicProvider
    throw new Error("OpenAI provider not yet implemented");
  }

  getInfo() {
    return {
      name: "openai",
      models: [
        "gpt-4o",
        "gpt-4o-mini",
        "o3-mini", // Future
      ],
      capabilities: ["chat", "tool_calling", "reasoning", "planning"],
    };
  }
}
