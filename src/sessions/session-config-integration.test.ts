// ABOUTME: Integration tests for Session class with new configuration system
// ABOUTME: Tests session creation with configuration and preset integration

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { ConfigurationPresetManager, SessionConfiguration } from '~/sessions/session-config';
import { setupCoreTest } from '~/test-utils/core-test-setup';
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
        tools: ['file-read', 'bash'],
        toolPolicies: {
          bash: 'require-approval',
        },
      };

      const validated = Session.validateConfiguration(validConfig);
      expect(validated.providerInstanceId).toBe('openai-default');
      expect(validated.modelId).toBe('gpt-4');
      expect(validated.maxTokens).toBe(8000);
      expect(validated.temperature).toBe(0.7);
      expect(validated.systemPrompt).toBe('You are a helpful assistant.');
      expect(validated.tools).toEqual(['file-read', 'bash']);
      expect(validated.toolPolicies).toEqual({ bash: 'require-approval' });
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
    it('should inherit configuration from project', () => {
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

      session.destroy();
    });

    it('should override project configuration with session configuration', () => {
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

      session.destroy();
    });

    it('should merge tool policies correctly', () => {
      // Set project tool policies
      testProject.updateConfiguration({
        toolPolicies: {
          'file-read': 'allow',
          bash: 'require-approval',
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
          'file-write': 'require-approval', // Add new policy
        },
      });

      const effectiveConfig = session.getEffectiveConfiguration();

      expect(effectiveConfig.toolPolicies).toEqual({
        'file-read': 'allow', // From project
        bash: 'allow', // Overridden by session
        'file-write': 'require-approval', // Added by session
      });

      session.destroy();
    });
  });

  describe('Configuration preset integration', () => {
    it('should apply configuration preset to session', () => {
      // Create a preset
      presetManager.savePreset(
        'code-review',
        {
          modelId: 'claude-3-sonnet',
          temperature: 0.2,
          maxTokens: 8000,
          systemPrompt: 'You are a senior software engineer conducting code reviews.',
          tools: ['file-read', 'file-write', 'bash'],
          toolPolicies: {
            'file-write': 'require-approval',
            bash: 'require-approval',
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
      expect(effectiveConfig.tools).toEqual(['file-read', 'file-write', 'bash']);
      expect(effectiveConfig.toolPolicies).toEqual({
        'file-write': 'require-approval',
        bash: 'require-approval',
      });

      session.destroy();
    });
  });

  describe('Tool policy enforcement', () => {
    it('should return correct tool policies from configuration', () => {
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
          'file-read': 'allow',
          bash: 'require-approval',
          'file-write': 'deny',
        },
      });

      expect(session.getToolPolicy('file-read')).toBe('allow');
      expect(session.getToolPolicy('bash')).toBe('require-approval');
      expect(session.getToolPolicy('file-write')).toBe('deny');
      expect(session.getToolPolicy('unknown-tool')).toBe('require-approval'); // Default

      session.destroy();
    });
  });

  describe('Session working directory', () => {
    it('should use session working directory override', () => {
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

      session.destroy();
    });

    it('should fall back to project working directory', () => {
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

      session.destroy();
    });
  });

  describe('Session metadata', () => {
    it('should include configuration in session info', () => {
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

      session.destroy();
    });
  });
});
