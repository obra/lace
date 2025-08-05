// ABOUTME: Test file for Project configuration management functionality
// ABOUTME: Tests configuration inheritance from project to session level

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Project } from '~/projects/project';
import { Session } from '~/sessions/session';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';

describe('Project configuration', () => {
  const _tempDirContext = useTempLaceDir();
  let project: Project;
  let projectId: string;
  let providerInstanceId: string;

  beforeEach(async () => {
    // setupTestPersistence replaced by setupCoreTest
    setupTestProviderDefaults();
    Session.clearProviderCache();

    // Create a real provider instance for testing
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
      displayName: 'Test Project Config Instance',
      apiKey: 'test-anthropic-key',
    });

    project = Project.create('Test Project', '/project/path', 'A test project', {
      providerInstanceId,
      modelId: 'claude-3-5-sonnet-20241022',
      maxTokens: 4000,
      tools: ['file-read', 'file-write', 'bash'],
      toolPolicies: {
        'file-write': 'allow',
        bash: 'require-approval',
      },
    });
    projectId = project.getId();
  });

  afterEach(async () => {
    cleanupTestProviderDefaults();
    // Test cleanup handled by setupCoreTest
    if (providerInstanceId) {
      await cleanupTestProviderInstances([providerInstanceId]);
    }
  });

  it('should inherit project configuration in sessions', () => {
    const session = Session.create({
      name: 'Test Session',
      projectId,
    });

    // Test configuration inheritance at project level
    const projectConfig = project.getConfiguration();
    expect(projectConfig.providerInstanceId).toBe(providerInstanceId);
    expect(projectConfig.modelId).toBe('claude-3-5-sonnet-20241022');
    expect(projectConfig.maxTokens).toBe(4000);
    expect(projectConfig.tools).toEqual(['file-read', 'file-write', 'bash']);

    // Test that session can calculate effective configuration (runtime-evaluated)
    const effectiveConfig = session.getEffectiveConfiguration();
    expect(effectiveConfig.providerInstanceId).toBe(providerInstanceId); // Inherited from project
    expect(effectiveConfig.modelId).toBe('claude-3-5-sonnet-20241022'); // Inherited from project
    expect(effectiveConfig.maxTokens).toBe(4000); // Inherited from project
    expect(effectiveConfig.tools).toEqual(['file-read', 'file-write', 'bash']); // Inherited from project

    // Session configuration should be empty (no overrides)
    const sessionConfig = Session.getSession(session.getId())?.configuration || {};
    expect(Object.keys(sessionConfig)).toHaveLength(0);
  });

  it('should allow session to override project configuration', () => {
    const session = Session.create({
      name: 'Test Session',
      projectId,
    });

    // Update configuration with maxTokens override
    session.updateConfiguration({
      maxTokens: 2000,
    });

    // Verify the project configuration remains unchanged
    const projectConfig = project.getConfiguration();
    expect(projectConfig.providerInstanceId).toBe(providerInstanceId);
    expect(projectConfig.modelId).toBe('claude-3-5-sonnet-20241022');
    expect(projectConfig.maxTokens).toBe(4000); // Original project value
    expect(projectConfig.tools).toEqual(['file-read', 'file-write', 'bash']);

    // Verify the session has the override stored
    const sessionFromGet = Session.getSession(session.getId());
    expect(sessionFromGet).toBeDefined();
    expect(sessionFromGet?.configuration.maxTokens).toBe(2000); // Overridden value

    // Verify the effective configuration merges project + session
    const effectiveConfig = session.getEffectiveConfiguration();
    expect(effectiveConfig.providerInstanceId).toBe(providerInstanceId); // From project
    expect(effectiveConfig.modelId).toBe('claude-3-5-sonnet-20241022'); // From project
    expect(effectiveConfig.maxTokens).toBe(2000); // Overridden by session
    expect(effectiveConfig.tools).toEqual(['file-read', 'file-write', 'bash']); // From project
  });

  it('should merge tool policies correctly', () => {
    const session = Session.create({
      name: 'Test Session',
      projectId,
    });

    // Update configuration with toolPolicies
    session.updateConfiguration({
      toolPolicies: {
        'file-write': 'require-approval', // Override
        'url-fetch': 'allow', // Add new
      },
    });

    const sessionFromGet = Session.getSession(session.getId());
    const projectConfig = project.getConfiguration();

    expect(sessionFromGet).toBeDefined();
    expect(sessionFromGet?.configuration.toolPolicies).toEqual({
      'file-write': 'require-approval', // Overridden
      'url-fetch': 'allow', // Added
    });
    expect(projectConfig.toolPolicies).toEqual({
      'file-write': 'allow', // From project (original)
      bash: 'require-approval', // From project
    });
  });

  it('should validate configuration schema', () => {
    expect(() => {
      Session.validateConfiguration({
        maxTokens: 'invalid', // Should be number
      });
    }).toThrow('Configuration validation failed');
  });

  it('should merge configurations with session overriding project', () => {
    const sessionConfig = {
      modelId: 'claude-3-5-haiku-20241022',
      maxTokens: 2000,
    };

    const effectiveConfig = Session.getEffectiveConfiguration(projectId, sessionConfig);

    expect(effectiveConfig.providerInstanceId).toBe(providerInstanceId); // From project
    expect(effectiveConfig.modelId).toBe('claude-3-5-haiku-20241022'); // Overridden by session
    expect(effectiveConfig.maxTokens).toBe(2000); // Overridden by session
    expect(effectiveConfig.tools).toEqual(['file-read', 'file-write', 'bash']); // From project
  });
});
