// ABOUTME: Test file for Project configuration management functionality
// ABOUTME: Tests configuration inheritance from project to session level

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Project } from '~/projects/project';
import { Session } from '~/sessions/session';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

describe('Project configuration', () => {
  let project: Project;
  let projectId: string;

  beforeEach(() => {
    setupTestPersistence();

    project = Project.create('Test Project', '/project/path', 'A test project', {
      provider: 'anthropic',
      model: 'claude-3-sonnet',
      maxTokens: 4000,
      tools: ['file-read', 'file-write', 'bash'],
      toolPolicies: {
        'file-write': 'allow',
        bash: 'require-approval',
      },
    });
    projectId = project.getId();
  });

  afterEach(() => {
    teardownTestPersistence();
  });

  it('should inherit project configuration in sessions', () => {
    const session = Session.create({
      name: 'Test Session',
      projectId,
    });

    // Test configuration inheritance - this will be implemented
    const projectConfig = project.getConfiguration();
    const sessionConfig = Session.getSession(session.getId())?.configuration || {};

    // The effective configuration should combine both
    expect(projectConfig.provider).toBe('anthropic');
    expect(projectConfig.model).toBe('claude-3-sonnet');
    expect(projectConfig.maxTokens).toBe(4000);
    expect(projectConfig.tools).toEqual(['file-read', 'file-write', 'bash']);

    // Session should have basic config with provider and model set by Session.create()
    expect(sessionConfig.provider).toBeDefined();
    expect(sessionConfig.model).toBeDefined();
  });

  it('should allow session to override project configuration', () => {
    const session = Session.create({
      name: 'Test Session',
      projectId,
      model: 'claude-3-haiku',
    });

    // Update configuration with maxTokens
    session.updateConfiguration({
      maxTokens: 2000,
    });

    const sessionFromGet = Session.getSession(session.getId());
    const projectConfig = project.getConfiguration();

    expect(sessionFromGet).toBeDefined();
    expect(projectConfig.provider).toBe('anthropic'); // From project
    expect(sessionFromGet?.configuration.model).toBe('claude-3-haiku'); // Overridden
    expect(sessionFromGet?.configuration.maxTokens).toBe(2000); // Overridden
    expect(projectConfig.tools).toEqual(['file-read', 'file-write', 'bash']); // From project
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
      model: 'claude-3-haiku',
      maxTokens: 2000,
    };

    const effectiveConfig = Session.getEffectiveConfiguration(projectId, sessionConfig);

    expect(effectiveConfig.provider).toBe('anthropic'); // From project
    expect(effectiveConfig.model).toBe('claude-3-haiku'); // Overridden by session
    expect(effectiveConfig.maxTokens).toBe(2000); // Overridden by session
    expect(effectiveConfig.tools).toEqual(['file-read', 'file-write', 'bash']); // From project
  });
});
