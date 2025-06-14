// ABOUTME: Standard mock factory for common dependencies used across tests
// ABOUTME: Provides reusable mock configurations for tools, database, providers, and loggers

import { jest } from "@jest/globals";
import { createMockModelInstance, createMockModelProvider } from "./model-definitions.js";

// Re-export from model-definitions for convenience
export { createMockModelProvider } from "./model-definitions.js";

/**
 * Create a standard mock tools configuration
 * @param {object} options - Configuration options
 * @param {Array<string>} options.availableTools - List of available tools
 * @param {boolean} options.shouldSucceed - Whether tool calls should succeed
 * @param {object} options.customResponses - Custom responses for specific tools
 * @returns {object} Mock tools object
 */
export function createMockTools(options = {}) {
  const {
    availableTools = ["file", "shell", "javascript", "search", "task"],
    shouldSucceed = true,
    customResponses = {}
  } = options;

  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    
    listTools: jest.fn().mockReturnValue(availableTools),
    
    get: jest.fn((toolName) => {
      if (availableTools.includes(toolName)) {
        return { name: toolName };
      }
      return null;
    }),
    
    getToolSchema: jest.fn((toolName) => ({
      description: `Mock ${toolName} tool description`,
      methods: {
        execute: {
          description: `Execute ${toolName}`,
          parameters: {
            input: {
              type: "string",
              required: false,
              description: "Input parameter"
            }
          }
        },
        run: {
          description: `Run ${toolName}`,
          parameters: {
            command: {
              type: "string", 
              required: true,
              description: "Command to run"
            }
          }
        },
        read: {
          description: `Read using ${toolName}`,
          parameters: {
            path: {
              type: "string",
              required: true, 
              description: "File path"
            }
          }
        }
      }
    })),
    
    callTool: jest.fn(async (toolName, method, params) => {
      const toolKey = `${toolName}_${method}`;
      
      if (customResponses[toolKey]) {
        return customResponses[toolKey];
      }
      
      if (!shouldSucceed) {
        throw new Error(`Tool ${toolName} ${method} failed`);
      }
      
      return {
        success: true,
        result: `Mock ${toolName} ${method} result`,
        output: `Mock output from ${toolName}`,
        executionTime: 100
      };
    }),
    
    getAllSchemas: jest.fn(() => {
      const schemas = {};
      for (const tool of availableTools) {
        schemas[tool] = {
          description: `Mock ${tool} tool description`,
          methods: {
            execute: { description: `Execute ${tool}`, parameters: {} },
            run: { description: `Run ${tool}`, parameters: {} }
          }
        };
      }
      return schemas;
    })
  };
}

/**
 * Create a standard mock database configuration
 * @param {object} options - Configuration options
 * @param {Array<object>} options.conversationHistory - Pre-loaded conversation history
 * @param {boolean} options.shouldSucceed - Whether database operations should succeed
 * @returns {object} Mock database object
 */
export function createMockDatabase(options = {}) {
  const {
    conversationHistory = [],
    shouldSucceed = true
  } = options;

  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    
    saveMessage: jest.fn().mockImplementation(async (sessionId, generation, role, content, toolCalls, contextSize) => {
      if (!shouldSucceed) {
        throw new Error("Database save failed");
      }
      
      const message = {
        sessionId,
        generation,
        role,
        content,
        tool_calls: JSON.stringify(toolCalls || []),
        context_size: contextSize || 0,
        timestamp: new Date().toISOString()
      };
      
      conversationHistory.push(message);
      return message;
    }),
    
    getConversationHistory: jest.fn().mockImplementation(async (sessionId, limit = 50) => {
      if (!shouldSucceed) {
        throw new Error("Database read failed");
      }
      
      return conversationHistory
        .filter(msg => msg.sessionId === sessionId)
        .slice(-limit);
    }),
    
    getMessages: jest.fn().mockImplementation(async (sessionId, limit = 50) => {
      return conversationHistory
        .filter(msg => msg.sessionId === sessionId)
        .slice(-limit);
    }),
    
    searchConversations: jest.fn().mockImplementation(async (sessionId, query) => {
      return conversationHistory
        .filter(msg => msg.sessionId === sessionId && msg.content.includes(query));
    }),
    
    getGenerationHistory: jest.fn().mockImplementation(async (sessionId, generation) => {
      return conversationHistory
        .filter(msg => msg.sessionId === sessionId && msg.generation === generation);
    }),
    
    saveHandoff: jest.fn().mockResolvedValue(undefined),
    
    close: jest.fn().mockResolvedValue(undefined),
    
    // Test helpers
    _getStoredMessages: () => [...conversationHistory],
    _clearMessages: () => conversationHistory.length = 0
  };
}

/**
 * Create a standard mock activity logger
 * @param {object} options - Configuration options
 * @returns {object} Mock activity logger object
 */
export function createMockActivityLogger(options = {}) {
  const {
    defaultEvents = []
  } = options;
  
  const loggedEvents = [...defaultEvents];
  
  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    
    logEvent: jest.fn().mockImplementation((eventType, details, context, sessionId, conversationTurn) => {
      const event = {
        eventType,
        details,
        context,
        sessionId,
        conversationTurn,
        timestamp: new Date().toISOString()
      };
      loggedEvents.push(event);
    }),
    
    logToolCall: jest.fn().mockImplementation((toolName, params, result, sessionId) => {
      loggedEvents.push({
        eventType: "tool_call",
        toolName,
        params,
        result,
        sessionId,
        timestamp: new Date().toISOString()
      });
    }),
    
    logError: jest.fn().mockImplementation((error, context, sessionId) => {
      loggedEvents.push({
        eventType: "error",
        error: error.message,
        context,
        sessionId,
        timestamp: new Date().toISOString()
      });
    }),
    
    getEvents: jest.fn().mockImplementation(async (options = {}) => {
      const { sessionId, eventType, limit } = options;
      let filteredEvents = [...loggedEvents];
      
      if (sessionId) {
        filteredEvents = filteredEvents.filter(event => 
          event.localSessionId === sessionId || event.sessionId === sessionId
        );
      }
      
      if (eventType) {
        filteredEvents = filteredEvents.filter(event => event.eventType === eventType);
      }
      
      if (limit) {
        filteredEvents = filteredEvents.slice(0, limit);
      }
      
      return filteredEvents;
    }),
    
    close: jest.fn().mockResolvedValue(undefined),
    
    // Test helpers
    _getLoggedEvents: () => [...loggedEvents],
    _clearEvents: () => loggedEvents.length = 0
  };
}

/**
 * Create a standard mock conversation
 * @param {object} options - Configuration options
 * @param {string} options.sessionId - Session ID for the conversation
 * @param {Array<object>} options.messages - Pre-loaded messages
 * @returns {object} Mock conversation object
 */
export function createMockConversation(options = {}) {
  const {
    sessionId = "session-123",
    messages = [
      {
        id: 1,
        sessionId: "session-123",
        generation: 1,
        role: "user",
        content: "Please help me with my code",
        timestamp: "2025-06-05T14:30:00Z",
        contextSize: 100,
      },
      {
        id: 2,
        sessionId: "session-123",
        generation: 1,
        role: "assistant",
        content: "I'll help you with that.",
        timestamp: "2025-06-05T14:30:05Z",
        contextSize: 150,
      },
    ]
  } = options;

  return {
    getSessionId: jest.fn().mockReturnValue(sessionId),
    
    getMessages: jest.fn().mockImplementation(async (limit) => {
      return limit ? messages.slice(0, limit) : messages;
    }),
    
    search: jest.fn().mockImplementation(async (query, limit) => {
      const searchResults = [
        {
          id: 3,
          content: "Related conversation about code",
          timestamp: "2025-06-05T14:25:00Z",
        },
      ];
      return limit ? searchResults.slice(0, limit) : searchResults;
    })
  };
}

/**
 * Create a standard mock debug logger
 * @param {object} options - Configuration options
 * @returns {object} Mock debug logger object
 */
export function createMockDebugLogger(options = {}) {
  const logs = [];
  
  return {
    debug: jest.fn().mockImplementation((message, data) => {
      logs.push({ level: "debug", message, data, timestamp: new Date().toISOString() });
    }),
    
    info: jest.fn().mockImplementation((message, data) => {
      logs.push({ level: "info", message, data, timestamp: new Date().toISOString() });
    }),
    
    warn: jest.fn().mockImplementation((message, data) => {
      logs.push({ level: "warn", message, data, timestamp: new Date().toISOString() });
    }),
    
    error: jest.fn().mockImplementation((message, data) => {
      logs.push({ level: "error", message, data, timestamp: new Date().toISOString() });
    }),
    
    // Test helpers
    _getLogs: () => [...logs],
    _clearLogs: () => logs.length = 0
  };
}

/**
 * Create a standard mock snapshot manager
 * @param {object} options - Configuration options
 * @returns {object} Mock snapshot manager object
 */
export function createMockSnapshotManager(options = {}) {
  const snapshots = [];
  let snapshotCounter = 1;
  
  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    
    createPreToolSnapshot: jest.fn().mockImplementation((context) => {
      const snapshot = {
        snapshotId: `pre-${snapshotCounter++}`,
        context,
        timestamp: new Date().toISOString(),
        type: "pre-tool"
      };
      snapshots.push(snapshot);
      return snapshot;
    }),
    
    createPostToolSnapshot: jest.fn().mockImplementation((context) => {
      const snapshot = {
        snapshotId: `post-${snapshotCounter++}`,
        context,
        timestamp: new Date().toISOString(), 
        type: "post-tool"
      };
      snapshots.push(snapshot);
      return snapshot;
    }),
    
    getSnapshot: jest.fn().mockImplementation((snapshotId) => {
      return snapshots.find(s => s.snapshotId === snapshotId);
    }),
    
    listSnapshots: jest.fn().mockImplementation(() => [...snapshots]),
    
    // Test helpers
    _getSnapshots: () => [...snapshots],
    _clearSnapshots: () => snapshots.length = 0
  };
}

/**
 * Create a mock tool call object
 * @param {object} options - Configuration options
 * @param {string} options.name - Tool name
 * @param {object} options.input - Tool input parameters
 * @param {string} options.description - Tool description
 * @returns {object} Mock tool call object
 */
export function createMockToolCall(options = {}) {
  const {
    name = "file_write",
    input = { path: "/test/file.txt", content: "test content" },
    description = "Write content to a file"
  } = options;

  return {
    name,
    input,
    description
  };
}

/**
 * Create a complete standard mock configuration for agents
 * @param {object} options - Configuration options
 * @param {string} options.modelName - Model to use
 * @param {string} options.role - Agent role
 * @param {Array<string>} options.availableTools - Available tools
 * @returns {object} Complete mock configuration
 */
export function createStandardMockConfig(options = {}) {
  const {
    modelName = "claude-3-5-sonnet-20241022",
    role = "general",
    availableTools = ["file", "shell", "javascript"],
    conversationHistory = []
  } = options;

  const mockConfig = {
    tools: createMockTools({ availableTools }),
    database: createMockDatabase({ conversationHistory }),
    model: createMockModelInstance(modelName),
    modelProvider: createMockModelProvider("anthropic"),
    activityLogger: createMockActivityLogger(),
    debugLogger: createMockDebugLogger(),
    snapshotManager: createMockSnapshotManager(),
    role,
    generation: 0,
    sessionId: "test-session",
    conversationConfig: {
      historyLimit: 10,
      contextUtilization: 0.7,
      cachingStrategy: "aggressive",
      freshMessageCount: 2
    },
    retryConfig: {
      maxRetries: 3,
      baseDelay: 100,
      maxDelay: 5000,
      backoffMultiplier: 2
    },
    circuitBreakerConfig: {
      failureThreshold: 3,
      openTimeout: 30000,
      halfOpenMaxCalls: 1
    }
  };

  return mockConfig;
}

/**
 * Reset all mocks in a configuration
 * @param {object} mockConfig - Mock configuration object
 */
export function resetStandardMocks(mockConfig) {
  if (mockConfig.tools) {
    jest.clearAllMocks();
    if (mockConfig.tools._clearMessages) mockConfig.tools._clearMessages();
  }
  
  if (mockConfig.database && mockConfig.database._clearMessages) {
    mockConfig.database._clearMessages();
  }
  
  if (mockConfig.activityLogger && mockConfig.activityLogger._clearEvents) {
    mockConfig.activityLogger._clearEvents();
  }
  
  if (mockConfig.debugLogger && mockConfig.debugLogger._clearLogs) {
    mockConfig.debugLogger._clearLogs();
  }
  
  if (mockConfig.snapshotManager && mockConfig.snapshotManager._clearSnapshots) {
    mockConfig.snapshotManager._clearSnapshots();
  }
}

/**
 * Create a mock Anthropic client for provider testing
 * @param {object} options - Configuration options
 * @returns {object} Mock Anthropic client
 */
export function createMockAnthropicClient(options = {}) {
  const {
    chatResponse = { content: [{ text: "Mock response" }], usage: { input_tokens: 10, output_tokens: 5 } },
    countTokensResponse = { input_tokens: 42 },
    shouldSucceed = true,
    streamResponse = null
  } = options;

  const mockClient = {
    messages: {
      create: jest.fn().mockImplementation(async (params) => {
        if (!shouldSucceed) {
          throw new Error("API error");
        }
        return chatResponse;
      }),
      
      stream: jest.fn().mockImplementation(async (params) => {
        if (!shouldSucceed) {
          throw new Error("Streaming error");
        }
        
        if (streamResponse) {
          return streamResponse;
        }
        
        // Default mock stream
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: "message_start", message: { usage: { input_tokens: 10 } } };
            yield { type: "content_block_start", index: 0, content_block: { type: "text" } };
            yield { type: "content_block_delta", delta: { type: "text_delta", text: "Mock " } };
            yield { type: "content_block_delta", delta: { type: "text_delta", text: "response" } };
            yield { type: "content_block_stop", index: 0 };
            yield { type: "message_stop", usage: { output_tokens: 5 } };
          }
        };
      })
    },
    
    beta: {
      messages: {
        countTokens: jest.fn().mockImplementation(async (params) => {
          if (!shouldSucceed) {
            throw new Error("Token counting error");
          }
          return countTokensResponse;
        })
      }
    }
  };

  return mockClient;
}

/**
 * Create a mock GitOperations for snapshot testing
 * @param {object} options - Configuration options
 * @returns {object} Mock GitOperations
 */
export function createMockGitOperations(options = {}) {
  const {
    shouldSucceed = true,
    commitId = null,
    stats = { commitCount: 5, fileCount: 10, repositorySize: 1024 },
    changedFiles = { modified: ["file1.txt"], untracked: ["file2.txt"], deleted: [] }
  } = options;

  return {
    initialize: jest.fn().mockImplementation(async () => {
      if (!shouldSucceed) throw new Error("Git initialization failed");
    }),
    
    addAndCommit: jest.fn().mockImplementation(async (message) => {
      if (!shouldSucceed) throw new Error("Git commit failed");
      return commitId || `commit-${Date.now()}`;
    }),
    
    getRepositoryStats: jest.fn().mockImplementation(async () => {
      if (!shouldSucceed) throw new Error("Failed to get stats");
      return stats;
    }),
    
    getChangedFiles: jest.fn().mockImplementation(async () => {
      if (!shouldSucceed) throw new Error("Failed to get changed files");
      return changedFiles;
    }),
    
    cleanup: jest.fn().mockResolvedValue(undefined)
  };
}

/**
 * Create a mock snapshot configuration
 * @param {object} options - Configuration options
 * @returns {object} Mock snapshot configuration
 */
export function createMockSnapshotConfig(options = {}) {
  const {
    enabled = true,
    maxAge = "7 days",
    maxSnapshots = 1000,
    compressionLevel = 6,
    autoSnapshotOnToolUse = true
  } = options;

  return {
    enabled,
    retentionPolicy: {
      maxAge,
      maxSnapshots,
      keepCheckpoints: true,
    },
    performance: {
      excludePatterns: ["node_modules/**", "*.log"],
      compressionLevel,
      backgroundPruning: true,
    },
    integration: {
      autoSnapshotOnToolUse,
      conversationTurnsToCapture: 5,
      toolUsesToCapture: 10,
    },
  };
}

/**
 * Common mock configurations for different test scenarios
 */
export const MOCK_SCENARIOS = {
  // Basic agent testing
  basicAgent: () => createStandardMockConfig({
    modelName: "claude-3-5-sonnet-20241022",
    role: "general",
    availableTools: ["file", "shell"]
  }),
  
  // Execution agent testing
  executionAgent: () => createStandardMockConfig({
    modelName: "claude-3-5-haiku-20241022", 
    role: "execution",
    availableTools: ["shell", "file", "javascript"]
  }),
  
  // Reasoning agent testing
  reasoningAgent: () => createStandardMockConfig({
    modelName: "claude-3-5-sonnet-20241022",
    role: "reasoning",
    availableTools: ["file", "search", "task"]
  }),
  
  // With conversation history
  withHistory: () => createStandardMockConfig({
    conversationHistory: [
      { sessionId: "test-session", role: "user", content: "Hello", generation: 0 },
      { sessionId: "test-session", role: "assistant", content: "Hi there", generation: 0 }
    ]
  }),
  
  // Error scenarios
  databaseError: () => {
    const config = createStandardMockConfig();
    config.database = createMockDatabase({ shouldSucceed: false });
    return config;
  },
  
  toolError: () => {
    const config = createStandardMockConfig();
    config.tools = createMockTools({ shouldSucceed: false });
    return config;
  }
};