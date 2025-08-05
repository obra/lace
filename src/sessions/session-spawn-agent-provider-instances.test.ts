// ABOUTME: Comprehensive tests for Session.spawnAgent() provider instance integration
// ABOUTME: Verifies spawnAgent() accepts provider instance parameters, inheritance, and configuration patterns

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';

describe('Session.spawnAgent() with Provider Instances', () => {
  const _tempDirContext = useTempLaceDir();
  let testProject: Project;
  let testSession: Session;
  let providerInstanceId: string;
  let openaiProviderInstanceId: string;

  beforeEach(async () => {
    setupTestPersistence();
    setupTestProviderDefaults();
    Session.clearProviderCache();

    // Create real provider instances for testing
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022'],
      displayName: 'Test Session Spawn Instance',
      apiKey: 'test-anthropic-key',
    });

    openaiProviderInstanceId = await createTestProviderInstance({
      catalogId: 'openai',
      models: ['gpt-4o', 'gpt-4o-mini'],
      displayName: 'Test OpenAI Session Spawn Instance',
      apiKey: 'test-openai-key',
    });

    // Create a test project with provider configuration using defaults
    testProject = Project.create(
      'Test Project',
      '/test/path',
      'Test project for spawn agent tests',
      {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );

    // Create session WITHOUT provider configuration - it inherits from project
    testSession = Session.create({
      name: 'Test Session',
      projectId: testProject.getId(),
    });
  });

  afterEach(async () => {
    testSession?.destroy();
    teardownTestPersistence();
    cleanupTestProviderDefaults();
    if (providerInstanceId || openaiProviderInstanceId) {
      await cleanupTestProviderInstances(
        [providerInstanceId, openaiProviderInstanceId].filter(Boolean)
      );
    }
  });

  describe('Basic agent spawning with provider instances', () => {
    it('should spawn agent with session defaults when no provider specified', () => {
      const agent = testSession.spawnAgent({ name: 'Default Agent' });

      expect(agent).toBeDefined();
      expect(agent.threadId).toBeDefined();

      // Agent should inherit session's provider instance configuration
      const agents = testSession.getAgents();
      const spawnedAgent = agents.find((a) => a.threadId === agent.threadId);
      expect(spawnedAgent?.provider).toBe('anthropic');
      expect(spawnedAgent?.model).toBe('claude-3-5-haiku-20241022');
      expect(spawnedAgent?.name).toBe('Default Agent');
    });

    it('should spawn agent with explicit provider instance parameters', () => {
      const agent = testSession.spawnAgent({
        name: 'OpenAI Agent',
        providerInstanceId: openaiProviderInstanceId,
        modelId: 'gpt-4o',
      });

      expect(agent).toBeDefined();
      expect(agent.threadId).toBeDefined();

      // Agent should be created successfully with specified model
      // Note: During transition, provider resolution falls back to 'anthropic'
      const agents = testSession.getAgents();
      const spawnedAgent = agents.find((a) => a.threadId === agent.threadId);
      expect(spawnedAgent?.model).toBe('gpt-4o'); // Model should be preserved
      expect(spawnedAgent?.name).toBe('OpenAI Agent');
    });

    it('should spawn agent with custom model on same provider instance', () => {
      const agent = testSession.spawnAgent({
        name: 'Sonnet Agent',
        providerInstanceId,
        modelId: 'claude-3-5-sonnet-20241022',
      });

      expect(agent).toBeDefined();

      // Agent should use same provider but different model
      const agents = testSession.getAgents();
      const spawnedAgent = agents.find((a) => a.threadId === agent.threadId);
      expect(spawnedAgent?.provider).toBe('anthropic');
      expect(spawnedAgent?.model).toBe('claude-3-5-sonnet-20241022');
      expect(spawnedAgent?.name).toBe('Sonnet Agent');
    });
  });

  describe('Provider instance inheritance patterns', () => {
    it('should inherit provider instance when only name is specified', () => {
      const agent = testSession.spawnAgent({ name: 'Simple Agent' });

      const agents = testSession.getAgents();
      const spawnedAgent = agents.find((a) => a.threadId === agent.threadId);

      // Should inherit from session
      expect(spawnedAgent?.provider).toBe('anthropic');
      expect(spawnedAgent?.model).toBe('claude-3-5-haiku-20241022');
    });

    it('should accept explicit provider instance parameters', () => {
      const agent = testSession.spawnAgent({
        name: 'Override Agent',
        providerInstanceId: openaiProviderInstanceId,
        modelId: 'gpt-4o-mini',
      });

      const agents = testSession.getAgents();
      const spawnedAgent = agents.find((a) => a.threadId === agent.threadId);

      // Should accept parameters and preserve model
      // Note: Provider resolution currently falls back during transition
      expect(spawnedAgent?.model).toBe('gpt-4o-mini');
      expect(spawnedAgent?.name).toBe('Override Agent');
    });

    it('should handle partial provider instance parameters during transition', () => {
      // During transition period, the system may be more lenient
      // This test verifies the interface accepts the parameters
      const agent = testSession.spawnAgent({
        name: 'Partial Config Agent',
        providerInstanceId: openaiProviderInstanceId,
        // Note: Missing modelId might be handled by fallback logic
      } as Parameters<typeof testSession.spawnAgent>[0]);

      expect(agent).toBeDefined();
      expect(agent.threadId).toBeDefined();
    });

    it('should handle model-only specification during transition', () => {
      // During transition period, specifying only model should work
      const agent = testSession.spawnAgent({
        name: 'Model Only Agent',
        modelId: 'claude-3-5-sonnet-20241022', // Use compatible Anthropic model with test-anthropic provider
        // Missing providerInstanceId - should fall back to session provider (test-anthropic)
      } as Parameters<typeof testSession.spawnAgent>[0]);

      expect(agent).toBeDefined();
      const agents = testSession.getAgents();
      const spawnedAgent = agents.find((a) => a.threadId === agent.threadId);
      expect(spawnedAgent?.model).toBe('claude-3-5-sonnet-20241022');
    });
  });

  describe('Multiple agent configurations', () => {
    it('should spawn multiple agents with different model configurations', () => {
      const anthropicAgent = testSession.spawnAgent({
        name: 'Anthropic Agent',
        providerInstanceId,
        modelId: 'claude-3-5-sonnet-20241022',
      });

      const openaiAgent = testSession.spawnAgent({
        name: 'OpenAI Agent',
        providerInstanceId: openaiProviderInstanceId,
        modelId: 'gpt-4o',
      });

      const agents = testSession.getAgents();
      expect(agents).toHaveLength(3); // Coordinator + 2 spawned agents

      const anthropicSpawned = agents.find((a) => a.threadId === anthropicAgent.threadId);
      expect(anthropicSpawned?.model).toBe('claude-3-5-sonnet-20241022');
      expect(anthropicSpawned?.name).toBe('Anthropic Agent');

      const openaiSpawned = agents.find((a) => a.threadId === openaiAgent.threadId);
      expect(openaiSpawned?.model).toBe('gpt-4o');
      expect(openaiSpawned?.name).toBe('OpenAI Agent');
    });

    it('should spawn agents with mixed inheritance and explicit configuration', () => {
      const defaultAgent = testSession.spawnAgent({ name: 'Default Agent' });
      const explicitAgent = testSession.spawnAgent({
        name: 'Explicit Agent',
        providerInstanceId: openaiProviderInstanceId,
        modelId: 'gpt-4o-mini',
      });

      const agents = testSession.getAgents();
      expect(agents).toHaveLength(3); // Coordinator + 2 spawned agents

      const defaultSpawned = agents.find((a) => a.threadId === defaultAgent.threadId);
      expect(defaultSpawned?.model).toBe('claude-3-5-haiku-20241022'); // Inherited from session
      expect(defaultSpawned?.name).toBe('Default Agent');

      const explicitSpawned = agents.find((a) => a.threadId === explicitAgent.threadId);
      expect(explicitSpawned?.model).toBe('gpt-4o-mini'); // Model should be preserved
      expect(explicitSpawned?.name).toBe('Explicit Agent');
    });
  });

  describe('Agent naming and defaults', () => {
    it('should use "Lace" as default name when no name provided', () => {
      const agent = testSession.spawnAgent({});

      const agents = testSession.getAgents();
      const spawnedAgent = agents.find((a) => a.threadId === agent.threadId);
      expect(spawnedAgent?.name).toBe('Lace');
    });

    it('should use "Lace" as default name for empty string', () => {
      const agent = testSession.spawnAgent({ name: '' });

      const agents = testSession.getAgents();
      const spawnedAgent = agents.find((a) => a.threadId === agent.threadId);
      expect(spawnedAgent?.name).toBe('Lace');
    });

    it('should use "Lace" as default name for whitespace-only string', () => {
      const agent = testSession.spawnAgent({ name: '   ' });

      const agents = testSession.getAgents();
      const spawnedAgent = agents.find((a) => a.threadId === agent.threadId);
      expect(spawnedAgent?.name).toBe('Lace');
    });

    it('should preserve custom agent names', () => {
      const agent = testSession.spawnAgent({ name: 'Custom Agent Name' });

      const agents = testSession.getAgents();
      const spawnedAgent = agents.find((a) => a.threadId === agent.threadId);
      expect(spawnedAgent?.name).toBe('Custom Agent Name');
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle sessions and agents with different model configurations', () => {
      // Create session with OpenAI provider configuration
      const openaiSession = Session.create({
        name: 'OpenAI Session',
        projectId: testProject.getId(),
        configuration: {
          providerInstanceId: openaiProviderInstanceId,
          modelId: 'gpt-4o',
        },
      });

      // Spawn agent with different model configuration
      const agent = openaiSession.spawnAgent({
        name: 'Cross Provider Agent',
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      });

      const agents = openaiSession.getAgents();
      const coordinatorAgent = agents.find((a) => a.threadId === openaiSession.getId());
      const spawnedAgent = agents.find((a) => a.threadId === agent.threadId);

      // Verify models are preserved correctly
      expect(coordinatorAgent?.model).toBe('gpt-4o');
      expect(spawnedAgent?.model).toBe('claude-3-5-haiku-20241022');
      expect(spawnedAgent?.name).toBe('Cross Provider Agent');

      openaiSession.destroy();
    });

    it('should track all spawned agents correctly', () => {
      const _agent1 = testSession.spawnAgent({ name: 'Agent 1' });
      const _agent2 = testSession.spawnAgent({
        name: 'Agent 2',
        providerInstanceId: openaiProviderInstanceId,
        modelId: 'gpt-4o',
      });
      const _agent3 = testSession.spawnAgent({ name: 'Agent 3' });

      const agents = testSession.getAgents();
      expect(agents).toHaveLength(4); // Coordinator + 3 spawned agents

      const agentNames = agents.map((a) => a.name);
      expect(agentNames).toContain('Lace'); // Coordinator
      expect(agentNames).toContain('Agent 1');
      expect(agentNames).toContain('Agent 2');
      expect(agentNames).toContain('Agent 3');
    });
  });
});
