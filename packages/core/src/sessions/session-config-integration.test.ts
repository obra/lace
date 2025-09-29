// ABOUTME: Integration tests for Session class with new configuration system
// ABOUTME: Tests session creation with configuration and preset integration

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { ConfigurationPresetManager, SessionConfiguration } from '~/sessions/session-config';
import { setupCoreTest, cleanupSession } from '~/test-utils/core-test-setup';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';

// No mocking for integration tests - use real filesystem access

describe('Session Configuration Integration', () => {
  const _tempLaceDir = setupCoreTest();
  let testProject: Project;
  let projectId: string;
  let presetManager: ConfigurationPresetManager;
  let providerInstanceId: string;

  beforeEach(async () => {
    setupTestProviderDefaults();

    // Create a real provider instance for testing
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    // Create a test project with the real provider instance
    testProject = Project.create('Test Project', '/test/path', 'Test project for configuration', {
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      maxTokens: 4000,
    });
    projectId = testProject.getId();

    presetManager = new ConfigurationPresetManager();
  });

  afterEach(async () => {
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances([providerInstanceId]);
  });

  describe('Session configuration validation', () => {
    it('should validate session configuration during creation', () => {
      const validConfig: SessionConfiguration = {
        providerInstanceId: 'openai-default',
        modelId: 'gpt-4',
        maxTokens: 8000,
        temperature: 0.7,
        systemPrompt: 'You are a helpful assistant.',
        tools: ['file_read', 'bash'],
        toolPolicies: {
          bash: 'ask',
        },
      };

      const validated = Session.validateConfiguration(validConfig);
      expect(validated.providerInstanceId).toBe('openai-default');
      expect(validated.modelId).toBe('gpt-4');
      expect(validated.maxTokens).toBe(8000);
      expect(validated.temperature).toBe(0.7);
      expect(validated.systemPrompt).toBe('You are a helpful assistant.');
      expect(validated.tools).toEqual(['file_read', 'bash']);
      expect(validated.toolPolicies).toEqual({ bash: 'ask' });
    });

    it('should reject invalid session configuration', () => {
      const invalidConfig = {
        providerInstanceId: 'invalid-provider-instance',
        maxTokens: -100,
        temperature: 5.0,
      };

      expect(() => {
        Session.validateConfiguration(invalidConfig);
      }).toThrow('Configuration validation failed');
    });
  });

  describe('Session configuration inheritance', () => {
    it('should inherit configuration from project', async () => {
      // Create session with minimal configuration to allow inheritance
      const session = Session.create({
        name: 'Test Session',
        projectId,
        configuration: {
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        },
      });

      const effectiveConfig = session.getEffectiveConfiguration();

      // Should inherit from project
      expect(effectiveConfig.providerInstanceId).toBe(providerInstanceId);
      // Note: Session creation modelId parameter overrides project modelId
      expect(effectiveConfig.modelId).toBe('claude-3-5-haiku-20241022'); // From session creation
      expect(effectiveConfig.maxTokens).toBe(4000); // From project

      await cleanupSession(session);
    });

    it('should override project configuration with session configuration', async () => {
      const session = Session.create({
        name: 'Test Session',
        projectId,
        configuration: {
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        },
      });

      // Update session configuration
      session.updateConfiguration({
        modelId: 'claude-3-5-haiku-20241022',
        temperature: 0.8,
        systemPrompt: 'You are a code reviewer.',
      });

      const effectiveConfig = session.getEffectiveConfiguration();

      // Should have session overrides
      expect(effectiveConfig.modelId).toBe('claude-3-5-haiku-20241022'); // Session override
      expect(effectiveConfig.temperature).toBe(0.8); // Session override
      expect(effectiveConfig.systemPrompt).toBe('You are a code reviewer.'); // Session override
      expect(effectiveConfig.maxTokens).toBe(4000); // From project

      await cleanupSession(session);
    });

    it('should merge tool policies correctly', async () => {
      // Set project tool policies
      testProject.updateConfiguration({
        toolPolicies: {
          file_read: 'allow',
          bash: 'ask',
        },
      });

      const session = Session.create({
        name: 'Test Session',
        projectId,
        configuration: {
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        },
      });

      // Update session tool policies
      session.updateConfiguration({
        toolPolicies: {
          bash: 'allow', // Override project policy
          file_write: 'ask', // Add new policy
        },
      });

      const effectiveConfig = session.getEffectiveConfiguration();

      expect(effectiveConfig.toolPolicies).toEqual({
        file_read: 'allow', // From project
        bash: 'allow', // Overridden by session
        file_write: 'ask', // Added by session
      });

      await cleanupSession(session);
    });
  });

  describe('Configuration preset integration', () => {
    it('should apply configuration preset to session', async () => {
      // Create a preset
      presetManager.savePreset(
        'code-review',
        {
          modelId: 'claude-3-sonnet',
          temperature: 0.2,
          maxTokens: 8000,
          systemPrompt: 'You are a senior software engineer conducting code reviews.',
          tools: ['file_read', 'file_write', 'bash'],
          toolPolicies: {
            file_write: 'ask',
            bash: 'ask',
          },
        },
        {
          name: 'Code Review',
          description: 'Configuration optimized for code review tasks',
        }
      );

      const preset = presetManager.getPreset('code-review');
      expect(preset).toBeDefined();

      // Apply preset to session
      const session = Session.create({
        name: 'Test Session',
        projectId,
        configuration: {
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        },
      });
      session.updateConfiguration(preset!.configuration);

      const effectiveConfig = session.getEffectiveConfiguration();

      expect(effectiveConfig.modelId).toBe('claude-3-sonnet');
      expect(effectiveConfig.temperature).toBe(0.2);
      expect(effectiveConfig.maxTokens).toBe(8000);
      expect(effectiveConfig.systemPrompt).toBe(
        'You are a senior software engineer conducting code reviews.'
      );
      expect(effectiveConfig.tools).toEqual(['file_read', 'file_write', 'bash']);
      expect(effectiveConfig.toolPolicies).toEqual({
        file_write: 'ask',
        bash: 'ask',
      });

      await cleanupSession(session);
    });
  });

  describe('Tool policy enforcement', () => {
    it('should return correct tool policies from configuration', async () => {
      const session = Session.create({
        name: 'Test Session',
        projectId,
        configuration: {
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        },
      });

      // Set tool policies
      session.updateConfiguration({
        toolPolicies: {
          file_read: 'allow',
          bash: 'ask',
          file_write: 'deny',
        },
      });

      expect(session.getToolPolicy('file_read')).toBe('allow');
      expect(session.getToolPolicy('bash')).toBe('ask');
      expect(session.getToolPolicy('file_write')).toBe('deny');
      expect(session.getToolPolicy('unknown-tool')).toBe('ask'); // Default

      await cleanupSession(session);
    });
  });

  describe('Session working directory', () => {
    it('should use session working directory override', async () => {
      const session = Session.create({
        name: 'Test Session',
        projectId,
        configuration: {
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        },
      });

      // Set working directory override
      session.updateConfiguration({
        workingDirectory: '/custom/working/directory',
      });

      expect(session.getWorkingDirectory()).toBe('/custom/working/directory');

      await cleanupSession(session);
    });

    it('should fall back to project working directory', async () => {
      const session = Session.create({
        name: 'Test Session',
        projectId,
        configuration: {
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        },
      });

      // Should use project working directory
      expect(session.getWorkingDirectory()).toBe('/test/path');

      await cleanupSession(session);
    });
  });

  describe('Session metadata', () => {
    it('should include configuration in session info', async () => {
      const session = Session.create({
        name: 'Test Session',
        projectId,
        configuration: {
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        },
      });

      const info = session.getInfo();
      expect(info).toBeDefined();
      expect(info?.name).toBe('Test Session');

      await cleanupSession(session);
    });
  });
});
