// ABOUTME: Tests for unified delegate tool API matching task_create format
// ABOUTME: Verifies delegate accepts array format and NewAgentSpec assignTo parameter

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DelegateTool } from '~/tools/implementations/delegate';
import { ToolContext } from '~/tools/types';
import { Agent } from '~/agents/agent';
import { Session } from '~/sessions/session';
import { TaskManager } from '~/tasks/task-manager';
import { asThreadId } from '~/threads/types';
import { DatabasePersistence } from '~/persistence/database';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

describe('Unified Delegate API', () => {
  let tempDir: string;
  let dbPath: string;
  let persistence: DatabasePersistence;
  let delegateTool: DelegateTool;
  let mockAgent: Agent;
  let mockSession: Session;
  let mockTaskManager: TaskManager;

  beforeEach(() => {
    // Create temp directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegate-unified-test-'));
    dbPath = path.join(tempDir, 'test.db');
    persistence = new DatabasePersistence(dbPath);

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

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('accepts array format matching task_create', async () => {
    const args = {
      tasks: [
        {
          title: 'Analyze test failures',
          prompt: 'Review the test output',
          expected_response: 'List of failing tests',
          assignTo: 'new:lace;fast',
        },
      ],
    };

    const context: ToolContext = {
      signal: new AbortController().signal,
      workingDirectory: tempDir,
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
          assignTo: 'new:lace;fast',
        },
        {
          title: 'Task 2',
          prompt: 'Second task',
          expected_response: 'Response 2',
          assignTo: 'new:analyst;smart',
        },
      ],
    };

    const context: ToolContext = {
      signal: new AbortController().signal,
      workingDirectory: tempDir,
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

  it('validates assignTo format', async () => {
    const args = {
      tasks: [
        {
          title: 'Invalid task',
          prompt: 'Test prompt',
          expected_response: 'Test response',
          assignTo: 'invalid-format', // Not a NewAgentSpec
        },
      ],
    };

    const context: ToolContext = {
      signal: new AbortController().signal,
      workingDirectory: tempDir,
      agent: mockAgent,
    };

    const result = await delegateTool.execute(args, context);

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('Invalid assignTo format');
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

    for (const assignTo of testCases) {
      const args = {
        tasks: [
          {
            title: `Test with ${assignTo}`,
            prompt: 'Test prompt',
            expected_response: 'Test response',
            assignTo,
          },
        ],
      };

      const context: ToolContext = {
        signal: new AbortController().signal,
        workingDirectory: tempDir,
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
          assignedTo: assignTo,
        }),
        expect.any(Object)
      );

      // Reset mocks for next iteration
      mockTaskManager.createTask.mockClear();
      mockTaskManager.on.mockClear();
    }
  });
});
