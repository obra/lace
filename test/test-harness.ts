// ABOUTME: Test harness for Lace agentic coding environment
// ABOUTME: Provides utilities for unit, integration, and end-to-end testing

import { test, describe, beforeEach, afterEach } from "@jest/globals";
import assert from "node:assert";
import { promises as fs } from "fs";
import { join } from "path";
import { Agent } from "../src/agents/agent.js";
import { ToolRegistry } from "../src/tools/tool-registry.js";
import { ConversationDB } from "../src/database/conversation-db.js";
import { LaceUI } from "../src/ui/lace-ui.ts";

export class TestHarness {
  private testDatabases: Set<string>;
  private tempFiles: Set<string>;
  private tempDirectories: Set<string>;
  private laceUIInstances: Set<any>;

  constructor() {
    this.testDatabases = new Set();
    this.tempFiles = new Set();
    this.tempDirectories = new Set();
    this.laceUIInstances = new Set();
  }

  // Create a temporary test database
  async createTestDatabase(suffix = "") {
    const dbPath = `./test-db-${Date.now()}${suffix}.db`;
    this.testDatabases.add(dbPath);
    return dbPath;
  }

  // Create a temporary test file
  async createTempFile(content = "", extension = ".txt") {
    const filePath = `./temp-test-${Date.now()}${extension}`;
    await fs.writeFile(filePath, content);
    this.tempFiles.add(filePath);
    return filePath;
  }

  // Create a temporary test directory  
  async createTempDirectory(suffix = "") {
    const dirPath = join(process.cwd(), `temp-dir-${Date.now()}${suffix}`);
    await fs.mkdir(dirPath, { recursive: true });
    this.tempDirectories.add(dirPath);
    return dirPath;
  }

  // Clean up test resources
  async cleanup() {
    // Shutdown LaceUI instances first
    for (const laceUI of this.laceUIInstances) {
      try {
        await laceUI.stop();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    this.laceUIInstances.clear();

    // Remove test databases
    for (const dbPath of this.testDatabases) {
      try {
        await fs.unlink(dbPath);
      } catch (error) {
        // Ignore if file doesn't exist
      }
    }
    this.testDatabases.clear();

    // Remove temp files
    for (const filePath of this.tempFiles) {
      try {
        await fs.unlink(filePath);
      } catch (error) {
        // Ignore if file doesn't exist
      }
    }
    this.tempFiles.clear();

    // Remove temp directories
    for (const dirPath of this.tempDirectories) {
      try {
        await fs.rm(dirPath, { recursive: true, force: true });
      } catch (error) {
        // Ignore if directory doesn't exist
      }
    }
    this.tempDirectories.clear();
  }

  // Create a test agent without API key requirements
  async createTestAgent(options: any = {}) {
    const tools = new ToolRegistry();
    await tools.initialize();

    // Use in-memory database for faster, more reliable tests
    const db = new ConversationDB(":memory:");
    await db.initialize();

    return new Agent({
      generation: 0,
      tools,
      db,
      modelProvider: null, // Skip for unit tests
      verbose: false,
      role: options.role || "general",
      assignedModel: options.assignedModel || "test-model",
      assignedProvider: options.assignedProvider || "test",
      capabilities: options.capabilities || ["testing"],
      ...options,
    });
  }

  // Create a full LaceUI instance for integration tests
  async createTestLaceUI(options: any = {}) {
    const laceUI = new LaceUI({
      verbose: false,
      memoryPath: ":memory:",
      ...options,
    });

    // For integration tests, don't start the full UI
    // Just initialize the backend components manually
    await laceUI.initialize();

    // Track the LaceUI instance for cleanup
    this.laceUIInstances.add(laceUI);
    return laceUI;
  }

  // Assert that a response contains expected content
  assertResponse(response: any, expectations: any = {}) {
    if (expectations.hasContent !== false) {
      assert.ok(response.content, "Response should have content");
    }

    if (expectations.noError) {
      assert.ok(
        !response.error,
        `Response should not have error: ${response.error}`,
      );
    }

    if (expectations.toolCalls) {
      assert.ok(
        response.toolCalls && response.toolCalls.length > 0,
        "Response should have tool calls",
      );

      if (typeof expectations.toolCalls === "number") {
        assert.strictEqual(
          response.toolCalls.length,
          expectations.toolCalls,
          `Expected ${expectations.toolCalls} tool calls, got ${response.toolCalls.length}`,
        );
      }
    }

    if (expectations.containsText) {
      assert.ok(
        response.content.includes(expectations.containsText),
        `Response should contain "${expectations.containsText}"`,
      );
    }

    if (expectations.toolResults) {
      assert.ok(
        response.toolResults && response.toolResults.length > 0,
        "Response should have tool results",
      );
    }

    return response;
  }

  // Wait for async operations with timeout
  async waitFor(condition, timeout = 5000, interval = 100) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await condition()) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    throw new Error(`Condition not met within ${timeout}ms`);
  }

  // Mock API responses for testing
  createMockModelProvider() {
    return {
      chat: async (messages, options) => ({
        success: true,
        content: `Mock response for: ${messages[messages.length - 1]?.content}`,
        toolCalls: [],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
      initialize: async () => {},
      getProvider: () => ({
        getInfo: () => ({ name: "mock", models: ["mock-model"] }),
      }),
    };
  }
}

// Test utilities
export const utils = {
  async fileExists(path) {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  },

  async readFile(path) {
    return await fs.readFile(path, "utf8");
  },

  async writeFile(path, content) {
    return await fs.writeFile(path, content);
  },

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
};

// Export test framework
export { test, describe, beforeEach, afterEach, assert };
