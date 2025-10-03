// ABOUTME: Test file for Project configuration management functionality
// ABOUTME: Tests configuration inheritance from project to session level

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdirSync } from 'fs';
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
describe('Project configuration', () => {
  const context = setupCoreTest();
  let tempProjectDir: string;
  let project: Project;
  let projectId: string;
  let providerInstanceId: string;

  beforeEach(async () => {
    setupTestProviderDefaults();

    // Create a real provider instance for testing
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
      displayName: 'Test Project Config Instance',
      apiKey: 'test-anthropic-key',
    });

    // Create temp project directory
    tempProjectDir = join(context.tempDir, 'test-project');
    mkdirSync(tempProjectDir, { recursive: true });

    project = Project.create('Test Project', tempProjectDir, 'A test project', {
      providerInstanceId,
      modelId: 'claude-3-5-sonnet-20241022',
      maxTokens: 4000,
      tools: ['file_read', 'file_write', 'bash'],
      toolPolicies: {
        file_write: 'allow',
        bash: 'ask',
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
    expect(projectConfig.tools).toEqual(['file_read', 'file_write', 'bash']);

    // Test that session can calculate effective configuration (runtime-evaluated)
    const effectiveConfig = session.getEffectiveConfiguration();
    expect(effectiveConfig.providerInstanceId).toBe(providerInstanceId); // Inherited from project
    expect(effectiveConfig.modelId).toBe('claude-3-5-sonnet-20241022'); // Inherited from project
    expect(effectiveConfig.maxTokens).toBe(4000); // Inherited from project
    expect(effectiveConfig.tools).toEqual(['file_read', 'file_write', 'bash']); // Inherited from project

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
    expect(projectConfig.tools).toEqual(['file_read', 'file_write', 'bash']);

    // Verify the session has the override stored
    const sessionFromGet = Session.getSession(session.getId());
    expect(sessionFromGet).toBeDefined();
    expect(sessionFromGet?.configuration.maxTokens).toBe(2000); // Overridden value

    // Verify the effective configuration merges project + session
    const effectiveConfig = session.getEffectiveConfiguration();
    expect(effectiveConfig.providerInstanceId).toBe(providerInstanceId); // From project
    expect(effectiveConfig.modelId).toBe('claude-3-5-sonnet-20241022'); // From project
    expect(effectiveConfig.maxTokens).toBe(2000); // Overridden by session
    expect(effectiveConfig.tools).toEqual(['file_read', 'file_write', 'bash']); // From project
  });

  it('should merge tool policies correctly', () => {
    const session = Session.create({
      name: 'Test Session',
      projectId,
    });

    // Update configuration with toolPolicies
    session.updateConfiguration({
      toolPolicies: {
        file_write: 'ask', // Override
        url_fetch: 'allow', // Add new
      },
    });

    const sessionFromGet = Session.getSession(session.getId());
    const projectConfig = project.getConfiguration();

    expect(sessionFromGet).toBeDefined();
    expect(sessionFromGet?.configuration.toolPolicies).toEqual({
      file_write: 'ask', // Overridden
      url_fetch: 'allow', // Added
    });
    expect(projectConfig.toolPolicies).toEqual({
      file_write: 'allow', // From project (original)
      bash: 'ask', // From project
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
    expect(effectiveConfig.tools).toEqual(['file_read', 'file_write', 'bash']); // From project
  });
});
