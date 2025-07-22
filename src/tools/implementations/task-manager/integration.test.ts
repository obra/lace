// ABOUTME: Integration tests for multi-agent task management workflows
// ABOUTME: Tests end-to-end scenarios including task creation, assignment, and collaboration

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TaskCreateTool,
  TaskListTool,
  TaskUpdateTool,
  TaskAddNoteTool,
  TaskViewTool,
} from '~/tools/implementations/task-manager/tools';
import { ToolContext } from '~/tools/types';
import { asThreadId, createNewAgentSpec } from '~/threads/types';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';
import { setupTestPersistence, teardownTestPersistence } from '~/test-setup-dir/persistence-helper';

describe('Multi-Agent Task Manager Integration', () => {
  const _tempDirContext = useTempLaceDir();

  // Simulate three agents in a parent thread
  const parentThreadId = asThreadId('lace_20250703_parent');
  const mainAgentContext: ToolContext = {
    threadId: asThreadId('lace_20250703_parent.1'),
    parentThreadId,
  };
  const agent2Context: ToolContext = {
    threadId: asThreadId('lace_20250703_parent.2'),
    parentThreadId,
  };
  const agent3Context: ToolContext = {
    threadId: asThreadId('lace_20250703_parent.3'),
    parentThreadId,
  };

  beforeEach(() => {
    setupTestPersistence();
    // No special setup needed - tools and tests use same database via LACE_DIR
  });

  afterEach(() => {
    teardownTestPersistence();
    vi.clearAllMocks();
  });

  describe('Multi-agent task workflow', () => {
    it('should support full lifecycle of multi-agent task collaboration', async () => {
      const createTool = new TaskCreateTool();
      const listTool = new TaskListTool();
      const updateTool = new TaskUpdateTool();
      const noteTool = new TaskAddNoteTool();

      // Step 1: Main agent creates a task
      const createResult = await createTool.execute(
        {
          title: 'Implement user authentication',
          description: 'Add secure login functionality',
          prompt:
            'Create a JWT-based authentication system with login, logout, and session management',
          priority: 'high',
        },
        mainAgentContext
      );

      expect(createResult.isError).toBe(false);
      const taskId = createResult.content?.[0]?.text?.match(/task_\d{8}_[a-z0-9]{6}/)?.[0] || '';
      expect(taskId).toBeTruthy();

      // Step 2: Main agent lists tasks
      const listResult1 = await listTool.execute(
        {
          filter: 'created',
        },
        mainAgentContext
      );

      expect(listResult1.isError).toBe(false);
      expect(listResult1.content?.[0]?.text).toContain('Implement user authentication');

      // Step 3: Main agent assigns task to agent2
      const assignResult = await updateTool.execute(
        {
          taskId,
          assignTo: agent2Context.threadId!,
        },
        mainAgentContext
      );

      expect(assignResult.isError).toBe(false);

      // Step 4: Agent2 sees the task in their list
      const listResult2 = await listTool.execute(
        {
          filter: 'mine',
        },
        agent2Context
      );

      expect(listResult2.isError).toBe(false);
      expect(listResult2.content?.[0]?.text).toContain('Implement user authentication');

      // Step 5: Agent2 updates status to in_progress
      const statusResult = await updateTool.execute(
        {
          taskId,
          status: 'in_progress',
        },
        agent2Context
      );

      expect(statusResult.isError).toBe(false);

      // Step 6: Agent2 adds a progress note
      const noteResult1 = await noteTool.execute(
        {
          taskId,
          note: 'Started implementing JWT token generation',
        },
        agent2Context
      );

      expect(noteResult1.isError).toBe(false);

      // Step 7: Main agent adds a note with additional requirements
      const noteResult2 = await noteTool.execute(
        {
          taskId,
          note: 'Please also add refresh token support',
        },
        mainAgentContext
      );

      expect(noteResult2.isError).toBe(false);

      // Step 8: Agent3 can see all tasks in the thread
      const listResult3 = await listTool.execute(
        {
          filter: 'thread',
        },
        agent3Context
      );

      expect(listResult3.isError).toBe(false);
      expect(listResult3.content?.[0]?.text).toContain('Implement user authentication');

      // Step 9: Verify task has all notes using TaskViewTool
      const viewTool = new TaskViewTool();
      const finalViewResult = await viewTool.execute({ taskId }, mainAgentContext);
      expect(finalViewResult.isError).toBe(false);

      const taskDetails = finalViewResult.content?.[0]?.text || '';
      expect(taskDetails).toContain('JWT token generation');
      expect(taskDetails).toContain('refresh token support');
      expect(taskDetails).toContain('in_progress');

      // Should have 2 notes in the output
      const noteMatches = taskDetails.match(/\d+\. \[lace_20250703_parent\.\d+\]/g);
      expect(noteMatches).toHaveLength(2);
    });
  });

  describe('New agent assignment workflow', () => {
    it('should handle task assignment to new agent specification', async () => {
      const createTool = new TaskCreateTool();
      const _listTool = new TaskListTool();
      const updateTool = new TaskUpdateTool();

      // Create task assigned to a new agent spec
      const newAgentSpec = createNewAgentSpec('anthropic', 'claude-3-haiku');
      const createResult = await createTool.execute(
        {
          title: 'Research best practices',
          prompt: 'Research and document best practices for JWT security',
          priority: 'medium',
          assignedTo: newAgentSpec,
        },
        mainAgentContext
      );

      expect(createResult.isError).toBe(false);
      const taskId = createResult.content?.[0]?.text?.match(/task_\d{8}_[a-z0-9]{6}/)?.[0] || '';

      // Verify task shows new agent assignment using TaskViewTool
      const viewTool = new TaskViewTool();
      const viewResult = await viewTool.execute({ taskId }, mainAgentContext);
      expect(viewResult.isError).toBe(false);
      expect(viewResult.content?.[0]?.text).toContain('new:anthropic/claude-3-haiku');
      expect(viewResult.content?.[0]?.text).toContain('pending');

      // Later, reassign to actual agent
      const actualAgentResult = await updateTool.execute(
        {
          taskId,
          assignTo: agent3Context.threadId!,
        },
        mainAgentContext
      );

      expect(actualAgentResult.isError).toBe(false);

      // Verify reassignment using TaskViewTool
      const viewTool2 = new TaskViewTool();
      const viewResult2 = await viewTool2.execute({ taskId }, mainAgentContext);
      expect(viewResult2.isError).toBe(false);
      expect(viewResult2.content?.[0]?.text).toContain(agent3Context.threadId!);
    });
  });

  describe('Thread isolation', () => {
    it('should isolate tasks between different parent threads', async () => {
      // Create a different parent thread context
      const otherParentThreadId = asThreadId('lace_20250703_other1');
      const otherAgentContext: ToolContext = {
        threadId: asThreadId('lace_20250703_other1.1'),
        parentThreadId: otherParentThreadId,
      };

      const createTool = new TaskCreateTool();
      const listTool = new TaskListTool();

      // Create task in main thread
      await createTool.execute(
        {
          title: 'Main thread task',
          prompt: 'Do something in main thread',
          priority: 'high',
        },
        mainAgentContext
      );

      // Create task in other thread
      await createTool.execute(
        {
          title: 'Other thread task',
          prompt: 'Do something in other thread',
          priority: 'low',
        },
        otherAgentContext
      );

      // Main agent should only see main thread task
      const mainListResult = await listTool.execute(
        {
          filter: 'thread',
        },
        mainAgentContext
      );

      expect(mainListResult.content?.[0]?.text).toContain('Main thread task');
      expect(mainListResult.content?.[0]?.text).not.toContain('Other thread task');

      // Other agent should only see other thread task
      const otherListResult = await listTool.execute(
        {
          filter: 'thread',
        },
        otherAgentContext
      );

      expect(otherListResult.content?.[0]?.text).toContain('Other thread task');
      expect(otherListResult.content?.[0]?.text).not.toContain('Main thread task');
    });
  });

  describe('Concurrent access', () => {
    it('should handle concurrent task updates', async () => {
      const createTool = new TaskCreateTool();
      const noteTool = new TaskAddNoteTool();

      // Create a task
      const createResult = await createTool.execute(
        {
          title: 'Concurrent test task',
          prompt: 'Test concurrent access',
          priority: 'medium',
        },
        mainAgentContext
      );

      const taskId = createResult.content?.[0]?.text?.match(/task_\d{8}_[a-z0-9]{6}/)?.[0] || '';

      // Simulate concurrent note additions
      const notePromises = [
        noteTool.execute({ taskId, note: 'Note from agent 1' }, mainAgentContext),
        noteTool.execute({ taskId, note: 'Note from agent 2' }, agent2Context),
        noteTool.execute({ taskId, note: 'Note from agent 3' }, agent3Context),
      ];

      const results = await Promise.all(notePromises);

      // All should succeed
      results.forEach((result) => {
        expect(result.isError).toBe(false);
      });

      // Verify all notes were added using TaskViewTool
      const viewTool = new TaskViewTool();
      const viewResult = await viewTool.execute({ taskId }, mainAgentContext);
      expect(viewResult.isError).toBe(false);

      const taskDetails = viewResult.content?.[0]?.text || '';
      expect(taskDetails).toContain('Note from agent 1');
      expect(taskDetails).toContain('Note from agent 2');
      expect(taskDetails).toContain('Note from agent 3');

      // Should have 3 notes in the output (each note shows as "N. [author] timestamp")
      const noteMatches = taskDetails.match(/\d+\. \[lace_20250703_parent\.\d+\]/g);
      expect(noteMatches).toHaveLength(3);
    });
  });

  describe('Task filtering and visibility', () => {
    it('should correctly filter tasks by different criteria', async () => {
      const createTool = new TaskCreateTool();
      const listTool = new TaskListTool();

      // Create various tasks
      await createTool.execute(
        {
          title: 'Task created by agent1',
          prompt: 'Do something',
          priority: 'high',
        },
        mainAgentContext
      );

      await createTool.execute(
        {
          title: 'Task assigned to agent2',
          prompt: 'Do something else',
          priority: 'medium',
          assignedTo: agent2Context.threadId!,
        },
        mainAgentContext
      );

      await createTool.execute(
        {
          title: 'Task created by agent2',
          prompt: 'Do another thing',
          priority: 'low',
          assignedTo: mainAgentContext.threadId!,
        },
        agent2Context
      );

      // Test 'mine' filter for agent1
      const mineResult = await listTool.execute({ filter: 'mine' }, mainAgentContext);
      expect(mineResult.content?.[0]?.text).toContain('Task created by agent2'); // Assigned to agent1
      expect(mineResult.content?.[0]?.text).not.toContain('Task assigned to agent2');

      // Test 'created' filter for agent1
      const createdResult = await listTool.execute({ filter: 'created' }, mainAgentContext);
      expect(createdResult.content?.[0]?.text).toContain('Task created by agent1');
      expect(createdResult.content?.[0]?.text).toContain('Task assigned to agent2');
      expect(createdResult.content?.[0]?.text).not.toContain('Task created by agent2');

      // Test 'all' filter for agent2
      const allResult = await listTool.execute({ filter: 'all' }, agent2Context);
      expect(allResult.content?.[0]?.text).toContain('Task assigned to agent2');
      expect(allResult.content?.[0]?.text).toContain('Task created by agent2');
      // Should see all thread tasks
      expect(allResult.content?.[0]?.text).toContain('Task created by agent1');
    });
  });
});
