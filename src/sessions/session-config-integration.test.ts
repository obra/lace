// ABOUTME: Integration tests for Session class with new configuration system
// ABOUTME: Tests session creation with configuration and preset integration

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { ConfigurationPresetManager, SessionConfiguration } from '~/sessions/session-config';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

// Mock external dependencies
vi.mock('~/providers/registry', () => ({
  ProviderRegistry: {
    createWithAutoDiscovery: vi.fn().mockReturnValue({
      createProvider: vi.fn().mockReturnValue({
        type: 'anthropic',
        model: 'claude-3-haiku-20240307',
        providerName: 'anthropic',
        defaultModel: 'claude-3-haiku-20240307',
        setSystemPrompt: vi.fn(),
        createResponse: vi.fn().mockResolvedValue({
          content: 'Mock response',
          toolCalls: [],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        }),
      }),
    }),
  },
}));

// Mock external dependencies that require system calls or network access
// - File system operations are mocked to avoid disk I/O during tests
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
  },
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
}));

// - Process operations are mocked to avoid spawning real processes
vi.mock('child_process', () => ({
  default: {
    spawn: vi.fn(),
    exec: vi.fn(),
  },
  spawn: vi.fn(),
  exec: vi.fn(),
}));

// - Network operations are mocked to avoid external requests
vi.mock('node-fetch', () => vi.fn());

describe('Session Configuration Integration', () => {
  let testProject: Project;
  let projectId: string;
  let presetManager: ConfigurationPresetManager;

  beforeEach(() => {
    setupTestPersistence();

    // Create a test project
    testProject = Project.create('Test Project', '/test/path', 'Test project for configuration', {
      provider: 'anthropic',
      model: 'claude-3-sonnet',
      maxTokens: 4000,
    });
    projectId = testProject.getId();

    presetManager = new ConfigurationPresetManager();
  });

  afterEach(() => {
    teardownTestPersistence();
  });

  describe('Session configuration validation', () => {
    it('should validate session configuration during creation', () => {
      const validConfig: SessionConfiguration = {
        provider: 'openai',
        model: 'gpt-4',
        maxTokens: 8000,
        temperature: 0.7,
        systemPrompt: 'You are a helpful assistant.',
        tools: ['file-read', 'bash'],
        toolPolicies: {
          bash: 'require-approval',
        },
      };

      const validated = Session.validateConfiguration(validConfig);
      expect(validated.provider).toBe('openai');
      expect(validated.model).toBe('gpt-4');
      expect(validated.maxTokens).toBe(8000);
      expect(validated.temperature).toBe(0.7);
      expect(validated.systemPrompt).toBe('You are a helpful assistant.');
      expect(validated.tools).toEqual(['file-read', 'bash']);
      expect(validated.toolPolicies).toEqual({ bash: 'require-approval' });
    });

    it('should reject invalid session configuration', () => {
      const invalidConfig = {
        provider: 'invalid-provider',
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
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId,
      });

      const effectiveConfig = session.getEffectiveConfiguration();

      // Should inherit from project
      expect(effectiveConfig.provider).toBe('anthropic');
      // Note: Session creation model parameter overrides project model
      expect(effectiveConfig.model).toBe('claude-3-haiku-20240307'); // From session creation
      expect(effectiveConfig.maxTokens).toBe(4000); // From project

      session.destroy();
    });

    it('should override project configuration with session configuration', () => {
      const session = Session.create({
        name: 'Test Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId,
      });

      // Update session configuration
      session.updateConfiguration({
        model: 'claude-3-haiku-20240307',
        temperature: 0.8,
        systemPrompt: 'You are a code reviewer.',
      });

      const effectiveConfig = session.getEffectiveConfiguration();

      // Should have session overrides
      expect(effectiveConfig.model).toBe('claude-3-haiku-20240307'); // Session override
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
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId,
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
          model: 'claude-3-sonnet',
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
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId,
      });
      session.updateConfiguration(preset!.configuration);

      const effectiveConfig = session.getEffectiveConfiguration();

      expect(effectiveConfig.model).toBe('claude-3-sonnet');
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
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId,
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
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId,
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
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId,
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
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        projectId,
      });

      const info = session.getInfo();
      expect(info).toBeDefined();
      expect(info?.name).toBe('Test Session');
      expect(info?.provider).toBe('anthropic');

      session.destroy();
    });
  });
});
