import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { TaskManager, type AgentCreationCallback } from '~/tasks/task-manager';
import { DatabasePersistence } from '~/persistence/database';
import { createNewAgentSpec, asNewAgentSpec, asThreadId } from '~/threads/types';
import { TaskContext, CreateTaskRequest } from '~/tasks/types';

describe('Task Agent Spawning with Personas', () => {
  let taskManager: TaskManager;
  let mockPersistence: DatabasePersistence;
  let mockAgentCreator: MockedFunction<AgentCreationCallback>;
  
  const sessionId = asThreadId('lace_20250904_test01');
  const context: TaskContext = { actor: 'lace_20250904_test01.1' };
  
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

    // Mock agent creator with new signature
    mockAgentCreator = vi.fn().mockImplementation((_persona, _provider, _model, _task) => {
      return Promise.resolve(asThreadId(`${sessionId}.${Date.now()}`));
    });
    
    taskManager = new TaskManager(sessionId, mockPersistence, mockAgentCreator);
  });

  it('spawns agent with correct persona from NewAgentSpec', async () => {
    const agentSpec = createNewAgentSpec('coding-agent', 'anthropic', 'claude-3-sonnet');
    
    const taskId = await taskManager.createTask({
      title: 'Test Task',
      prompt: 'Do something',
      assignedTo: agentSpec,
    }, context);
    
    // Verify agent creator was called with correct persona
    expect(mockAgentCreator).toHaveBeenCalledWith(
      'coding-agent',
      'anthropic', 
      'claude-3-sonnet',
      expect.objectContaining({
        title: 'Test Task',
        prompt: 'Do something',
      })
    );
  });

  it('spawns agent with helper-agent persona', async () => {
    const agentSpec = createNewAgentSpec('helper-agent', 'openai', 'gpt-4');
    
    await taskManager.createTask({
      title: 'Helper Task',
      prompt: 'Help with this task',
      assignedTo: agentSpec,
    }, context);
    
    // Verify helper-agent persona was passed
    expect(mockAgentCreator).toHaveBeenCalledWith(
      'helper-agent',
      'openai',
      'gpt-4',
      expect.objectContaining({
        title: 'Helper Task',
      })
    );
  });

  it('spawns agent with custom persona', async () => {
    const agentSpec = createNewAgentSpec('my-custom-persona', 'lmstudio', 'custom-model');
    
    await taskManager.createTask({
      title: 'Custom Task', 
      prompt: 'Custom work',
      assignedTo: agentSpec,
    }, context);
    
    // Verify custom persona was passed
    expect(mockAgentCreator).toHaveBeenCalledWith(
      'my-custom-persona',
      'lmstudio',
      'custom-model',
      expect.objectContaining({
        title: 'Custom Task',
      })
    );
  });

  it('treats old format as regular assignment (no agent spawning)', async () => {
    const oldFormatSpec = asNewAgentSpec('new:anthropic/claude-3-sonnet'); // Old format
    
    const task = await taskManager.createTask({
      title: 'Test Task',
      prompt: 'Do something',
      assignedTo: oldFormatSpec,
    }, context);
    
    // Old format should not trigger agent spawning
    expect(mockAgentCreator).not.toHaveBeenCalled();
    
    // Task should be created normally with original assignee
    expect(task.assignedTo).toBe('new:anthropic/claude-3-sonnet');
    expect(task.status).toBe('pending'); // Not 'in_progress'
  });

  it('handles different persona types correctly', async () => {
    const testCases = [
      { persona: 'lace', provider: 'anthropic', model: 'claude-3-sonnet' },
      { persona: 'coding-agent', provider: 'openai', model: 'gpt-4' },
      { persona: 'helper-agent', provider: 'ollama', model: 'llama2' },
      { persona: 'data-analyst', provider: 'anthropic', model: 'claude-3-haiku' },
    ];

    for (const { persona, provider, model } of testCases) {
      mockAgentCreator.mockClear();
      
      const spec = createNewAgentSpec(persona, provider, model);
      
      await taskManager.createTask({
        title: `Test ${persona}`,
        prompt: 'Test prompt',
        assignedTo: spec,
      }, context);

      expect(mockAgentCreator).toHaveBeenCalledWith(
        persona,
        provider,
        model,
        expect.any(Object)
      );
    }
  });

  it('emits agent spawned event with persona information', async () => {
    const eventListener = vi.fn();
    taskManager.on('agent:spawned', eventListener);

    const agentSpec = createNewAgentSpec('coding-agent', 'anthropic', 'claude-3-sonnet');
    
    await taskManager.createTask({
      title: 'Event Test',
      prompt: 'Testing events',
      assignedTo: agentSpec,
    }, context);

    expect(eventListener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agent:spawned',
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        agentThreadId: expect.stringMatching(/^lace_20250904_test01\.\d+$/) as string,
      })
    );
  });

  it('handles agent creation failures gracefully', async () => {
    // Mock agent creator to fail
    mockAgentCreator.mockRejectedValue(new Error('Agent creation failed'));

    const agentSpec = createNewAgentSpec('lace', 'anthropic', 'claude-3-sonnet');
    
    await expect(
      taskManager.createTask({
        title: 'Test Task',
        prompt: 'This will fail',
        assignedTo: agentSpec,
      }, context)
    ).rejects.toThrow('Failed to spawn agent for task');
  });
});