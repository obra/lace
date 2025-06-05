// ABOUTME: Integration tests for core Lace functionality without API dependencies
// ABOUTME: Tests system integration, tool coordination, and agent workflows

import { test, describe, beforeEach, afterEach } from './test-harness.js';
import { TestHarness, assert } from './test-harness.js';

describe('Lace Integration Tests', () => {
  let harness;

  beforeEach(async () => {
    harness = new TestHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  describe('System Initialization', () => {
    test('should initialize all core systems', async () => {
      const lace = await harness.createTestLace();
      
      assert.ok(lace.db, 'Should have database');
      assert.ok(lace.tools, 'Should have tool registry');
      assert.ok(lace.primaryAgent, 'Should have primary agent');
      assert.strictEqual(lace.primaryAgent.role, 'orchestrator', 'Primary agent should be orchestrator');
    });

    test('should have all required tools available', async () => {
      const lace = await harness.createTestLace();
      
      const tools = lace.tools.listTools();
      const requiredTools = ['shell', 'file', 'javascript', 'search'];
      
      for (const tool of requiredTools) {
        assert.ok(tools.includes(tool), `Should have ${tool} tool`);
      }
    });

    test('should prepare tools for LLM format', async () => {
      const lace = await harness.createTestLace();
      
      const toolsForLLM = lace.primaryAgent.buildToolsForLLM();
      
      assert.ok(Array.isArray(toolsForLLM), 'Should return array of tools');
      assert.ok(toolsForLLM.length > 0, 'Should have tools available');
      
      // Check tool format
      const sampleTool = toolsForLLM[0];
      assert.ok(sampleTool.name, 'Tool should have name');
      assert.ok(sampleTool.description, 'Tool should have description');
      assert.ok(sampleTool.input_schema, 'Tool should have input schema');
    });
  });

  describe('Agent Coordination', () => {
    test('should spawn subagents with correct configuration', async () => {
      const lace = await harness.createTestLace();
      
      const subagent = await lace.primaryAgent.spawnSubagent({
        role: 'execution',
        assignedModel: 'claude-3-5-haiku-20241022',
        assignedProvider: 'anthropic',
        task: 'Test task'
      });
      
      assert.strictEqual(subagent.role, 'execution', 'Subagent should have correct role');
      assert.strictEqual(subagent.assignedModel, 'claude-3-5-haiku-20241022', 'Subagent should have correct model');
      assert.strictEqual(subagent.task, 'Test task', 'Subagent should have assigned task');
    });

    test('should analyze tasks and choose appropriate agents', async () => {
      const lace = await harness.createTestLace();
      
      const testCases = [
        { task: 'plan authentication system', expectedRole: 'planning' },
        { task: 'list files in directory', expectedRole: 'execution' },
        { task: 'debug this error message', expectedRole: 'reasoning' },
        { task: 'run npm install', expectedRole: 'execution' }
      ];
      
      for (const testCase of testCases) {
        const config = lace.primaryAgent.chooseAgentForTask(testCase.task);
        assert.strictEqual(config.role, testCase.expectedRole, 
          `Task "${testCase.task}" should choose ${testCase.expectedRole} agent`);
      }
    });
  });

  describe('Tool Integration', () => {
    test('should execute file operations through agent', async () => {
      const lace = await harness.createTestLace();
      
      // Create a temp file to test with
      const tempFile = await harness.createTempFile('test content');
      
      // Test tool execution through agent
      const result = await lace.primaryAgent.executeTool({
        name: 'file_read',
        input: { path: tempFile }
      });
      
      assert.ok(result.success, 'File read should succeed');
      assert.strictEqual(result.content, 'test content', 'Should read correct content');
    });

    test('should execute JavaScript calculations', async () => {
      const lace = await harness.createTestLace();
      
      const result = await lace.primaryAgent.executeTool({
        name: 'javascript_calculate',
        input: { expression: '6 * 12' }
      });
      
      assert.ok(result.success, 'Calculation should succeed');
      assert.strictEqual(result.result, 72, 'Should calculate correctly');
    });

    test('should handle shell commands', async () => {
      const lace = await harness.createTestLace();
      
      const result = await lace.primaryAgent.executeTool({
        name: 'shell_execute',
        input: { command: 'echo "test"' }
      });
      
      assert.ok(result.success, 'Shell command should succeed');
      assert.strictEqual(result.stdout.trim(), 'test', 'Should return command output');
    });
  });

  describe('Conversation Persistence', () => {
    test('should save and retrieve conversation history', async () => {
      const lace = await harness.createTestLace();
      
      const sessionId = 'integration-test-session';
      
      // Save a message
      await lace.db.saveMessage(sessionId, 0, 'user', 'Test message');
      await lace.db.saveMessage(sessionId, 0, 'assistant', 'Test response');
      
      // Retrieve history
      const history = await lace.primaryAgent.getConversationHistory(sessionId, 10);
      
      assert.strictEqual(history.length, 2, 'Should have saved messages');
      assert.strictEqual(history[0].role, 'assistant', 'Should return most recent first');
      assert.strictEqual(history[1].role, 'user', 'Should include user message');
    });

    test('should maintain session isolation', async () => {
      const lace = await harness.createTestLace();
      
      await lace.db.saveMessage('session-1', 0, 'user', 'Message 1');
      await lace.db.saveMessage('session-2', 0, 'user', 'Message 2');
      
      const session1History = await lace.db.getConversationHistory('session-1');
      const session2History = await lace.db.getConversationHistory('session-2');
      
      assert.strictEqual(session1History.length, 1, 'Session 1 should have 1 message');
      assert.strictEqual(session2History.length, 1, 'Session 2 should have 1 message');
      assert.notStrictEqual(session1History[0].content, session2History[0].content, 'Sessions should be isolated');
    });
  });

  describe('Error Handling', () => {
    test('should handle tool execution errors gracefully', async () => {
      const lace = await harness.createTestLace();
      
      try {
        await lace.primaryAgent.executeTool({
          name: 'nonexistent_tool',
          input: {}
        });
        assert.fail('Should throw error for nonexistent tool');
      } catch (error) {
        assert.ok(error.message.includes('not found'), 'Should provide meaningful error');
      }
    });

    test('should handle file operation errors', async () => {
      const lace = await harness.createTestLace();
      
      const result = await lace.primaryAgent.executeTool({
        name: 'file_read',
        input: { path: '/nonexistent/file.txt' }
      });
      
      assert.ok(!result.success, 'Should fail for nonexistent file');
      assert.ok(result.error, 'Should provide error message');
    });
  });

  describe('Context Management', () => {
    test('should track context size and handoff conditions', async () => {
      const lace = await harness.createTestLace();
      
      const agent = lace.primaryAgent;
      
      assert.strictEqual(agent.contextSize, 0, 'Should start with zero context');
      assert.ok(agent.maxContextSize > 0, 'Should have context limit');
      assert.ok(!agent.shouldHandoff(), 'Should not need handoff initially');
      
      // Simulate large context
      agent.contextSize = agent.maxContextSize * 0.9;
      assert.ok(agent.shouldHandoff(), 'Should detect handoff need');
    });
  });
});