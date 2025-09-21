// ABOUTME: Integration tests for task assignment model resolution
// ABOUTME: Verifies the full flow from task creation through agent spawning with flexible model specs

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskManager } from '~/tasks/task-manager';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { UserSettingsManager } from '~/config/user-settings';
import { createNewAgentSpec } from '~/threads/types';
import { setupCoreTest } from '~/test-utils/core-test-setup';

vi.mock('~/config/user-settings');

describe('Task Assignment Model Resolution Integration', () => {
  const _tempLaceDir = setupCoreTest();
  let session: Session;
  let taskManager: TaskManager;

  beforeEach(() => {
    // Setup user settings for fast/smart
    vi.mocked(UserSettingsManager.getDefaultModel).mockImplementation((tier) => {
      if (tier === 'fast') return 'fast-instance:fast-model';
      if (tier === 'smart') return 'smart-instance:smart-model';
      throw new Error('Unknown tier');
    });

    // Create project with default provider config
    const project = Project.create('Test Project', '/tmp/test', 'Test project', {
      providerInstanceId: 'default-instance',
      modelId: 'default-model',
    });

    session = Session.create({
      name: 'Test Session',
      projectId: project.getId(),
    });

    taskManager = session.getTaskManager()!;
  });

  it('should resolve model specs through the full stack', async () => {
    const agentCallback = vi.fn().mockResolvedValue('agent-thread-123');
    taskManager.setAgentCreationCallback(agentCallback);

    // Test 1: Default (no model spec)
    await taskManager.createTask(
      {
        title: 'Test default',
        prompt: 'Test',
        assignedTo: createNewAgentSpec('lace'),
      },
      { actor: 'test' }
    );

    expect(agentCallback).toHaveBeenCalledWith(
      'lace',
      'default-instance',
      'default-model',
      expect.any(Object)
    );

    // Test 2: Fast
    await taskManager.createTask(
      {
        title: 'Test fast',
        prompt: 'Test',
        assignedTo: createNewAgentSpec('helper', 'fast'),
      },
      { actor: 'test' }
    );

    expect(agentCallback).toHaveBeenCalledWith(
      'helper',
      'fast-instance',
      'fast-model',
      expect.any(Object)
    );

    // Test 3: Smart
    await taskManager.createTask(
      {
        title: 'Test smart',
        prompt: 'Test',
        assignedTo: createNewAgentSpec('analyst', 'smart'),
      },
      { actor: 'test' }
    );

    expect(agentCallback).toHaveBeenCalledWith(
      'analyst',
      'smart-instance',
      'smart-model',
      expect.any(Object)
    );

    // Test 4: Explicit
    await taskManager.createTask(
      {
        title: 'Test explicit',
        prompt: 'Test',
        assignedTo: createNewAgentSpec('coder', 'custom:gpt-4'),
      },
      { actor: 'test' }
    );

    expect(agentCallback).toHaveBeenCalledWith('coder', 'custom', 'gpt-4', expect.any(Object));
  });

  it('should handle missing session config gracefully', async () => {
    // Create session with minimal config to allow creation
    const projectWithMinimalConfig = Project.create(
      'Test Project 2',
      '/tmp/test2',
      'Test project 2',
      {
        providerInstanceId: 'some-instance',
        modelId: 'some-model',
      }
    );

    const sessionWithMinimalConfig = Session.create({
      name: 'Test Session 2',
      projectId: projectWithMinimalConfig.getId(),
    });

    const tm = sessionWithMinimalConfig.getTaskManager()!;

    // Clear session config to simulate missing config for our specific test
    // @ts-expect-error - accessing private property for testing
    tm.sessionConfig = undefined;

    const agentCallback = vi.fn().mockResolvedValue('agent-thread-123');
    tm.setAgentCreationCallback(agentCallback);

    // Should use fast/smart from user settings
    await tm.createTask(
      {
        title: 'Test fast without config',
        prompt: 'Test',
        assignedTo: createNewAgentSpec('lace', 'fast'),
      },
      { actor: 'test' }
    );

    expect(agentCallback).toHaveBeenCalledWith(
      'lace',
      'fast-instance',
      'fast-model',
      expect.any(Object)
    );

    // Should fail when using default without session config
    await expect(
      tm.createTask(
        {
          title: 'Test default without config',
          prompt: 'Test',
          assignedTo: createNewAgentSpec('lace'),
        },
        { actor: 'test' }
      )
    ).rejects.toThrow('No model spec provided and context has no defaults');
  });

  it('should work with delegate tool', async () => {
    const agentCallback = vi.fn().mockResolvedValue('agent-thread-123');
    taskManager.setAgentCreationCallback(agentCallback);

    // Simulate delegate tool creating a task
    await taskManager.createTask(
      {
        title: 'Delegated task',
        prompt: 'Research something',
        assignedTo: createNewAgentSpec('lace', 'fast'),
      },
      { actor: 'delegate-tool' }
    );

    expect(agentCallback).toHaveBeenCalledWith(
      'lace',
      'fast-instance',
      'fast-model',
      expect.any(Object)
    );
  });
});
