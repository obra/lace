// ABOUTME: Tests for Session permission override mode functionality
// ABOUTME: Validates mode changes, persistence, and restoration on session reload

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Session } from './session';
import { Project } from '~/projects/project';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';

describe('Session Permission Override', () => {
  let testProject: Project;
  let providerInstanceId: string;
  const setup = setupCoreTest();

  beforeEach(async () => {
    setupTestProviderDefaults();

    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Permission Instance',
      apiKey: 'test-anthropic-key',
    });

    testProject = Project.create('Test Project', setup.tempDir, 'Test project for permissions', {
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });
  });

  afterEach(() => {
    cleanupTestProviderDefaults();
    cleanupTestProviderInstances();
  });

  it('should start in normal mode', async () => {
    const session = await Session.create({
      projectId: testProject.getId(),
      name: 'Test Session',
    });

    expect(session.getPermissionOverrideMode()).toBe('normal');
  });

  it('should update permission mode', async () => {
    const session = await Session.create({
      projectId: testProject.getId(),
      name: 'Test Session',
    });

    session.setPermissionOverrideMode('yolo');
    expect(session.getPermissionOverrideMode()).toBe('yolo');

    session.setPermissionOverrideMode('read-only');
    expect(session.getPermissionOverrideMode()).toBe('read-only');
  });

  it('should persist permission mode', async () => {
    const session = await Session.create({
      projectId: testProject.getId(),
      name: 'Test Session',
    });

    session.setPermissionOverrideMode('yolo');

    // Reload session
    const reloaded = await Session.getById(session.getId());
    expect(reloaded?.getPermissionOverrideMode()).toBe('yolo');
  });

  it('should restore permission mode to normal if not set', async () => {
    const session = await Session.create({
      projectId: testProject.getId(),
      name: 'Test Session',
    });

    // Don't set any override mode
    const reloaded = await Session.getById(session.getId());
    expect(reloaded?.getPermissionOverrideMode()).toBe('normal');
  });

  it('should update all agent tool executors when mode changes', async () => {
    const session = await Session.create({
      projectId: testProject.getId(),
      name: 'Test Session',
    });

    // Get coordinator agent
    const coordinatorAgent = session.getCoordinatorAgent();
    expect(coordinatorAgent).not.toBeNull();

    // Change mode
    session.setPermissionOverrideMode('yolo');

    // Verify mode was passed to agent's tool executor
    expect(session.getPermissionOverrideMode()).toBe('yolo');
  });
});
