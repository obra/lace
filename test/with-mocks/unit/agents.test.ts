// ABOUTME: Unit tests for agent system components
// ABOUTME: Tests agent behavior, role assignment, and task delegation

import { test, describe, beforeEach, afterEach } from '@jest/globals';
import { TestHarness } from '@test/test-harness.js';
import assert from 'node:assert';

describe('Agent System', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = new TestHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  describe('Agent Construction', () => {
    test('should create agent with assigned role and model', async () => {
      const agent = await harness.createTestAgent({
        role: 'planning',
        assignedModel: 'claude-3-5-sonnet-20241022',
        assignedProvider: 'anthropic',
        capabilities: ['planning', 'reasoning']
      });

      assert.strictEqual(agent.role, 'planning', 'Should have assigned role');
      assert.strictEqual(agent.assignedModel, 'claude-3-5-sonnet-20241022', 'Should have assigned model');
      assert.strictEqual(agent.assignedProvider, 'anthropic', 'Should have assigned provider');
      assert.ok(agent.capabilities.includes('planning'), 'Should have planning capability');
    });

    test('should build appropriate system prompt for role', async () => {
      const planningAgent = await harness.createTestAgent({ role: 'planning' });
      const executionAgent = await harness.createTestAgent({ role: 'execution' });

      const planningPrompt = planningAgent.buildSystemPrompt();
      const executionPrompt = executionAgent.buildSystemPrompt();

      assert.ok(planningPrompt.includes('planning'), 'Planning agent should have planning guidelines');
      assert.ok(executionPrompt.includes('execution'), 'Execution agent should have execution guidelines');
      assert.notStrictEqual(planningPrompt, executionPrompt, 'Different roles should have different prompts');
    });
  });

  describe('Task Analysis', () => {
    test('should choose planning agent for planning tasks', async () => {
      const agent = await harness.createTestAgent({ role: 'orchestrator' });
      
      const config = agent.chooseAgentForTask('plan authentication system');
      
      assert.strictEqual(config.role, 'planning', 'Should choose planning agent');
      assert.ok(config.capabilities.includes('planning'), 'Should have planning capabilities');
    });

    test('should choose execution agent for simple tasks', async () => {
      const agent = await harness.createTestAgent({ role: 'orchestrator' });
      
      const config = agent.chooseAgentForTask('list files');
      
      assert.strictEqual(config.role, 'execution', 'Should choose execution agent');
      assert.strictEqual(config.assignedModel, 'claude-3-5-haiku-20241022', 'Should use fast model');
    });

    test('should choose reasoning agent for complex analysis', async () => {
      const agent = await harness.createTestAgent({ role: 'orchestrator' });
      
      const config = agent.chooseAgentForTask('debug this error');
      
      assert.strictEqual(config.role, 'reasoning', 'Should choose reasoning agent');
      assert.ok(config.capabilities.includes('reasoning'), 'Should have reasoning capabilities');
    });
  });

  describe('Tool Integration', () => {
    test('should build tools for LLM format', async () => {
      const agent = await harness.createTestAgent();
      
      const tools = agent.buildToolsForLLM();
      
      assert.ok(Array.isArray(tools), 'Should return array of tools');
      assert.ok(tools.length > 0, 'Should have tools available');
      
      const fileTool = tools.find(t => t.name.startsWith('file_'));
      assert.ok(fileTool, 'Should include file tools');
      assert.ok(fileTool.input_schema, 'Should have input schema');
      assert.ok(fileTool.input_schema.properties, 'Should have properties');
    });

    test('should convert tool parameters correctly', async () => {
      const agent = await harness.createTestAgent();
      
      const parameters = { 
        path: { type: 'string', required: true, description: 'File path' },
        content: { type: 'string', required: true, description: 'File content' }
      };
      
      const properties = agent.convertParametersToProperties(parameters);
      const required = agent.extractRequiredParameters(parameters);
      
      assert.ok(properties.path, 'Should convert path parameter');
      assert.strictEqual(properties.path.type, 'string', 'Should preserve type');
      assert.ok(required.includes('path'), 'Should extract required parameters');
      assert.ok(required.includes('content'), 'Should extract all required parameters');
    });
  });

  describe('Subagent Spawning', () => {
    test('should spawn subagent with correct configuration', async () => {
      const orchestrator = await harness.createTestAgent({ role: 'orchestrator' });
      
      const subagent = await orchestrator.spawnSubagent({
        role: 'execution',
        assignedModel: 'claude-3-5-haiku-20241022',
        task: 'Test task'
      });
      
      assert.strictEqual(subagent.role, 'execution', 'Subagent should have assigned role');
      assert.strictEqual(subagent.assignedModel, 'claude-3-5-haiku-20241022', 'Subagent should have assigned model');
      assert.strictEqual(subagent.task, 'Test task', 'Subagent should have assigned task');
      assert.ok(subagent.generation > orchestrator.generation, 'Subagent should have higher generation');
    });
  });

  describe('Context Management', () => {
    test('should track context size', async () => {
      const agent = await harness.createTestAgent();
      
      assert.strictEqual(agent.contextSize, 0, 'Should start with zero context size');
      assert.ok(agent.maxContextSize > 0, 'Should have max context size limit');
      assert.ok(agent.handoffThreshold > 0 && agent.handoffThreshold < 1, 'Should have valid handoff threshold');
    });

    test('should detect when handoff is needed', async () => {
      const agent = await harness.createTestAgent();
      
      // Simulate large context
      agent.contextSize = agent.maxContextSize * 0.9;
      
      assert.ok(agent.shouldHandoff(), 'Should detect when handoff is needed');
    });
  });

  describe('Error Handling', () => {
    test('should handle tool execution errors gracefully', async () => {
      const agent = await harness.createTestAgent();
      
      // Test with invalid tool call
      const toolCall = { name: 'nonexistent_tool', input: {} };
      
      try {
        await agent.executeTool(toolCall, 'test-session');
        assert.fail('Should throw error for nonexistent tool');
      } catch (error) {
        assert.ok(error.message.includes('not found'), 'Should provide meaningful error message');
      }
    });
  });
});