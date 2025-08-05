// ABOUTME: Tests for Agent configuration with hierarchical inheritance
// ABOUTME: Tests agent-specific configuration, role-based settings, and capability management

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { AgentConfiguration, ConfigurationValidator } from '~/sessions/session-config';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';
import { ApprovalDecision } from '~/tools/approval-types';

describe('Agent Configuration', () => {
  const _tempLaceDir = setupCoreTest();
  const _tempDirContext = useTempLaceDir();
  let testProject: Project;
  let testSession: Session;
  let projectId: string;
  let providerInstanceId: string;

  beforeEach(async () => {
    setupTestProviderDefaults();

    // Create a real provider instance for testing
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Agent Config Instance',
      apiKey: 'test-anthropic-key',
    });

    // Create test project
    testProject = Project.create('Test Project', '/test/path', 'Test project for agent config', {
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      maxTokens: 4000,
      temperature: 0.5,
    });
    projectId = testProject.getId();

    // Create test session
    testSession = Session.create({
      name: 'Test Session',
      projectId,
      approvalCallback: {
        requestApproval: async () => Promise.resolve(ApprovalDecision.ALLOW_ONCE),
      },
    });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    testSession?.destroy();
    cleanupTestProviderDefaults();
    // Test cleanup handled by setupCoreTest
    if (providerInstanceId) {
      await cleanupTestProviderInstances([providerInstanceId]);
    }
  });

  describe('Agent configuration validation', () => {
    it('should validate valid agent configuration', () => {
      const config: AgentConfiguration = {
        role: 'code-reviewer',
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
        temperature: 0.1,
        capabilities: ['code-analysis', 'security-review'],
        restrictions: ['no-file-write'],
        memorySize: 1000,
        conversationHistory: 50,
        systemPrompt: 'You are a senior code reviewer.',
        tools: ['file-read', 'bash'],
        toolPolicies: {
          bash: 'require-approval',
        },
      };

      const validated = ConfigurationValidator.validateAgentConfiguration(config);
      expect(validated.role).toBe('code-reviewer');
      expect(validated.capabilities).toEqual(['code-analysis', 'security-review']);
      expect(validated.restrictions).toEqual(['no-file-write']);
      expect(validated.memorySize).toBe(1000);
      expect(validated.conversationHistory).toBe(50);
      expect(validated.systemPrompt).toBe('You are a senior code reviewer.');
      expect(validated.tools).toEqual(['file-read', 'bash']);
      expect(validated.toolPolicies).toEqual({ bash: 'require-approval' });
    });

    it('should reject invalid agent configuration', () => {
      const config = {
        memorySize: -50,
        conversationHistory: 0,
        temperature: 3.0,
      };

      expect(() => {
        ConfigurationValidator.validateAgentConfiguration(config);
      }).toThrow('Agent configuration validation failed');
    });
  });

  describe('Agent configuration inheritance', () => {
    it('should inherit configuration from session and project', () => {
      // Update session configuration
      testSession.updateConfiguration({
        temperature: 0.8,
        systemPrompt: 'You are a helpful assistant.',
        tools: ['file-read', 'file-write'],
      });

      // Spawn agent with specific configuration
      const agent = testSession.spawnAgent({ name: 'Test Agent' });

      // Agent should have configuration methods
      expect(agent).toBeDefined();
      expect(agent.threadId).toBeDefined();

      // Agent should have effective configuration that inherits from session
      const config = agent.getEffectiveConfiguration();
      expect(config.temperature).toBe(0.8);
      expect(config.systemPrompt).toBe('You are a helpful assistant.');
      expect(config.tools).toEqual(['file-read', 'file-write']);
    });

    it('should override session configuration with agent-specific settings', () => {
      // Update session configuration
      testSession.updateConfiguration({
        temperature: 0.5,
        systemPrompt: 'You are a helpful assistant.',
        toolPolicies: {
          'file-read': 'allow',
          bash: 'require-approval',
        },
      });

      // Create agent with role-specific configuration
      const agent = testSession.spawnAgent({
        name: 'Code Reviewer',
      });

      // Update agent configuration with role-specific settings
      agent.updateConfiguration({
        temperature: 0.2,
        systemPrompt: 'You are a senior code reviewer.',
        toolPolicies: {
          'file-read': 'allow',
          bash: 'deny', // Override session policy
        },
      });

      // Agent should have updated configuration
      const config = agent.getEffectiveConfiguration();
      expect(config.temperature).toBe(0.2); // Agent override
      expect(config.systemPrompt).toBe('You are a senior code reviewer.'); // Agent override
      expect(config.toolPolicies).toEqual({
        'file-read': 'allow',
        bash: 'deny', // Agent override
      });
    });
  });

  describe('Role-based configuration', () => {
    it('should support role-based agent configuration', () => {
      const agent = testSession.spawnAgent({
        name: 'Code Reviewer',
      });

      // Configure agent with role-based settings
      agent.updateConfiguration({
        role: 'code-reviewer',
        capabilities: ['code-analysis', 'security-review'],
        restrictions: ['no-file-write'],
        temperature: 0.1,
      });

      // Agent should have role-based configuration
      const config = agent.getEffectiveConfiguration();
      expect(config.role).toBe('code-reviewer');
      expect(config.capabilities).toEqual(['code-analysis', 'security-review']);
      expect(config.restrictions).toEqual(['no-file-write']);
      expect(config.temperature).toBe(0.1);
    });

    it('should support capabilities and restrictions', () => {
      const agent = testSession.spawnAgent({
        name: 'Security Agent',
      });

      // Configure agent with capabilities and restrictions
      agent.updateConfiguration({
        capabilities: ['security-analysis', 'vulnerability-scanning'],
        restrictions: ['no-file-write', 'no-bash'],
        toolPolicies: {
          'file-read': 'allow',
          bash: 'deny',
          'file-write': 'deny',
        },
      });

      // Agent should have capabilities and restrictions
      const config = agent.getEffectiveConfiguration();
      expect(config.capabilities).toEqual(['security-analysis', 'vulnerability-scanning']);
      expect(config.restrictions).toEqual(['no-file-write', 'no-bash']);
      expect(config.toolPolicies).toEqual({
        'file-read': 'allow',
        bash: 'deny',
        'file-write': 'deny',
      });
    });
  });

  describe('Agent configuration methods', () => {
    it('should provide method to get agent configuration', () => {
      const agent = testSession.spawnAgent({ name: 'Test Agent' });

      // Update agent configuration
      agent.updateConfiguration({
        temperature: 0.3,
        role: 'assistant',
        capabilities: ['general-help'],
      });

      // Agent should have configuration methods
      expect(typeof agent.getConfiguration).toBe('function');
      expect(typeof agent.getEffectiveConfiguration).toBe('function');
      expect(typeof agent.updateConfiguration).toBe('function');

      // Get configuration should return agent-specific settings
      const config = agent.getConfiguration();
      expect(config.temperature).toBe(0.3);
      expect(config.role).toBe('assistant');
      expect(config.capabilities).toEqual(['general-help']);
    });

    it('should provide method to get effective configuration', () => {
      // Update session configuration
      testSession.updateConfiguration({
        temperature: 0.7,
        systemPrompt: 'You are a helpful assistant.',
        tools: ['file-read', 'bash'],
      });

      const agent = testSession.spawnAgent({ name: 'Test Agent' });

      // Update agent configuration partially
      agent.updateConfiguration({
        temperature: 0.2, // Override session
        role: 'specialist', // Add agent-specific
      });

      // Effective configuration should merge session and agent
      const effective = agent.getEffectiveConfiguration();
      expect(effective.temperature).toBe(0.2); // Agent override
      expect(effective.systemPrompt).toBe('You are a helpful assistant.'); // From session
      expect(effective.tools).toEqual(['file-read', 'bash']); // From session
      expect(effective.role).toBe('specialist'); // Agent-specific
    });

    it('should provide method to update agent configuration', () => {
      const agent = testSession.spawnAgent({ name: 'Test Agent' });

      // Update configuration multiple times
      agent.updateConfiguration({
        temperature: 0.5,
        role: 'initial',
      });

      let config = agent.getConfiguration();
      expect(config.temperature).toBe(0.5);
      expect(config.role).toBe('initial');

      // Update again
      agent.updateConfiguration({
        temperature: 0.8,
        capabilities: ['new-capability'],
      });

      config = agent.getConfiguration();
      expect(config.temperature).toBe(0.8); // Updated
      expect(config.role).toBe('initial'); // Preserved
      expect(config.capabilities).toEqual(['new-capability']); // Added
    });
  });

  describe('Agent role and capabilities', () => {
    it('should store and retrieve agent role', () => {
      const agent = testSession.spawnAgent({
        name: 'Security Analyst',
      });

      // Configure agent role
      agent.updateConfiguration({
        role: 'security-analyst',
        systemPrompt: 'You are a security analyst.',
      });

      // Agent should have role in configuration
      const config = agent.getEffectiveConfiguration();
      expect(config.role).toBe('security-analyst');
      expect(config.systemPrompt).toBe('You are a security analyst.');

      // Check that agent metadata includes the name
      const metadata = agent.getThreadMetadata();
      expect(metadata?.name).toBe('Security Analyst');
    });

    it('should manage agent capabilities', () => {
      const agent = testSession.spawnAgent({
        name: 'Data Analyst',
      });

      // Configure agent capabilities
      agent.updateConfiguration({
        capabilities: ['data-analysis', 'visualization', 'statistics'],
        memorySize: 2000,
        conversationHistory: 100,
      });

      // Agent should have capabilities in configuration
      const config = agent.getEffectiveConfiguration();
      expect(config.capabilities).toEqual(['data-analysis', 'visualization', 'statistics']);
      expect(config.memorySize).toBe(2000);
      expect(config.conversationHistory).toBe(100);
    });

    it('should enforce agent restrictions', () => {
      const agent = testSession.spawnAgent({
        name: 'Read-Only Agent',
      });

      // Configure agent restrictions
      agent.updateConfiguration({
        restrictions: ['no-file-write', 'no-bash', 'read-only'],
        toolPolicies: {
          'file-read': 'allow',
          'file-write': 'deny',
          bash: 'deny',
        },
      });

      // Agent should have restrictions in configuration
      const config = agent.getEffectiveConfiguration();
      expect(config.restrictions).toEqual(['no-file-write', 'no-bash', 'read-only']);
      expect(config.toolPolicies).toEqual({
        'file-read': 'allow',
        'file-write': 'deny',
        bash: 'deny',
      });
    });
  });
});
