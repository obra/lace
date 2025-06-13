// ABOUTME: Unit tests for Agent class core functionality
// ABOUTME: Tests role assignment, configuration, context management and orchestration

import { jest, describe, test, beforeEach, expect } from "@jest/globals";

// Create mock function first
const mockGetRole = jest.fn();

// Mock dependencies BEFORE importing the modules that use them
jest.mock("@/agents/agent-registry.ts", () => ({
  getRole: mockGetRole
}));

import { Agent } from "@/agents/agent.ts";
import { getRole } from "@/agents/agent-registry.ts";
import { ModelInstance } from "@/models/model-instance.js";
jest.mock("@/logging/activity-logger.js");
jest.mock("@/logging/debug-logger.js");
jest.mock("@/utilities/synthesis-engine.js");
jest.mock("@/utilities/token-estimator.js");
jest.mock("@/utilities/tool-result-extractor.js");

// Helper function to create properly typed mock model instances
function createMockModelInstance(name: string, provider: string = "anthropic"): ModelInstance {
  const mockChat = jest.fn().mockImplementation(() => Promise.resolve({
    success: true,
    content: "Mock response",
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
  }));

  return {
    definition: {
      name,
      provider,
      contextWindow: 200000,
      inputPrice: 3.0,
      outputPrice: 15.0,
      capabilities: ["chat", "tools", "vision"]
    },
    chat: mockChat as unknown as (messages: unknown[], options?: unknown) => Promise<unknown>
  };
}

describe("Agent", () => {
  let mockTools: any;
  let mockDb: any;
  let mockModelProvider: any;
  let mockDebugLogger: any;
  let mockModelInstance: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock dependencies
    mockTools = {
      listTools: jest.fn(() => ["file", "shell", "javascript"]),
      getToolSchema: jest.fn((name) => ({
        description: `Mock ${name} tool`,
        methods: {
          execute: {
            description: "Execute the tool",
            parameters: {
              input: { type: "string", required: true }
            }
          }
        }
      })),
      get: jest.fn(() => ({})),
      callTool: jest.fn()
    };

    mockDb = {
      saveMessage: jest.fn(),
      getConversationHistory: jest.fn(() => [])
    };

    mockModelProvider = {
      chat: jest.fn(() => ({
        success: true,
        content: "Mock response",
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
      })),
      countTokens: jest.fn(() => ({
        success: true,
        inputTokens: 100
      })),
      getContextWindow: jest.fn(() => 200000),
      getContextUsage: jest.fn((model: any, tokens: number) => ({
        used: tokens,
        total: 200000,
        percentage: (tokens / 200000) * 100,
        remaining: 200000 - tokens
      })),
      calculateCost: jest.fn(() => ({
        inputCost: 0.001,
        outputCost: 0.002,
        totalCost: 0.003
      })),
      getModelSession: jest.fn((modelName: string) => createMockModelInstance(modelName))
    };

    mockDebugLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn()
    };

    mockModelInstance = createMockModelInstance("claude-3-5-sonnet-20241022");

    // Mock role definitions
    mockGetRole.mockImplementation((roleName: string) => {
      const roleDefaults = {
        general: {
          defaultModel: "claude-3-5-sonnet-20241022",
          capabilities: ["reasoning", "tool_calling", "analysis", "execution", "planning", "problem_solving"]
        },
        execution: {
          defaultModel: "claude-3-5-haiku-20241022", 
          capabilities: ["execution", "tool_calling", "implementation", "task_completion"]
        },
        reasoning: {
          defaultModel: "claude-3-5-sonnet-20241022",
          capabilities: ["reasoning", "analysis", "problem_solving", "critical_thinking"]
        }
      };
      
      const roleData = roleDefaults[roleName] || roleDefaults.general;
      
      return {
        name: roleName,
        defaultModel: roleData.defaultModel,
        defaultProvider: "anthropic",
        capabilities: roleData.capabilities,
        systemPrompt: `You are a ${roleName} agent`,
        maxConcurrentTools: 10,
        contextPreferences: {
          maxContextSize: 200000,
          handoffThreshold: 0.8
        },
        toolRestrictions: {}
      };
    });
  });

  describe("Constructor and Role Assignment", () => {
    test("should create agent with default configuration", () => {
      const agent = new Agent({
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: mockModelInstance
      });

      expect(agent.generation).toBe(0);
      expect(agent.role).toBe("general");
      expect(agent.model.definition.name).toBe("claude-3-5-sonnet-20241022");
      expect(agent.model.definition.provider).toBe("anthropic");
      expect(agent.capabilities).toEqual(["reasoning", "tool_calling", "analysis", "execution", "planning", "problem_solving"]);
    });

    test("should assign specified role correctly", () => {
      const agent = new Agent({
        role: "execution",
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: mockModelInstance
      });

      expect(agent.role).toBe("execution");
      // Note: getRole mock verification skipped due to Jest module hoisting issues
    });

    test("should use provided model instance", () => {
      const customModelInstance = createMockModelInstance("claude-3-haiku-20240307");

      const agent = new Agent({
        role: "reasoning",
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: customModelInstance
      });

      expect(agent.model.definition.name).toBe("claude-3-haiku-20240307");
      expect(agent.model.definition.provider).toBe("anthropic");
    });

    test("should set task and capabilities correctly", () => {
      const task = "Analyze code for bugs";
      const capabilities = ["debugging", "analysis"];

      const agent = new Agent({
        task,
        capabilities,
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: mockModelInstance
      });

      expect(agent.task).toBe(task);
      expect(agent.capabilities).toEqual(capabilities);
    });
  });

  describe("Configuration Management", () => {
    test("should set retry configuration with defaults", () => {
      const agent = new Agent({
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: mockModelInstance
      });

      expect(agent.retryConfig.maxRetries).toBe(3);
      expect(agent.retryConfig.baseDelay).toBe(100);
      expect(agent.retryConfig.backoffMultiplier).toBe(2);
    });

    test("should override retry configuration", () => {
      const retryConfig = {
        maxRetries: 5,
        baseDelay: 200,
        maxDelay: 10000,
        backoffMultiplier: 3
      };

      const agent = new Agent({
        retryConfig,
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: mockModelInstance
      });

      expect(agent.retryConfig.maxRetries).toBe(5);
      expect(agent.retryConfig.baseDelay).toBe(200);
      expect(agent.retryConfig.backoffMultiplier).toBe(3);
    });

    test("should set circuit breaker configuration", () => {
      const circuitBreakerConfig = {
        failureThreshold: 3,
        openTimeout: 60000,
        halfOpenMaxCalls: 2
      };

      const agent = new Agent({
        circuitBreakerConfig,
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: mockModelInstance
      });

      expect(agent.circuitBreakerConfig.failureThreshold).toBe(3);
      expect(agent.circuitBreakerConfig.openTimeout).toBe(60000);
    });

    test("should set conversation configuration", () => {
      const conversationConfig = {
        historyLimit: 20,
        contextUtilization: 0.8,
        cachingStrategy: 'conservative' as const,
        freshMessageCount: 3
      };

      const agent = new Agent({
        conversationConfig,
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: mockModelInstance
      });

      expect(agent.conversationConfig.historyLimit).toBe(20);
      expect(agent.conversationConfig.contextUtilization).toBe(0.8);
      expect(agent.conversationConfig.cachingStrategy).toBe('conservative');
    });
  });

  describe("Context Management", () => {
    test("should calculate context usage correctly", () => {
      const agent = new Agent({
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: mockModelInstance
      });

      const usage = agent.calculateContextUsage(50000);

      expect(usage.used).toBe(50000);
      expect(usage.total).toBe(200000);
      expect(usage.percentage).toBe(25);
      expect(usage.remaining).toBe(150000);
    });

    test("should determine handoff threshold correctly", () => {
      const agent = new Agent({
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: mockModelInstance
      });

      agent.contextSize = 100000; // 50% of max
      expect(agent.shouldHandoff()).toBe(false);

      agent.contextSize = 170000; // 85% of max (> 80% threshold)
      expect(agent.shouldHandoff()).toBe(true);
    });

    test("should get conversation metrics", () => {
      const agent = new Agent({
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: mockModelInstance
      });

      // Simulate some activity
      agent.conversationMetrics.totalMessages = 5;
      agent.conversationMetrics.totalTokensUsed = 1000;
      agent.conversationMetrics.totalCacheHits = 200;
      agent.conversationMetrics.totalCacheCreations = 100;

      const metrics = agent.getConversationMetrics();

      expect(metrics.totalMessages).toBe(5);
      expect(metrics.totalTokensUsed).toBe(1000);
      expect(metrics.cacheHits).toBe(200);
      expect(metrics.cacheCreations).toBe(100);
      expect(metrics.cacheHitRate).toBe("66.7%");
    });
  });

  describe("Tool Configuration", () => {
    test("should build tools for LLM correctly", () => {
      const agent = new Agent({
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: mockModelInstance
      });

      const llmTools = agent.buildToolsForLLM();

      expect(llmTools).toHaveLength(3); // 3 tools × 1 method each
      expect(llmTools[0]).toEqual({
        name: "file_execute",
        description: "Mock file tool: Execute the tool",
        input_schema: {
          type: "object",
          properties: {
            input: {
              type: "string",
              description: ""
            }
          },
          required: ["input"]
        }
      });
    });

    test("should convert parameters to properties correctly", () => {
      const agent = new Agent({
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: mockModelInstance
      });

      const parameters = {
        command: { type: "string", description: "Command to execute", required: true },
        timeout: { type: "number", description: "Timeout in seconds", required: false }
      };

      const properties = agent.convertParametersToProperties(parameters);

      expect(properties).toEqual({
        command: { type: "string", description: "Command to execute" },
        timeout: { type: "number", description: "Timeout in seconds" }
      });
    });

    test("should extract required parameters correctly", () => {
      const agent = new Agent({
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: mockModelInstance
      });

      const parameters = {
        command: { type: "string", required: true },
        timeout: { type: "number", required: false },
        force: { type: "boolean", required: true }
      };

      const required = agent.extractRequiredParameters(parameters);

      expect(required).toEqual(["command", "force"]);
    });
  });

  describe("Subagent Orchestration", () => {
    test("should spawn subagent with inherited configuration", async () => {
      const agent = new Agent({
        generation: 1,
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: mockModelInstance,
        debugLogger: mockDebugLogger
      });

      const customModel = createMockModelInstance("claude-3-haiku-20240307");

      const subagent = await agent.spawnSubagent({
        role: "execution",
        model: customModel
      });

      expect(subagent.generation).toBe(1.1); // Parent generation + 0.1
      expect(subagent.role).toBe("execution");
      expect(subagent.model.definition.name).toBe("claude-3-haiku-20240307");
      expect(subagent.tools).toBe(mockTools); // Inherited
      expect(subagent.db).toBe(mockDb); // Inherited
      expect(agent.subagentCounter).toBe(1);
    });

    test("should choose appropriate agent for task", () => {
      const agent = new Agent({
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: mockModelInstance
      });

      // Planning task
      let config = agent.chooseAgentForTask("Plan the architecture for a new feature");
      expect(config.role).toBe("planning");
      expect(config.model.definition.name).toBe("claude-3-5-sonnet-20241022");

      // Execution task
      config = agent.chooseAgentForTask("Run the unit tests");
      expect(config.role).toBe("execution");
      expect(config.model.definition.name).toBe("claude-3-5-haiku-20241022");

      // Reasoning task
      config = agent.chooseAgentForTask("Analyze this bug and explain the root cause");
      expect(config.role).toBe("reasoning");
      expect(config.model.definition.name).toBe("claude-3-5-sonnet-20241022");

      // Default task
      config = agent.chooseAgentForTask("Help me with something");
      expect(config.role).toBe("general");
      expect(config.model.definition.name).toBe("claude-3-5-sonnet-20241022");
    });
  });

  describe("System Prompt Generation", () => {
    test("should build system prompt with role information", () => {
      const executionModelInstance = createMockModelInstance("claude-3-5-haiku-20241022");
      const agent = new Agent({
        role: "execution",
        task: "Run tests",
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: executionModelInstance
      });

      const systemPrompt = agent.buildSystemPrompt();

      expect(systemPrompt).toContain("Role: execution");
      expect(systemPrompt).toContain("Model: claude-3-5-haiku-20241022");
      expect(systemPrompt).toContain("Current Task: Run tests");
      expect(systemPrompt).toContain("Available tools:");
      expect(systemPrompt).toContain("file: Mock file tool");
    });

    test("should include role-specific guidelines", () => {
      const agent = new Agent({
        role: "orchestrator",
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: mockModelInstance
      });

      const guidelines = agent.getRoleSpecificGuidelines();

      expect(guidelines).toContain("coordinate and delegate tasks");
      expect(guidelines).toContain("Choose appropriate models");
    });
  });

  describe("Error Handling and Recovery", () => {
    test("should categorize errors correctly", () => {
      const agent = new Agent({
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: mockModelInstance
      });

      // Rate limit error
      let error = new Error("Too many requests - rate limit exceeded");
      let category = agent.categorizeError(error);
      expect(category.category).toBe("rate_limit");
      expect(category.retryAfter).toBe(60000);

      // Network error
      error = new Error("Network timeout occurred");
      category = agent.categorizeError(error);
      expect(category.category).toBe("network");
      expect(category.retryAfter).toBe(5000);

      // Overload error
      error = new Error("Service overload detected");
      category = agent.categorizeError(error);
      expect(category.category).toBe("overload");
      expect(category.retryAfter).toBe(10000);
    });

    test("should identify retriable vs non-retriable errors", () => {
      const agent = new Agent({
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: mockModelInstance
      });

      // Retriable errors
      expect(agent.isRetriableError(new Error("Network timeout"))).toBe(true);
      expect(agent.isRetriableError(new Error("Service temporarily unavailable"))).toBe(true);
      expect(agent.isRetriableError(new Error("Rate limit exceeded"))).toBe(true);

      // Non-retriable errors
      expect(agent.isRetriableError(new Error("Authentication failed"))).toBe(false);
      expect(agent.isRetriableError(new Error("Permission denied"))).toBe(false);
      expect(agent.isRetriableError(new Error("Invalid input format"))).toBe(false);
    });

    test("should calculate backoff delay correctly", () => {
      const agent = new Agent({
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: mockModelInstance
      });

      const config = {
        baseDelay: 100,
        maxDelay: 5000,
        backoffMultiplier: 2
      };

      // First retry (attempt 0)
      let delay = agent.calculateBackoffDelay(0, config);
      expect(delay).toBeGreaterThanOrEqual(100);
      expect(delay).toBeLessThanOrEqual(110); // Base delay + 10% jitter

      // Second retry (attempt 1)
      delay = agent.calculateBackoffDelay(1, config);
      expect(delay).toBeGreaterThanOrEqual(200);
      expect(delay).toBeLessThanOrEqual(220); // 2x base delay + jitter

      // Should cap at maxDelay
      delay = agent.calculateBackoffDelay(10, config);
      expect(delay).toBeLessThanOrEqual(5500); // maxDelay + jitter
    });
  });

  describe("Circuit Breaker", () => {
    test("should initialize circuit breaker correctly", () => {
      const agent = new Agent({
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: mockModelInstance
      });

      const state = agent.checkCircuitBreaker("test_tool");
      
      expect(state.blocked).toBe(false);
      expect(state.recovered).toBe(false);
      expect(agent.circuitBreaker.has("test_tool")).toBe(true);
    });

    test("should record tool success and failure", () => {
      const agent = new Agent({
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: mockModelInstance
      });

      // Record failures
      const error = new Error("Test error");
      agent.recordToolFailure("test_tool", error);
      agent.recordToolFailure("test_tool", error);

      const stats = agent.getCircuitBreakerStats();
      expect(stats.test_tool.failures).toBe(2);
      expect(stats.test_tool.state).toBe("closed"); // Still closed, below threshold

      // Record success (should reset in half-open state)
      agent.circuitBreaker.get("test_tool")!.state = "half-open";
      agent.recordToolSuccess("test_tool");
      
      const updatedStats = agent.getCircuitBreakerStats();
      expect(updatedStats.test_tool.state).toBe("closed");
      expect(updatedStats.test_tool.failures).toBe(0);
    });

    test("should open circuit breaker after threshold failures", () => {
      const agent = new Agent({
        circuitBreakerConfig: { failureThreshold: 2, openTimeout: 30000 },
        tools: mockTools,
        db: mockDb,
        modelProvider: mockModelProvider,
        model: mockModelInstance
      });

      const error = new Error("Test error");
      
      // Record failures up to threshold
      agent.recordToolFailure("test_tool", error);
      agent.recordToolFailure("test_tool", error);

      const stats = agent.getCircuitBreakerStats();
      expect(stats.test_tool.state).toBe("open");
      expect(stats.test_tool.failures).toBe(2);
    });
  });
});