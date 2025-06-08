// ABOUTME: Test harness for Lace agentic coding environment
// ABOUTME: Provides utilities for unit, integration, and end-to-end testing

import { test, describe, beforeEach, afterEach } from '@jest/globals';
import assert from 'node:assert';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Agent } from '../src/agents/agent.ts';
import { ToolRegistry } from '../src/tools/tool-registry.js';
import { ConversationDB } from '../src/database/conversation-db.js';
import { Lace } from '../src/lace.js';

export class TestHarness {
  constructor() {
    this.testDatabases = new Set();
    this.tempFiles = new Set();
  }

  // Create a temporary test database
  async createTestDatabase(suffix = '') {
    const dbPath = `./test-db-${Date.now()}${suffix}.db`;
    this.testDatabases.add(dbPath);
    return dbPath;
  }

  // Create a temporary test file
  async createTempFile(content = '', extension = '.txt') {
    const filePath = `./temp-test-${Date.now()}${extension}`;
    await fs.writeFile(filePath, content);
    this.tempFiles.add(filePath);
    return filePath;
  }

  // Clean up test resources
  async cleanup() {
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
  }

  // Create a test agent without API key requirements
  async createTestAgent(options = {}) {
    const tools = new ToolRegistry();
    await tools.initialize();

    const dbPath = await this.createTestDatabase();
    const db = new ConversationDB(dbPath);
    await db.initialize();

    return new Agent({
      generation: 0,
      tools,
      db,
      modelProvider: null, // Skip for unit tests
      verbose: false,
      role: options.role || 'test',
      assignedModel: options.assignedModel || 'test-model',
      assignedProvider: options.assignedProvider || 'test',
      capabilities: options.capabilities || ['testing'],
      ...options
    });
  }

  // Create a full Lace instance for integration tests
  async createTestLace(options = {}) {
    const lace = new Lace({
      verbose: false,
      memoryPath: await this.createTestDatabase('-lace'),
      ...options
    });

    await lace.db.initialize();
    await lace.tools.initialize();

    // Skip model provider for offline tests
    if (!options.requireAPI) {
      lace.primaryAgent = await this.createTestAgent({
        role: 'orchestrator',
        assignedModel: 'claude-3-5-sonnet-20241022',
        assignedProvider: 'anthropic',
        capabilities: ['orchestration', 'reasoning', 'planning', 'delegation'],
        tools: lace.tools,
        db: lace.db
      });
    } else {
      await lace.modelProvider.initialize();
      lace.primaryAgent = new Agent({
        generation: 0,
        tools: lace.tools,
        db: lace.db,
        modelProvider: lace.modelProvider,
        verbose: false,
        role: 'orchestrator',
        assignedModel: 'claude-3-5-sonnet-20241022',
        assignedProvider: 'anthropic',
        capabilities: ['orchestration', 'reasoning', 'planning', 'delegation']
      });
    }

    return lace;
  }

  // Assert that a response contains expected content
  assertResponse(response, expectations = {}) {
    if (expectations.hasContent !== false) {
      assert.ok(response.content, 'Response should have content');
    }

    if (expectations.noError) {
      assert.ok(!response.error, `Response should not have error: ${response.error}`);
    }

    if (expectations.toolCalls) {
      assert.ok(response.toolCalls && response.toolCalls.length > 0, 'Response should have tool calls');
      
      if (typeof expectations.toolCalls === 'number') {
        assert.strictEqual(response.toolCalls.length, expectations.toolCalls, 
          `Expected ${expectations.toolCalls} tool calls, got ${response.toolCalls.length}`);
      }
    }

    if (expectations.containsText) {
      assert.ok(response.content.includes(expectations.containsText), 
        `Response should contain "${expectations.containsText}"`);
    }

    if (expectations.toolResults) {
      assert.ok(response.toolResults && response.toolResults.length > 0, 'Response should have tool results');
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
      await new Promise(resolve => setTimeout(resolve, interval));
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
        usage: { input_tokens: 10, output_tokens: 20 }
      }),
      initialize: async () => {},
      getProvider: () => ({
        getInfo: () => ({ name: 'mock', models: ['mock-model'] })
      })
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
    return await fs.readFile(path, 'utf8');
  },

  async writeFile(path, content) {
    return await fs.writeFile(path, content);
  },

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};

// Export test framework
export { test, describe, beforeEach, afterEach, assert };