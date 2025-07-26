// ABOUTME: Test suite for task-based delegate tool implementation
// ABOUTME: Tests event-driven task delegation that supports parallel execution

import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { DelegateTool } from '~/tools/implementations/delegate';
import { TaskManager } from '~/tasks/task-manager';
import { ToolContext } from '~/tools/types';
import { asThreadId } from '~/threads/types';
import { Task } from '~/tasks/types';

describe('Task-Based DelegateTool', () => {
  let delegateTool: DelegateTool;
  let mockTaskManager: TaskManager;
  let mockContext: ToolContext;

  // Helper to create complete mock tasks
  const createMockTask = (overrides: Partial<Task> = {}): Task => ({
    id: 'task_20250726_abc123',
    title: 'Test Task',
    description: 'Test description',
    prompt: 'Test prompt',
    status: 'in_progress',
    priority: 'medium',
    assignedTo: asThreadId('lace_20250726_test01.2'),
    createdBy: asThreadId('lace_20250726_test01.1'),
    threadId: asThreadId('lace_20250726_test01'),
    createdAt: new Date(),
    updatedAt: new Date(),
    notes: [],
    ...overrides,
  });

  beforeEach(() => {
    // Mock TaskManager
    mockTaskManager = {
      createTask: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as TaskManager;

    // Mock ToolContext
    mockContext = {
      threadId: asThreadId('lace_20250726_test01.1'),
    };

    delegateTool = new DelegateTool();
    // Inject TaskManager using the factory pattern like Session does
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (delegateTool as any).getTaskManager = () => mockTaskManager;
  });

  describe('Task Creation and Event-Driven Completion', () => {
    it('should create task and wait for completion via events', async () => {
      // Arrange
      const taskId = 'task_20250726_abc123';
      const mockTask = createMockTask({
        id: taskId,
        notes: [
          {
            id: 'note_1',
            author: asThreadId('lace_20250726_test01.2'),
            content: 'Task completed successfully',
            timestamp: new Date(),
          },
        ],
      });

      // Mock task creation
      (
        mockTaskManager.createTask as MockedFunction<typeof mockTaskManager.createTask>
      ).mockResolvedValue(mockTask);

      // Mock event listener that immediately resolves with completed task
      (mockTaskManager.on as MockedFunction<typeof mockTaskManager.on>).mockImplementation(
        (eventName: string | symbol, handler: (...args: unknown[]) => void) => {
          if (eventName === 'task:updated') {
            // Simulate task completion event
            setTimeout(() => {
              handler({
                task: { ...mockTask, status: 'completed' },
                creatorThreadId: mockContext.threadId,
              });
            }, 0);
          }
          return mockTaskManager; // Return this for method chaining
        }
      );

      // Act
      const result = await delegateTool.execute(
        {
          title: 'Test Task',
          prompt: 'Complete this test task',
          expected_response: 'Success message',
          model: 'anthropic:claude-3-haiku',
        },
        mockContext
      );

      // Assert
      expect(result).toBeDefined();
      expect(result.isError).toBe(false);
      expect(result.content).toEqual([{ type: 'text', text: 'Task completed successfully' }]);
      expect(mockTaskManager.createTask).toHaveBeenCalledWith(
        {
          title: 'Test Task',
          prompt: expect.stringContaining('Complete this test task') as string,
          assignedTo: 'new:anthropic/claude-3-haiku',
          priority: 'high',
        },
        {
          actor: mockContext.threadId,
        }
      );
    });

    it('should handle parallel delegations without conflicts', async () => {
      // This test verifies that multiple delegate tools can run simultaneously
      // without shared state issues

      // Create three separate delegate tool instances
      const tool1 = new DelegateTool();
      const tool2 = new DelegateTool();
      const tool3 = new DelegateTool();

      // Mock different task responses for each
      const mockTasks = [
        createMockTask({
          id: 'task_1',
          title: 'Task 1',
          status: 'completed',
          notes: [
            {
              id: 'note_1',
              author: asThreadId('agent1'),
              content: 'Result 1',
              timestamp: new Date(),
            },
          ],
        }),
        createMockTask({
          id: 'task_2',
          title: 'Task 2',
          status: 'completed',
          notes: [
            {
              id: 'note_2',
              author: asThreadId('agent2'),
              content: 'Result 2',
              timestamp: new Date(),
            },
          ],
        }),
        createMockTask({
          id: 'task_3',
          title: 'Task 3',
          status: 'completed',
          notes: [
            {
              id: 'note_3',
              author: asThreadId('agent3'),
              content: 'Result 3',
              timestamp: new Date(),
            },
          ],
        }),
      ];

      // Set up mock responses
      (
        mockTaskManager.createTask as MockedFunction<typeof mockTaskManager.createTask>
      ).mockImplementation((request) => {
        const taskIndex = request.title.includes('Task 1')
          ? 0
          : request.title.includes('Task 2')
            ? 1
            : 2;
        return Promise.resolve(mockTasks[taskIndex]);
      });

      (mockTaskManager.on as MockedFunction<typeof mockTaskManager.on>).mockImplementation(
        (eventName: string | symbol, handler: (...args: unknown[]) => void) => {
          if (eventName === 'task:updated') {
            // Simulate all three tasks completing
            setTimeout(() => {
              mockTasks.forEach((task) => {
                handler({
                  task: { ...task, status: 'completed' },
                  creatorThreadId: mockContext.threadId,
                });
              });
            }, 0);
          }
          return mockTaskManager; // Return this for method chaining
        }
      );

      // Act - Execute all three delegations in parallel
      const [result1, result2, result3] = await Promise.all([
        tool1.execute(
          {
            title: 'Task 1',
            prompt: 'First task',
            expected_response: 'Result 1',
            model: 'anthropic:claude-3-haiku',
          },
          mockContext
        ),
        tool2.execute(
          {
            title: 'Task 2',
            prompt: 'Second task',
            expected_response: 'Result 2',
            model: 'anthropic:claude-3-haiku',
          },
          mockContext
        ),
        tool3.execute(
          {
            title: 'Task 3',
            prompt: 'Third task',
            expected_response: 'Result 3',
            model: 'anthropic:claude-3-haiku',
          },
          mockContext
        ),
      ]);

      // Assert - All should succeed independently
      expect(result1.isError).toBe(false);
      expect(result2.isError).toBe(false);
      expect(result3.isError).toBe(false);
      expect(result1.content).toEqual([{ type: 'text', text: 'Result 1' }]);
      expect(result2.content).toEqual([{ type: 'text', text: 'Result 2' }]);
      expect(result3.content).toEqual([{ type: 'text', text: 'Result 3' }]);
    });

    it('should handle task failures gracefully', async () => {
      // Arrange
      const blockedTask = createMockTask({
        id: 'task_blocked',
        status: 'blocked',
        notes: [],
      });

      (
        mockTaskManager.createTask as MockedFunction<typeof mockTaskManager.createTask>
      ).mockResolvedValue(blockedTask);

      (mockTaskManager.on as MockedFunction<typeof mockTaskManager.on>).mockImplementation(
        (eventName: string | symbol, handler: (...args: unknown[]) => void) => {
          if (eventName === 'task:updated') {
            setTimeout(() => {
              handler({
                task: { ...blockedTask, status: 'blocked' },
                creatorThreadId: mockContext.threadId,
              });
            }, 0);
          }
          return mockTaskManager; // Return this for method chaining
        }
      );

      // Act & Assert
      const result = await delegateTool.execute(
        {
          title: 'Failing Task',
          prompt: 'This will fail',
          expected_response: 'Error',
          model: 'anthropic:claude-3-haiku',
        },
        mockContext
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Task task_blocked is blocked');
    });

    it('should require TaskManager in context', async () => {
      // Arrange
      const contextWithoutTaskManager: ToolContext = {
        threadId: asThreadId('lace_20250726_test01.1'),
        // No taskManager - should error
      };

      // Act & Assert
      const result = await delegateTool.execute(
        {
          title: 'Test Task',
          prompt: 'This will fail',
          expected_response: 'Error',
          model: 'anthropic:claude-3-haiku',
        },
        contextWithoutTaskManager
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('TaskManager is required for delegation');
    });
  });
});
