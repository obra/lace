// ABOUTME: Tests for unified delegate tool API matching task_create format
// ABOUTME: Verifies delegate accepts array format and NewAgentSpec assignedTo parameter

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DelegateTool } from './delegate';
import { ToolContext } from '@lace/core/tools/types';
import { Agent } from '@lace/core/agents/agent';
import { Session } from '@lace/core/sessions/session';
import { TaskManager } from '@lace/core/tasks/task-manager';
import { asThreadId } from '@lace/core/threads/types';
import { setupCoreTest } from '@lace/core/test-utils/core-test-setup';

describe('Unified Delegate API', () => {
  const _tempLaceDir = setupCoreTest();
  let delegateTool: DelegateTool;
  let mockAgent: Agent;
  let mockSession: Session;
  let mockTaskManager: TaskManager;

  beforeEach(() => {
    // Create mock TaskManager
    mockTaskManager = {
      createTask: vi.fn().mockResolvedValue({
        id: 'task_123',
        title: 'Test Task',
        status: 'in_progress',
        notes: [],
      }),
      on: vi.fn(),
      off: vi.fn(),
    } as any;

    // Create mock Session
    mockSession = {
      getTaskManager: vi.fn().mockReturnValue(mockTaskManager),
    } as any;

    // Create mock Agent
    mockAgent = {
      threadId: asThreadId('lace_20250104_test01'),
      getFullSession: vi.fn().mockResolvedValue(mockSession),
    } as any;

    delegateTool = new DelegateTool();
  });

  it('accepts array format matching task_create', async () => {
    const args = {
      tasks: [
        {
          title: 'Analyze test failures',
          prompt: 'Review the test output',
          expected_response: 'List of failing tests',
          assignedTo: 'new:lace;fast',
        },
      ],
    };

    const context: ToolContext = {
      signal: new AbortController().signal,
      agent: mockAgent,
    };

    // Mock task completion event
    mockTaskManager.on.mockImplementation((event, handler) => {
      if (event === 'task:updated') {
        // Simulate immediate task completion
        setTimeout(() => {
          handler({
            task: {
              id: 'task_123',
              status: 'completed',
              notes: [{ author: 'agent_456', content: 'Task completed successfully' }],
            },
            context: { actor: 'agent_456' },
            type: 'task:updated',
          });
        }, 10);
      }
    });

    const result = await delegateTool.execute(args, context);

    expect(result.status).toBe('completed');
    expect(result.content[0].text).toContain('Task completed successfully');
    expect(mockTaskManager.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Analyze test failures',
        assignedTo: 'new:lace;fast',
      }),
      expect.any(Object)
    );
  });

  it('supports multiple task delegation', async () => {
    const args = {
      tasks: [
        {
          title: 'Task 1',
          prompt: 'First task',
          expected_response: 'Response 1',
          assignedTo: 'new:lace;fast',
        },
        {
          title: 'Task 2',
          prompt: 'Second task',
          expected_response: 'Response 2',
          assignedTo: 'new:analyst;smart',
        },
      ],
    };

    const context: ToolContext = {
      signal: new AbortController().signal,
      agent: mockAgent,
    };

    // Mock different task IDs and completions
    let taskCounter = 0;
    mockTaskManager.createTask.mockImplementation(async () => {
      taskCounter++;
      return {
        id: `task_${taskCounter}`,
        title: `Task ${taskCounter}`,
        status: 'in_progress',
        notes: [],
      };
    });

    mockTaskManager.on.mockImplementation((event, handler) => {
      if (event === 'task:updated') {
        // Simulate completion for both tasks
        setTimeout(() => {
          handler({
            task: {
              id: 'task_1',
              status: 'completed',
              notes: [{ author: 'agent_1', content: 'Result 1' }],
            },
            context: { actor: 'agent_1' },
            type: 'task:updated',
          });
        }, 10);
        setTimeout(() => {
          handler({
            task: {
              id: 'task_2',
              status: 'completed',
              notes: [{ author: 'agent_2', content: 'Result 2' }],
            },
            context: { actor: 'agent_2' },
            type: 'task:updated',
          });
        }, 20);
      }
    });

    const result = await delegateTool.execute(args, context);

    expect(result.status).toBe('completed');
    expect(result.content[0].text).toContain('Delegated 2 tasks');
    expect(result.content[0].text).toContain('Task 1 (delegated to new:lace;fast)');
    expect(result.content[0].text).toContain('Task 2 (delegated to new:analyst;smart)');
    expect(mockTaskManager.createTask).toHaveBeenCalledTimes(2);
  });

  it('validates assignedTo format', async () => {
    const args = {
      tasks: [
        {
          title: 'Invalid task',
          prompt: 'Test prompt',
          expected_response: 'Test response',
          assignedTo: 'invalid-format', // Not a NewAgentSpec
        },
      ],
    };

    const context: ToolContext = {
      signal: new AbortController().signal,
      agent: mockAgent,
    };

    const result = await delegateTool.execute(args, context);

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('Invalid assignedTo format');
    expect(result.content[0].text).toContain('Must be "new:persona[;modelSpec]"');
  });

  it('supports all model spec formats', async () => {
    const testCases = [
      'new:lace',
      'new:lace;fast',
      'new:lace;smart',
      'new:lace;anthropic:claude-3-haiku',
      'new:coding-agent;openai:gpt-4',
    ];

    for (const assignedTo of testCases) {
      const args = {
        tasks: [
          {
            title: `Test with ${assignedTo}`,
            prompt: 'Test prompt',
            expected_response: 'Test response',
            assignedTo,
          },
        ],
      };

      const context: ToolContext = {
        signal: new AbortController().signal,
        agent: mockAgent,
      };

      // Mock immediate completion
      mockTaskManager.on.mockImplementation((event, handler) => {
        if (event === 'task:updated') {
          setTimeout(() => {
            handler({
              task: {
                id: 'task_123',
                status: 'completed',
                notes: [{ author: 'agent', content: 'Done' }],
              },
              context: { actor: 'agent' },
              type: 'task:updated',
            });
          }, 10);
        }
      });

      const result = await delegateTool.execute(args, context);

      expect(result.status).toBe('completed');
      expect(mockTaskManager.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          assignedTo: assignedTo,
        }),
        expect.any(Object)
      );

      // Reset mocks for next iteration
      mockTaskManager.createTask.mockClear();
      mockTaskManager.on.mockClear();
    }
  });
});
