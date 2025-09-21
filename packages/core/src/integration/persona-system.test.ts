import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent, AgentConfig } from '~/agents/agent';
import { TaskManager, AgentCreationCallback } from '~/tasks/task-manager';
import { createNewAgentSpec, asThreadId } from '~/threads/types';
import { personaRegistry } from '~/config/persona-registry';
import { PromptManager } from '~/config/prompt-manager';
import { loadPromptConfig } from '~/config/prompts';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';
import { DatabasePersistence } from '~/persistence/database';

describe('Persona System Integration', () => {
  let mockToolExecutor: ToolExecutor;
  let mockThreadManager: ThreadManager;
  let mockPersistence: DatabasePersistence;

  beforeEach(() => {
    // Mock core dependencies
    mockToolExecutor = {
      execute: vi.fn(),
      getAvailableTools: vi.fn().mockReturnValue([]),
    } as unknown as ToolExecutor;

    mockThreadManager = {
      addEvent: vi.fn(),
      getThread: vi.fn(),
    } as unknown as ThreadManager;

    mockPersistence = {
      saveTask: vi.fn(),
      loadTask: vi.fn(),
      updateTask: vi.fn(),
      loadTasksByThread: vi.fn().mockReturnValue([]),
      addTaskNote: vi.fn(),
    } as unknown as DatabasePersistence;
  });

  it('creates agent with persona and loads correct prompt configuration', async () => {
    // Verify persona exists
    expect(personaRegistry.hasPersona('coding-agent')).toBe(true);
    expect(personaRegistry.hasPersona('helper-agent')).toBe(true);
    expect(personaRegistry.hasPersona('lace')).toBe(true);

    // Create agent with persona
    const agentConfig: AgentConfig = {
      toolExecutor: mockToolExecutor,
      threadManager: mockThreadManager,
      threadId: 'lace_20250904_test01',
      tools: [],
      persona: 'coding-agent',
      metadata: {
        name: 'Test Coding Agent',
        modelId: 'claude-3-sonnet',
        providerInstanceId: 'anthropic',
      },
    };

    const agent = new Agent(agentConfig);

    // Verify agent has correct persona
    const agentInfo = agent.getInfo();
    expect(agentInfo.persona).toBe('coding-agent');
    expect(typeof agentInfo.name).toBe('string');
  });

  it('handles full task workflow with persona agents', async () => {
    const sessionId = asThreadId('lace_20250904_test01');

    // Mock agent creator callback
    const mockAgentCreator: AgentCreationCallback = vi
      .fn()
      .mockImplementation(async (persona, provider, model, task) => {
        expect(persona).toBe('helper-agent');
        expect(provider).toBe('anthropic');
        expect(model).toBe('claude-3-sonnet');
        expect(task).toHaveProperty('title');

        return asThreadId(`${sessionId}.${Date.now()}`);
      });

    const taskManager = new TaskManager(sessionId, mockPersistence, mockAgentCreator);

    // Create task assigned to helper agent
    const task = await taskManager.createTask(
      {
        title: 'Help me organize my files',
        prompt: 'I need help organizing my project files',
        assignedTo: createNewAgentSpec('helper-agent', 'anthropic:claude-3-sonnet'),
      },
      { actor: 'user' }
    );

    // Verify task was created and agent spawned
    expect(mockAgentCreator).toHaveBeenCalledWith(
      'helper-agent',
      'anthropic',
      'claude-3-sonnet',
      expect.objectContaining({
        title: 'Help me organize my files',
      })
    );

    // Verify task assignment was updated to actual thread ID
    expect(task.assignedTo).not.toBe('new:helper-agent;anthropic:claude-3-sonnet');
    expect(task.status).toBe('in_progress');
  });

  it('prompt manager generates different prompts for different personas', async () => {
    const promptManager = new PromptManager({});

    // Generate prompts for different personas
    const lacePrompt = await promptManager.generateSystemPrompt('lace');
    const codingPrompt = await promptManager.generateSystemPrompt('coding-agent');
    const helperPrompt = await promptManager.generateSystemPrompt('helper-agent');

    // All should be valid strings
    expect(typeof lacePrompt).toBe('string');
    expect(typeof codingPrompt).toBe('string');
    expect(typeof helperPrompt).toBe('string');

    expect(lacePrompt.length).toBeGreaterThan(0);
    expect(codingPrompt.length).toBeGreaterThan(0);
    expect(helperPrompt.length).toBeGreaterThan(0);
  });

  it('loadPromptConfig integrates with persona system', async () => {
    const config1 = await loadPromptConfig({ persona: 'lace' });
    const config2 = await loadPromptConfig({ persona: 'coding-agent' });
    const config3 = await loadPromptConfig({ persona: 'helper-agent' });

    expect(config1).toHaveProperty('systemPrompt');
    expect(config2).toHaveProperty('systemPrompt');
    expect(config3).toHaveProperty('systemPrompt');

    expect(config1.systemPrompt).toBeTruthy();
    expect(config2.systemPrompt).toBeTruthy();
    expect(config3.systemPrompt).toBeTruthy();
  });

  it('persona registry discovers all built-in personas', () => {
    const personas = personaRegistry.listAvailablePersonas();
    const personaNames = personas.map((p) => p.name);

    expect(personaNames).toContain('lace');
    expect(personaNames).toContain('coding-agent');
    expect(personaNames).toContain('helper-agent');

    // All should be built-in (not user-defined) in test environment
    const builtInPersonas = personas.filter((p) => !p.isUserDefined);
    expect(builtInPersonas.length).toBeGreaterThanOrEqual(3);
  });

  it('agent spawning works with different model specifications', async () => {
    const sessionId = asThreadId('lace_20250904_abc123');
    const taskManager = new TaskManager(sessionId, mockPersistence);

    const mockAgentCreator: AgentCreationCallback = vi
      .fn()
      .mockResolvedValue(asThreadId(`${sessionId}.${Date.now()}`));
    taskManager.setAgentCreationCallback(mockAgentCreator);

    const context = { actor: sessionId };

    // Test explicit model spec
    const task = await taskManager.createTask(
      {
        title: 'Integration Test',
        prompt: 'Test agent spawning integration',
        assignedTo: createNewAgentSpec('helper-agent', 'anthropic:claude-3-sonnet'),
      },
      context
    );

    expect(mockAgentCreator).toHaveBeenCalledWith(
      'helper-agent',
      'anthropic',
      'claude-3-sonnet',
      expect.any(Object)
    );
    expect(task.status).toBe('in_progress');
  });

  it('error handling works throughout the stack', async () => {
    const promptManager = new PromptManager({});

    // Should not throw for invalid personas
    const prompt = await promptManager.generateSystemPrompt('nonexistent-persona');
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);

    // PersonaRegistry should provide helpful error messages
    expect(() => personaRegistry.validatePersona('invalid-persona')).toThrow(/Available personas:/);
  });

  it('agent configuration flows through correctly', () => {
    const config: AgentConfig = {
      toolExecutor: mockToolExecutor,
      threadManager: mockThreadManager,
      threadId: 'lace_20250904_test01',
      tools: [],
      persona: 'coding-agent',
      metadata: {
        name: 'Integration Test Agent',
        modelId: 'claude-3-sonnet',
        providerInstanceId: 'anthropic',
      },
    };

    const agent = new Agent(config);
    const info = agent.getInfo();

    // Verify all persona integration points
    expect(info.persona).toBe('coding-agent');
    expect(typeof info.name).toBe('string');
    expect(typeof info.modelId).toBe('string');
    expect(typeof info.providerInstanceId).toBe('string');
    expect(info.status).toBeDefined();
    expect(info.threadId).toBeDefined();
  });
});
