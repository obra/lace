// ABOUTME: Test suite for task-based agent spawning functionality
// ABOUTME: Verifies that tasks assigned to "new:persona:provider/model" trigger agent creation

import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { TaskManager, type AgentCreationCallback } from '~/tasks/task-manager';
import { DatabasePersistence } from '~/persistence/database';
import { asThreadId, asNewAgentSpec, asAssigneeId, createNewAgentSpec } from '~/threads/types';
import { TaskContext, CreateTaskRequest } from '~/tasks/types';

describe('Agent Spawning', () => {
  let taskManager: TaskManager;
  let mockPersistence: DatabasePersistence;
  let mockAgentCreator: MockedFunction<AgentCreationCallback>;

  const sessionId = asThreadId('lace_20250726_test01');
  const context: TaskContext = { actor: 'lace_20250726_test01.1' };

  beforeEach(() => {
    // Mock persistence
    mockPersistence = {
      saveTask: vi.fn(),
      loadTask: vi.fn(),
      loadTasksByThread: vi.fn().mockReturnValue([]),
      loadTasksByAssignee: vi.fn().mockReturnValue([]),
      updateTask: vi.fn(),
      addTaskNote: vi.fn(),
    } as unknown as DatabasePersistence;

    // Mock agent creator
    mockAgentCreator = vi.fn().mockImplementation((_persona, _provider, _model, _task) => {
      return Promise.resolve(asThreadId(`${sessionId}.${Date.now()}`));
    });

    taskManager = new TaskManager(sessionId, mockPersistence, mockAgentCreator);
  });

  describe('Task Creation with Agent Spawning', () => {
    it('should spawn agent when task assigned to "new:persona:provider/model"', async () => {
      const taskRequest: CreateTaskRequest = {
        title: 'Test Task',
        prompt: 'Please complete this test task',
        assignedTo: createNewAgentSpec('lace', 'anthropic', 'claude-3-sonnet'),
        priority: 'medium',
      };

      const task = await taskManager.createTask(taskRequest, context);

      // Verify agent creator was called with correct parameters
      expect(mockAgentCreator).toHaveBeenCalledWith(
        'lace',
        'anthropic',
        'claude-3-sonnet',
        expect.objectContaining({
          title: 'Test Task',
          prompt: 'Please complete this test task',
        })
      );

      // Verify task assignment was updated to actual thread ID
      expect(task.assignedTo).not.toBe('new:lace:anthropic/claude-3-sonnet');
      expect(task.assignedTo).toMatch(/^lace_20250726_test01\.\d+$/);

      // Verify task status was updated to in_progress
      expect(task.status).toBe('in_progress');
    });

    it('should handle multiple provider/model formats', async () => {
      const testCases = [
        {
          assignedTo: createNewAgentSpec('lace', 'openai', 'gpt-4'),
          expectedProvider: 'openai',
          expectedModel: 'gpt-4',
        },
        {
          assignedTo: createNewAgentSpec('lace', 'anthropic', 'claude-3-haiku'),
          expectedProvider: 'anthropic',
          expectedModel: 'claude-3-haiku',
        },
        {
          assignedTo: createNewAgentSpec('lace', 'lmstudio', 'local-model'),
          expectedProvider: 'lmstudio',
          expectedModel: 'local-model',
        },
      ];

      for (const testCase of testCases) {
        mockAgentCreator.mockClear();

        const taskRequest: CreateTaskRequest = {
          title: `Test ${testCase.expectedProvider}`,
          prompt: 'Test prompt',
          assignedTo: testCase.assignedTo,
        };

        await taskManager.createTask(taskRequest, context);

        expect(mockAgentCreator).toHaveBeenCalledWith(
          'lace',
          testCase.expectedProvider,
          testCase.expectedModel,
          expect.objectContaining({
            title: expect.any(String) as unknown,
            prompt: expect.any(String) as unknown,
          })
        );
      }
    });

    it('should not spawn agent for invalid agent spec format', async () => {
      const taskRequest: CreateTaskRequest = {
        title: 'Invalid Test',
        prompt: 'This should not spawn an agent',
        assignedTo: asAssigneeId('new:invalid-format'), // Missing model - treated as regular assignment
      };

      const task = await taskManager.createTask(taskRequest, context);

      // Verify agent creator was not called
      expect(mockAgentCreator).not.toHaveBeenCalled();

      // Verify task assignment unchanged (treated as regular thread ID)
      expect(task.assignedTo).toBe('new:invalid-format');
      expect(task.status).toBe('pending');
    });

    it('should throw error when agent creation callback is not provided', async () => {
      // Create task manager without agent creation callback
      const taskManagerWithoutCallback = new TaskManager(sessionId, mockPersistence);

      const taskRequest: CreateTaskRequest = {
        title: 'Test Task',
        prompt: 'This should fail',
        assignedTo: createNewAgentSpec('lace', 'anthropic', 'claude-3-sonnet'),
      };

      await expect(taskManagerWithoutCallback.createTask(taskRequest, context)).rejects.toThrow(
        'Agent creation callback not provided - cannot spawn agents'
      );
    });

    it('should handle agent creation failures gracefully', async () => {
      // Mock agent creator to fail
      mockAgentCreator.mockRejectedValue(new Error('Agent creation failed'));

      const taskRequest: CreateTaskRequest = {
        title: 'Test Task',
        prompt: 'This will fail',
        assignedTo: createNewAgentSpec('lace', 'anthropic', 'claude-3-sonnet'),
      };

      await expect(taskManager.createTask(taskRequest, context)).rejects.toThrow(
        'Failed to spawn agent for task'
      );
    });

    it('should not spawn agent for regular thread ID assignments', async () => {
      const taskRequest: CreateTaskRequest = {
        title: 'Regular Task',
        prompt: 'Assigned to existing agent',
        assignedTo: asAssigneeId('lace_20250726_test01.2'), // Regular thread ID
      };

      const task = await taskManager.createTask(taskRequest, context);

      // Verify agent creator was not called
      expect(mockAgentCreator).not.toHaveBeenCalled();

      // Verify task assignment unchanged
      expect(task.assignedTo).toBe('lace_20250726_test01.2');
      expect(task.status).toBe('pending');
    });

    it('should emit agent:spawned event on successful agent creation', async () => {
      const eventListener = vi.fn();
      taskManager.on('agent:spawned', eventListener);

      const taskRequest: CreateTaskRequest = {
        title: 'Event Test',
        prompt: 'Testing events',
        assignedTo: createNewAgentSpec('lace', 'anthropic', 'claude-3-sonnet'),
      };

      await taskManager.createTask(taskRequest, context);

      expect(eventListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent:spawned',
          provider: 'anthropic',
          model: 'claude-3-sonnet',
          agentThreadId: expect.stringMatching(/^lace_20250726_test01\.\d+$/) as string,
        })
      );
    });
  });

  describe('NewAgentSpec Validation', () => {
    it('should validate NewAgentSpec format correctly', () => {
      const validSpecs = [
        'new:lace:anthropic/claude-3-sonnet',
        'new:lace:openai/gpt-4',
        'new:lace:lmstudio/local-model',
        'new:lace:provider/model-with-dashes',
      ];

      validSpecs.forEach((spec) => {
        const parts = spec.split(':');
        const persona = parts[1];
        const [provider, model] = parts[2].split('/');
        expect(() => createNewAgentSpec(persona, provider, model)).not.toThrow();
      });
    });

    it('should treat invalid NewAgentSpec formats as regular assignments', async () => {
      const invalidSpecs = [
        'new:',
        'new:provider',
        'new:/model',
        'new:provider/',
        'new:anthropic/claude-3-sonnet', // Old format - now invalid
        'new:openai/gpt-4', // Old format - now invalid
        'invalid:provider/model',
        'provider/model',
      ];

      for (const spec of invalidSpecs) {
        mockAgentCreator.mockClear();

        const taskRequest: CreateTaskRequest = {
          title: 'Invalid Test',
          prompt: 'Should not spawn agent',
          assignedTo: spec,
        };

        const task = await taskManager.createTask(taskRequest, context);

        // Verify agent creator was not called
        expect(mockAgentCreator).not.toHaveBeenCalled();

        // Verify task assignment unchanged (treated as regular thread ID)
        expect(task.assignedTo).toBe(spec);
        expect(task.status).toBe('pending');
      }
    });
  });
});
