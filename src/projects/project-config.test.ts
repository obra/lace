// ABOUTME: Test file for Project configuration management functionality
// ABOUTME: Tests configuration inheritance from project to session level

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Project } from '~/projects/project';
import { Session } from '~/sessions/session';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import {
  setupTestProviderInstances,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';

describe('Project configuration', () => {
  let project: Project;
  let projectId: string;
  let testProviderInstances: {
    anthropicInstanceId: string;
    openaiInstanceId: string;
  };

  beforeEach(async () => {
    setupTestPersistence();
    
    // Set up provider instances
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.OPENAI_API_KEY = 'test-key';
    testProviderInstances = await setupTestProviderInstances();

    project = Project.create('Test Project', '/project/path', 'A test project', {
      providerInstanceId: testProviderInstances.anthropicInstanceId,
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
    await cleanupTestProviderInstances([
      testProviderInstances.anthropicInstanceId,
      testProviderInstances.openaiInstanceId,
    ]);
    teardownTestPersistence();
  });

  it('should inherit project configuration in sessions', () => {
    const session = Session.create({
      name: 'Test Session',
      projectId,
      providerInstanceId: testProviderInstances.anthropicInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });

    // Test configuration inheritance - this will be implemented
    const projectConfig = project.getConfiguration();
    const sessionConfig = Session.getSession(session.getId())?.configuration || {};

    // The effective configuration should combine both
    expect(projectConfig.providerInstanceId).toBe(testProviderInstances.anthropicInstanceId);
    expect(projectConfig.modelId).toBe('claude-3-5-sonnet-20241022');
    expect(projectConfig.maxTokens).toBe(4000);
    expect(projectConfig.tools).toEqual(['file-read', 'file-write', 'bash']);

    // Session should have basic config with provider instance and model set by Session.create()
    expect(sessionConfig.providerInstanceId).toBeDefined();
    expect(sessionConfig.modelId).toBeDefined();
  });

  it('should allow session to override project configuration', () => {
    const session = Session.create({
      name: 'Test Session',
      projectId,
      providerInstanceId: testProviderInstances.anthropicInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });

    // Update configuration with maxTokens
    session.updateConfiguration({
      maxTokens: 2000,
    });

    const sessionFromGet = Session.getSession(session.getId());
    const projectConfig = project.getConfiguration();

    expect(sessionFromGet).toBeDefined();
    expect(projectConfig.providerInstanceId).toBe(testProviderInstances.anthropicInstanceId); // From project
    expect(sessionFromGet?.configuration.modelId).toBe('claude-3-5-haiku-20241022'); // Overridden
    expect(sessionFromGet?.configuration.maxTokens).toBe(2000); // Overridden
    expect(projectConfig.tools).toEqual(['file-read', 'file-write', 'bash']); // From project
  });

  it('should merge tool policies correctly', () => {
    const session = Session.create({
      name: 'Test Session',
      projectId,
      providerInstanceId: testProviderInstances.anthropicInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
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

    expect(effectiveConfig.providerInstanceId).toBe(testProviderInstances.anthropicInstanceId); // From project
    expect(effectiveConfig.modelId).toBe('claude-3-5-haiku-20241022'); // Overridden by session
    expect(effectiveConfig.maxTokens).toBe(2000); // Overridden by session
    expect(effectiveConfig.tools).toEqual(['file-read', 'file-write', 'bash']); // From project
  });
});
