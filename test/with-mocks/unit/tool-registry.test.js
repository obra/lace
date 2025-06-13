// ABOUTME: Unit tests for ToolRegistry class
// ABOUTME: Tests tool registration, method calls, activity logging, and snapshot integration

import { jest, describe, test, beforeEach, afterEach, expect } from "@jest/globals";
import { ToolRegistry } from "@/tools/tool-registry.js";

// Mock the Conversation class
const mockConversation = {
  getMessages: jest.fn(() => Promise.resolve([
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi there" }
  ]))
};

// Mock Conversation.load to return our mock
jest.mock("@/conversation/conversation.js", () => ({
  Conversation: {
    load: jest.fn(() => Promise.resolve(mockConversation))
  }
}));

// Mock tool classes
class MockShellTool {
  async initialize() {}
  
  getMetadata() {
    return {
      description: "Shell command execution",
      methods: {
        run: {
          description: "Execute shell command",
          parameters: {
            command: { type: "string", required: true }
          }
        }
      }
    };
  }
  
  async run(params) {
    return { stdout: "hello\n", stderr: "", exitCode: 0 };
  }
  
  // BaseTool compatibility
  async execute(params) {
    return this.run(params);
  }
}

class MockReadFileTool {
  async initialize() {}
  
  getMetadata() {
    return {
      description: "Read file operations",
      methods: {
        run: {
          description: "Read file",
          parameters: {
            path: { type: "string", required: true }
          }
        }
      }
    };
  }
  
  async run(params) {
    return { content: "hello", size: 5, path: params.path };
  }
  
  // BaseTool compatibility
  async execute(params) {
    return this.run(params);
  }
}

class MockWriteFileTool {
  async initialize() {}
  
  getMetadata() {
    return {
      description: "Write file operations", 
      methods: {
        run: {
          description: "Write file",
          parameters: {
            path: { type: "string", required: true },
            content: { type: "string", required: true }
          }
        }
      }
    };
  }
  
  async run(params) {
    return { bytes_written: params.content.length, path: params.path };
  }
  
  // BaseTool compatibility
  async execute(params) {
    return this.run(params);
  }
}

class MockListFilesTool {
  async initialize() {}
  
  getMetadata() {
    return {
      description: "List files operations",
      methods: {
        run: {
          description: "List files",
          parameters: {
            path: { type: "string", required: true }
          }
        }
      }
    };
  }
  
  async run(params) {
    return { entries: [], count: 0, path: params.path };
  }
  
  // BaseTool compatibility
  async execute(params) {
    return this.run(params);
  }
}

class MockFileSearchTool {
  async initialize() {}
  
  getMetadata() {
    return {
      description: "Search files operations",
      methods: {
        run: {
          description: "Search files",
          parameters: {
            pattern: { type: "string", required: true }
          }
        }
      }
    };
  }
  
  async run(params) {
    return { matches: [], count: 0 };
  }
  
  // BaseTool compatibility
  async execute(params) {
    return this.run(params);
  }
}

class MockAgentDelegateTool {
  async initialize() {}
  
  async execute(params, options) {
    return {
      success: true,
      data: `Mocked run result`
    };
  }
  
  getMetadata() {
    return {
      name: 'agent_delegate',
      description: 'Mock agent delegate tool',
      methods: {
        run: { description: 'Mock delegate task' },
      }
    };
  }
}

// Mock all tool modules
jest.mock("@/tools/shell.js", () => ({
  ShellTool: MockShellTool
}));

jest.mock("@/tools/read-file.js", () => ({
  ReadFileTool: MockReadFileTool
}));

jest.mock("@/tools/write-file.js", () => ({
  WriteFileTool: MockWriteFileTool
}));

jest.mock("@/tools/list-files.js", () => ({
  ListFilesTool: MockListFilesTool
}));

jest.mock("@/tools/javascript.js", () => ({
  JavaScriptTool: class {
    async initialize() {}
    getMetadata() { return { description: "JavaScript execution" }; }
    async run() { return { result: 42 }; }
    async execute(params) {
      return this.run(params);
    }
  }
}));

jest.mock("@/tools/file-search.js", () => ({
  FileSearchTool: MockFileSearchTool
}));

jest.mock("@/tools/agent-delegate.js", () => ({
  AgentDelegateTool: MockAgentDelegateTool
}));

describe("ToolRegistry", () => {
  let registry;
  let mockActivityLogger;
  let mockSnapshotManager;
  let mockConversationDB;

  beforeEach(async () => {
    // Reset the conversation mock
    mockConversation.getMessages.mockResolvedValue([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" }
    ]);

    mockActivityLogger = {
      logEvent: jest.fn()
    };

    mockSnapshotManager = {
      createPreToolSnapshot: jest.fn(() => ({ snapshotId: "pre-123" })),
      createPostToolSnapshot: jest.fn(() => ({ snapshotId: "post-456" }))
    };

    mockConversationDB = {
      getConversationHistory: jest.fn(() => [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" }
      ])
    };

    registry = new ToolRegistry({
      activityLogger: mockActivityLogger,
      snapshotManager: mockSnapshotManager
    });

    await registry.initialize();
  });

  describe("Initialization and Registration", () => {
    test("should initialize with core tools", () => {
      const tools = registry.listTools();
      
      expect(tools).toContain("shell");
      expect(tools).toContain("read_file");
      expect(tools).toContain("write_file");
      expect(tools).toContain("list_files");
      expect(tools).toContain("file_search");
      expect(tools).toContain("javascript");
      expect(tools).toContain("agent_delegate");
    });

    test("should register custom tools", () => {
      const customTool = {
        getMetadata: () => ({ description: "Custom tool" }),
        customMethod: async () => ({ result: "custom" })
      };

      registry.register("custom", customTool);

      expect(registry.getTool("custom")).toBe(customTool);
      expect(registry.listTools()).toContain("custom");
    });

    test("should initialize all tools during setup", async () => {
      const mockTool = {
        initialize: jest.fn(),
        getMetadata: () => ({ description: "Test tool" })
      };

      const newRegistry = new ToolRegistry();
      newRegistry.register("mock", mockTool);
      await newRegistry.initialize();

      expect(mockTool.initialize).toHaveBeenCalled();
    });
  });

  describe("Tool Schema Management", () => {
    test("should get schema for individual tool", () => {
      const schema = registry.getToolSchema("read_file");
      
      expect(schema).toBeDefined();
      expect(schema.description).toBe("Read the contents of a file");
      expect(schema.methods).toBeDefined();
      expect(schema.methods.run).toBeDefined();
    });

    test("should return null for non-existent tool schema", () => {
      const schema = registry.getToolSchema("nonexistent");
      expect(schema).toBeNull();
    });

    test("should get all schemas", () => {
      const schemas = registry.getAllSchemas();
      
      expect(schemas).toHaveProperty("shell");
      expect(schemas).toHaveProperty("read_file");
      expect(schemas).toHaveProperty("write_file");
      expect(schemas).toHaveProperty("list_files");
      expect(schemas).toHaveProperty("file_search");
    });

    test("should handle tools without schema method", () => {
      const toolWithoutSchema = {
        execute: async () => ({ result: "no schema" })
      };

      registry.register("noschema", toolWithoutSchema);
      
      expect(registry.getToolSchema("noschema")).toBeNull();
      
      const allSchemas = registry.getAllSchemas();
      expect(allSchemas).not.toHaveProperty("noschema");
    });
  });

  describe("Tool Execution", () => {
    test("should execute tool method successfully", async () => {
      // Use shell tool which has simpler output
      const result = await registry.callTool("shell", {
        command: "echo hello"
      });

      // Check that we got a result with expected structure
      expect(result).toHaveProperty("stdout");
      expect(result).toHaveProperty("exitCode");
      expect(result.exitCode).toBe(0);
    });

    test("should throw error for non-existent tool", async () => {
      await expect(
        registry.callTool("nonexistent", {})
      ).rejects.toThrow("Tool 'nonexistent' not found");
    });

    test("should throw error for non-existent method", async () => {
      await expect(
        registry.callTool("shell", { nonexistent: "value" })
      ).rejects.toThrow("Parameter validation failed");
    });

    test("should handle tool execution errors", async () => {
      // Import BaseTool for proper inheritance
      const { BaseTool } = await import("@/tools/base-tool.js");
      
      class ErrorTool extends BaseTool {
        getMetadata() {
          return {
            name: 'error',
            description: 'Test error tool',
            methods: {
              run: {
                description: 'A method that always fails',
                parameters: {}
              }
            }
          };
        }
        
        async run() {
          throw new Error("Tool execution failed");
        }
      }

      const errorTool = new ErrorTool();
      registry.register("error", errorTool);

      await expect(
        registry.callTool("error", {})
      ).rejects.toThrow("Tool execution failed");
    });
  });

  describe("Activity Logging", () => {
    test("should log tool execution start and complete", async () => {
      await registry.callTool("shell", {
        command: "echo hello"
      }, "test-session");

      expect(mockActivityLogger.logEvent).toHaveBeenCalledWith(
        "tool_execution_start",
        "test-session",
        null,
        expect.objectContaining({
          tool: "shell",
          method: "run",
          params: { command: "echo hello" }
        })
      );

      expect(mockActivityLogger.logEvent).toHaveBeenCalledWith(
        "tool_execution_complete",
        "test-session",
        null,
        expect.objectContaining({
          success: true,
          result: expect.objectContaining({ 
            stdout: expect.any(String),
            exitCode: 0
          }),
          error: null,
          duration_ms: expect.any(Number)
        })
      );
    });

    test("should log tool execution errors", async () => {
      // Import BaseTool for proper inheritance
      const { BaseTool } = await import("@/tools/base-tool.js");
      
      class ErrorTool extends BaseTool {
        getMetadata() {
          return {
            name: 'error',
            description: 'Test error tool',
            methods: {
              run: {
                description: 'A method that always fails',
                parameters: {}
              }
            }
          };
        }
        
        async run() {
          throw new Error("Execution failed");
        }
      }

      const errorTool = new ErrorTool();
      registry.register("error", errorTool);

      try {
        await registry.callTool("error", {}, "test-session");
      } catch (error) {
        // Expected to throw
      }

      expect(mockActivityLogger.logEvent).toHaveBeenCalledWith(
        "tool_execution_complete",
        "test-session",
        null,
        expect.objectContaining({
          success: false,
          result: null,
          error: "Execution failed",
          duration_ms: expect.any(Number)
        })
      );
    });

    test("should not log when no session ID provided", async () => {
      await registry.callTool("read_file", { path: "test.txt" });

      expect(mockActivityLogger.logEvent).not.toHaveBeenCalled();
    });
  });

  describe("Agent Delegate Tool", () => {
    test("should call agent delegate tool methods", async () => {
      await registry.initialize();
      registry.register("agent_delegate", new MockAgentDelegateTool());

      const result = await registry.callTool("agent_delegate", {
        description: "Run tests",
        role: "execution"
      }, "test-session", null);

      expect(result).toBe("Mocked run result");
    });
  });

  describe("Snapshot Integration", () => {
    test("should create pre and post snapshots for tool execution", async () => {
      await registry.callToolWithSnapshots(
        "write_file",
        { path: "test.txt", content: "hello" },
        "test-session",
        1
      );

      expect(mockSnapshotManager.createPreToolSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: "write_file",
          operation: "run",
          parameters: { path: "test.txt", content: "hello" },
          executionId: expect.any(String)
        }),
        expect.objectContaining({
          sessionId: "test-session",
          conversationTurns: 2
        }),
        "test-session",
        1
      );

      expect(mockSnapshotManager.createPostToolSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: "write_file",
          operation: "run"
        }),
        expect.objectContaining({
          sessionId: "test-session"
        }),
        expect.objectContaining({
          success: true,
          result: { bytes_written: 5, path: "test.txt" }
        }),
        "test-session",
        1
      );
    });

    test("should create error snapshots when tool fails", async () => {
      // Import BaseTool for proper inheritance
      const { BaseTool } = await import("@/tools/base-tool.js");
      
      class ErrorTool extends BaseTool {
        getMetadata() {
          return {
            name: 'error',
            description: 'Test error tool',
            methods: {
              run: {
                description: 'A method that always fails',
                parameters: {}
              }
            }
          };
        }
        
        async run() {
          throw new Error("Tool failed");
        }
      }

      const errorTool = new ErrorTool();
      registry.register("error", errorTool);

      try {
        await registry.callToolWithSnapshots(
          "error",
          {},
          "test-session",
          1
        );
      } catch (error) {
        // Expected to throw
      }

      expect(mockSnapshotManager.createPostToolSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: "error",
          operation: "run"
        }),
        expect.any(Object),
        expect.objectContaining({
          success: false,
          error: "Tool failed"
        }),
        "test-session",
        1
      );
    });

    test("should handle snapshot errors gracefully", async () => {
      mockSnapshotManager.createPreToolSnapshot.mockRejectedValueOnce(
        new Error("Snapshot failed")
      );

      // Should still execute tool despite snapshot error
      const result = await registry.callToolWithSnapshots(
        "read_file",
        { path: "test.txt" },
        "test-session"
      );

      expect(result).toEqual({
        content: "hello",
        size: 5,
        path: "test.txt"
      });

      expect(mockActivityLogger.logEvent).toHaveBeenCalledWith(
        "snapshot_error",
        "test-session",
        null,
        expect.objectContaining({
          error: "Snapshot failed",
          type: "pre-tool"
        })
      );
    });

    test("should fall back to regular execution when no snapshot manager", async () => {
      const registryWithoutSnapshots = new ToolRegistry({
        activityLogger: mockActivityLogger
      });
      await registryWithoutSnapshots.initialize();

      const result = await registryWithoutSnapshots.callToolWithSnapshots(
        "read_file",
        { path: "test.txt" },
        "test-session"
      );

      expect(result).toEqual({
        content: "hello",
        size: 5,
        path: "test.txt"
      });
    });

    test("should disable snapshots based on configuration", async () => {
      const registryWithDisabledSnapshots = new ToolRegistry({
        snapshotManager: mockSnapshotManager,
        snapshotConfig: {
          enablePreToolSnapshots: false,
          enablePostToolSnapshots: false,
          snapshotOnErrors: false
        }
      });
      await registryWithDisabledSnapshots.initialize();

      await registryWithDisabledSnapshots.callToolWithSnapshots(
        "read_file",
        { path: "test.txt" },
        "test-session"
      );

      expect(mockSnapshotManager.createPreToolSnapshot).not.toHaveBeenCalled();
      expect(mockSnapshotManager.createPostToolSnapshot).not.toHaveBeenCalled();
    });
  });

  describe("Utility Methods", () => {
    test("should generate unique execution IDs", () => {
      const id1 = registry.generateExecutionId();
      const id2 = registry.generateExecutionId();

      expect(id1).toMatch(/^exec-\d+-[a-z0-9]+$/);
      expect(id2).toMatch(/^exec-\d+-[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    test("should gather legacy context", async () => {
      const context = await registry.gatherSnapshotContext("test-session");

      expect(context).toEqual({
        sessionId: "test-session",
        timestamp: expect.any(String),
        conversationTurns: 2,
        recentHistory: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there" }
        ]
      });
    });

    test("should handle context gathering errors gracefully", async () => {
      mockConversationDB.getConversationHistory.mockRejectedValueOnce(
        new Error("DB error")
      );

      const context = await registry.gatherSnapshotContext("test-session");

      expect(context).toEqual({
        sessionId: "test-session",
        timestamp: expect.any(String),
        conversationTurns: 0,
        recentHistory: []
      });
    });

    test("should handle missing conversation DB", async () => {
      // Mock conversation to throw error for this test
      const { Conversation } = await import("@/conversation/conversation.js");
      const originalLoad = Conversation.load;
      Conversation.load = jest.fn().mockRejectedValue(new Error("No conversation DB"));

      const registryWithoutDB = new ToolRegistry();
      const context = await registryWithoutDB.gatherSnapshotContext("test-session");

      expect(context).toEqual({
        sessionId: "test-session",
        timestamp: expect.any(String),
        conversationTurns: 0,
        recentHistory: []
      });

      // Restore original
      Conversation.load = originalLoad;
    });
  });
});
