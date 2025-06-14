// Mock Agent for Jest tests
import { jest } from "@jest/globals";

export class Agent {
  constructor(config = {}) {
    this.role = config.role || "orchestrator";
    this.model = config.model || {
      definition: {
        name: "claude-3-5-sonnet-20241022",
        provider: "anthropic",
        contextWindow: 200000,
        inputPrice: 3.0,
        outputPrice: 15.0,
        capabilities: ["chat", "tools", "vision"]
      },
      chat: async () => ({ success: true, content: "Mock response" })
    };
    this.generation = config.generation || 0;
    this.contextSize = 0;
    this.maxContextSize = 200000;
    this.debugLogger = config.debugLogger || null;
    this.activityLogger = config.activityLogger || null;
    this.task = config.task || null;
    this.capabilities = config.capabilities || ["reasoning"];
  }

  processInput = jest.fn().mockResolvedValue({
    content: "Test response",
    usage: { total_tokens: 100 },
  });

  getConversationHistory = jest.fn(() => Promise.resolve([]));
  toolExecutor = {
    executeTool: jest.fn(() => Promise.resolve({ success: true }))
  };
  shouldHandoff = jest.fn(() => false);
  buildToolsForLLM = jest.fn(() => []);
  spawnSubagent = jest.fn((options) => Promise.resolve(new Agent(options)));
  chooseAgentForTask = jest.fn((task) => {
    const taskLower = task.toLowerCase();
    if (
      taskLower.includes("plan") ||
      taskLower.includes("design") ||
      taskLower.includes("architect")
    ) {
      return {
        role: "planning",
        model: {
          definition: {
            name: "claude-3-5-sonnet-20241022",
            provider: "anthropic",
            contextWindow: 200000,
            inputPrice: 3.0,
            outputPrice: 15.0,
            capabilities: ["chat", "tools", "vision"]
          },
          chat: async () => ({ success: true, content: "Mock response" })
        },
        capabilities: ["planning", "reasoning", "analysis"],
      };
    }
    if (
      taskLower.includes("run") ||
      taskLower.includes("execute") ||
      taskLower.includes("list") ||
      taskLower.includes("show")
    ) {
      return {
        role: "execution",
        model: {
          definition: {
            name: "claude-3-5-haiku-20241022",
            provider: "anthropic",
            contextWindow: 200000,
            inputPrice: 0.25,
            outputPrice: 1.25,
            capabilities: ["chat", "tools"]
          },
          chat: async () => ({ success: true, content: "Mock response" })
        },
        capabilities: ["execution", "tool_calling"],
      };
    }
    if (
      taskLower.includes("analyze") ||
      taskLower.includes("explain") ||
      taskLower.includes("debug") ||
      taskLower.includes("fix")
    ) {
      return {
        role: "reasoning",
        model: {
          definition: {
            name: "claude-3-5-sonnet-20241022",
            provider: "anthropic",
            contextWindow: 200000,
            inputPrice: 3.0,
            outputPrice: 15.0,
            capabilities: ["chat", "tools", "vision"]
          },
          chat: async () => ({ success: true, content: "Mock response" })
        },
        capabilities: ["reasoning", "analysis", "debugging"],
      };
    }
    return {
      role: "general",
      model: {
        definition: {
          name: "claude-3-5-sonnet-20241022",
          provider: "anthropic",
          contextWindow: 200000,
          inputPrice: 3.0,
          outputPrice: 15.0,
          capabilities: ["chat", "tools", "vision"]
        },
        chat: async () => ({ success: true, content: "Mock response" })
      },
      capabilities: ["reasoning", "tool_calling"],
    };
  });
}
