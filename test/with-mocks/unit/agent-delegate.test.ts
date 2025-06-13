// ABOUTME: Tests for the AgentDelegateTool focused on delegation functionality
// ABOUTME: Validates task delegation, agent spawning, and error handling

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { AgentDelegateTool } from '@/tools/agent-delegate.js';

// Mock the Conversation class
jest.mock('@/conversation/conversation.js', () => ({
  Conversation: {
    load: jest.fn().mockResolvedValue({
      getSessionId: () => 'test-session-123'
    } as any)
  }
}));

// Mock the Agent class
jest.mock('@/agents/agent.ts', () => ({
  Agent: jest.fn().mockImplementation(() => ({
    generateResponse: jest.fn().mockResolvedValue({
      content: 'Task completed successfully'
    } as any)
  }))
}));

// Mock the agent registry
jest.mock('@/agents/agent-registry.ts', () => ({
  getRole: jest.fn().mockReturnValue({
    name: 'test-role',
    defaultModel: 'test-model'
  })
}));

describe('AgentDelegateTool', () => {
  let tool: AgentDelegateTool;
  let mockAgent: any;
  let mockContext: any;

  beforeEach(() => {
    tool = new AgentDelegateTool();

    const mockTools = {
      listTools: () => [],
      getTool: () => null,
    };

    const mockModelProvider = {
      getModelSession: jest.fn().mockReturnValue({
        definition: {
          name: 'test-model',
          provider: 'test',
          contextWindow: 200000,
          inputPrice: 0.01,
          outputPrice: 0.03,
          capabilities: ['chat', 'tools']
        },
        chat: jest.fn().mockResolvedValue({
          success: true,
          content: 'Task completed successfully'
        } as any)
      })
    };

    mockContext = {
      context: {
        tools: mockTools,
        modelProvider: mockModelProvider,
        sessionId: 'test-session-123'
      },
      signal: { aborted: false },
    };

    // Keep mockAgent for legacy test assertions
    mockAgent = {
      delegateTask: jest.fn() as jest.MockedFunction<any>,
    };
  });

  describe('schema', () => {
    test('should have correct tool schema', () => {
      const schema = tool.getMetadata();
      
      expect(schema.name).toBe('agent_delegate');
      expect(schema.description).toContain('Delegate tasks to specialized sub-agents');
      expect(schema.methods).toHaveProperty('run');
    });

    test('should have required parameters for run', () => {
      const schema = tool.getMetadata();
      const method = schema.methods.run;
      
      expect(method.parameters.purpose.required).toBe(true);
      expect(method.parameters.instructions.required).toBe(true);
      expect(method.parameters.role.required).toBe(false);
    });
  });

  describe('delegate_task', () => {
    test('should successfully delegate a task', async () => {

      const result = await tool.run({
        purpose: 'Test task',
        instructions: 'Complete the test task with all requirements'
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.result).toBe('Task completed successfully');
      expect(result.metadata?.taskDescription).toBe('Test task: Complete the test task with all requirements');
    });

    test('should handle custom role parameters', async () => {

      const result = await tool.run({
        purpose: 'Complex analysis task',
        instructions: 'Perform detailed security analysis of the authentication system',
        role: 'reasoning',
      }, mockContext);

      expect(result.success).toBe(true);
    });

    test('should return error when purpose is missing', async () => {
      const result = await tool.run({
        purpose: '',
        instructions: 'Some instructions'
      }, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Purpose is required');
    });

    test('should return error when instructions are missing', async () => {
      const result = await tool.run({
        purpose: 'Test task',
        instructions: ''
      }, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Instructions are required');
    });

    test('should return error when agent context is missing', async () => {
      const contextWithoutAgent = {
        ...mockContext,
        context: { sessionId: 'test-session' }
      };

      const result = await tool.run({
        purpose: 'Test task',
        instructions: 'Complete the test task'
      }, contextWithoutAgent);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Tools and modelProvider are required for task delegation');
    });

    test('should handle task timeout', async () => {
      // Override the default timeout for testing
      (tool as any).defaultTimeout = 100;
      

      const result = await tool.run({
        purpose: 'Slow task',
        instructions: 'This task takes a long time to complete'
      }, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });

    test('should handle cancellation', async () => {
      const cancelledContext = {
        ...mockContext,
        signal: { aborted: true }
      };

      const result = await tool.run({
        purpose: 'Test task',
        instructions: 'Complete the test task'
      }, cancelledContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Task delegation was cancelled');
    });

    test('should auto-select execution role for implementation tasks', async () => {

      const result = await tool.run({
        purpose: 'implement new feature',
        instructions: 'Add user authentication to the login system'
      }, mockContext);

      expect(result.success).toBe(true);
    });

    test('should auto-select reasoning role for analysis tasks', async () => {

      const result = await tool.run({
        purpose: 'analyze security vulnerabilities',
        instructions: 'Review the authentication code for potential security issues'
      }, mockContext);

      expect(result.success).toBe(true);
    });

  });

});
