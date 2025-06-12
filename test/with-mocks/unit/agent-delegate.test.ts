// ABOUTME: Tests for the AgentDelegateTool focused on delegation functionality
// ABOUTME: Validates task delegation, agent spawning, and error handling

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { AgentDelegateTool } from '@/tools/agent-delegate.js';

describe('AgentDelegateTool', () => {
  let tool: AgentDelegateTool;
  let mockAgent: any;
  let mockContext: any;

  beforeEach(() => {
    tool = new AgentDelegateTool();

    mockAgent = {
      delegateTask: jest.fn() as jest.MockedFunction<any>,
      spawnSubagent: jest.fn() as jest.MockedFunction<any>,
    };

    mockContext = {
      context: {
        agent: mockAgent,
        sessionId: 'test-session-123'
      },
      signal: { aborted: false },
    };
  });

  describe('schema', () => {
    test('should have correct tool schema', () => {
      const schema = tool.getSchema();
      
      expect(schema.name).toBe('agent_delegate');
      expect(schema.description).toContain('Delegate tasks to specialized sub-agents');
      expect(schema.methods).toHaveProperty('delegate_task');
      expect(schema.methods).toHaveProperty('spawn_agent');
    });

    test('should have required parameters for delegate_task', () => {
      const schema = tool.getSchema();
      const method = schema.methods.delegate_task;
      
      expect(method.parameters.description.required).toBe(true);
      expect(method.parameters.role.required).toBe(false);
      expect(method.parameters.model.required).toBe(false);
    });
  });

  describe('delegate_task', () => {
    test('should successfully delegate a task', async () => {
      const mockResult = { content: 'Task completed successfully' };
      mockAgent.delegateTask.mockResolvedValue(mockResult);

      const result = await tool.delegate_task({
        description: 'Test task description'
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.result).toBe('Task completed successfully');
      expect(result.metadata?.taskDescription).toBe('Test task description');
      expect(mockAgent.delegateTask).toHaveBeenCalledWith(
        'test-session-123',
        'Test task description',
        expect.objectContaining({
          role: 'general',
          assignedModel: 'claude-3-5-sonnet-20241022',
          assignedProvider: 'anthropic'
        })
      );
    });

    test('should handle custom role and model parameters', async () => {
      const mockResult = { content: 'Specialist task completed' };
      mockAgent.delegateTask.mockResolvedValue(mockResult);

      const result = await tool.delegate_task({
        description: 'Complex analysis task',
        role: 'reasoning',
        model: 'claude-3-opus-20240229',
        provider: 'anthropic',
        capabilities: ['analysis', 'reasoning']
      }, mockContext);

      expect(result.success).toBe(true);
      expect(mockAgent.delegateTask).toHaveBeenCalledWith(
        'test-session-123',
        'Complex analysis task',
        expect.objectContaining({
          role: 'reasoning',
          assignedModel: 'claude-3-opus-20240229',
          assignedProvider: 'anthropic',
          capabilities: ['analysis', 'reasoning']
        })
      );
    });

    test('should return error when description is missing', async () => {
      const result = await tool.delegate_task({
        description: ''
      }, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Task description is required');
    });

    test('should return error when agent context is missing', async () => {
      const contextWithoutAgent = {
        ...mockContext,
        context: { sessionId: 'test-session' }
      };

      const result = await tool.delegate_task({
        description: 'Test task'
      }, contextWithoutAgent);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Agent context is required for task delegation');
    });

    test('should handle task timeout', async () => {
      mockAgent.delegateTask.mockImplementation(() => 
        new Promise((resolve) => setTimeout(resolve, 200))
      );

      const result = await tool.delegate_task({
        description: 'Slow task',
        timeout: 100
      }, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });

    test('should handle cancellation', async () => {
      const cancelledContext = {
        ...mockContext,
        signal: { aborted: true }
      };

      const result = await tool.delegate_task({
        description: 'Test task'
      }, cancelledContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Task delegation was cancelled');
    });

  });

  describe('spawn_agent', () => {
    test('should successfully spawn an agent and execute task', async () => {
      const mockSubagent = {
        generation: 'agent-123',
        generateResponse: jest.fn()
      } as any;
      mockSubagent.generateResponse.mockResolvedValue({ content: 'Agent task result' });
      mockAgent.spawnSubagent.mockResolvedValue(mockSubagent);

      const result = await tool.spawn_agent({
        role: 'researcher',
        task: 'Research topic X'
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.agentId).toBe('agent-123');
      expect(result.result).toBe('Agent task result');
      expect(result.metadata?.role).toBe('researcher');
      expect(mockAgent.spawnSubagent).toHaveBeenCalledWith({
        role: 'researcher',
        assignedModel: 'claude-3-5-sonnet-20241022',
        assignedProvider: 'anthropic',
        capabilities: ['reasoning', 'tool_calling'],
        task: 'Research topic X'
      });
    });

    test('should return error when role or task is missing', async () => {
      const result = await tool.spawn_agent({
        role: '',
        task: 'Some task'
      }, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Role and task are required parameters');
    });

    test('should return error when agent context is missing', async () => {
      const contextWithoutAgent = {
        ...mockContext,
        context: { sessionId: 'test-session' }
      };

      const result = await tool.spawn_agent({
        role: 'researcher',
        task: 'Research task'
      }, contextWithoutAgent);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Agent context is required for spawning sub-agents');
    });

    test('should handle spawning errors', async () => {
      mockAgent.spawnSubagent.mockRejectedValue(new Error('Spawn failed'));

      const result = await tool.spawn_agent({
        role: 'researcher',
        task: 'Research task'
      }, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Spawn failed');
    });

    test('should truncate long tasks in metadata', async () => {
      const mockSubagent = {
        generation: 'agent-123',
        generateResponse: jest.fn()
      } as any;
      mockSubagent.generateResponse.mockResolvedValue({ content: 'Result' });
      mockAgent.spawnSubagent.mockResolvedValue(mockSubagent);

      const longTask = 'a'.repeat(150);
      const result = await tool.spawn_agent({
        role: 'researcher',
        task: longTask
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.metadata?.task).toHaveLength(103); // 100 chars + "..."
      expect(result.metadata?.task).toMatch(/\.\.\.$/); // Ends with ...
    });

  });
});
