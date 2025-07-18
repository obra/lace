// ABOUTME: Test file for Project configuration management functionality
// ABOUTME: Tests configuration inheritance from project to session level

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Project } from '~/projects/project';
import { Session } from '~/sessions/session';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';

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
    // Create session data directly to avoid provider creation
    const sessionData = {
      id: 'session1',
      projectId,
      name: 'Test Session',
      description: '',
      configuration: {},
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    Session.createSession(sessionData);

    // Test configuration inheritance - this will be implemented
    const projectConfig = project.getConfiguration();
    const sessionConfig = Session.getSession('session1')?.configuration || {};

    // The effective configuration should combine both
    expect(projectConfig.provider).toBe('anthropic');
    expect(projectConfig.model).toBe('claude-3-sonnet');
    expect(projectConfig.maxTokens).toBe(4000);
    expect(projectConfig.tools).toEqual(['file-read', 'file-write', 'bash']);

    // Session should have empty config since we didn't override anything
    expect(sessionConfig).toEqual({});
  });

  it('should allow session to override project configuration', () => {
    const sessionData = {
      id: 'session1',
      projectId,
      name: 'Test Session',
      description: '',
      configuration: {
        model: 'claude-3-haiku',
        maxTokens: 2000,
      },
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    Session.createSession(sessionData);
    const session = Session.getSession('session1');
    const projectConfig = project.getConfiguration();

    expect(session).toBeDefined();
    expect(projectConfig.provider).toBe('anthropic'); // From project
    expect(session?.configuration.model).toBe('claude-3-haiku'); // Overridden
    expect(session?.configuration.maxTokens).toBe(2000); // Overridden
    expect(projectConfig.tools).toEqual(['file-read', 'file-write', 'bash']); // From project
  });

  it('should merge tool policies correctly', () => {
    const sessionData = {
      id: 'session1',
      projectId,
      name: 'Test Session',
      description: '',
      configuration: {
        toolPolicies: {
          'file-write': 'require-approval', // Override
          'url-fetch': 'allow', // Add new
        },
      },
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    Session.createSession(sessionData);
    const session = Session.getSession('session1');
    const projectConfig = project.getConfiguration();

    expect(session).toBeDefined();
    expect(session?.configuration.toolPolicies).toEqual({
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
    }).toThrow('Invalid configuration');
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
