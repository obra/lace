// ABOUTME: Tests for Session class provider instance integration
// ABOUTME: Verifies Session.create() accepts providerInstanceId and modelId

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Session } from './session';
import { Project } from '~/projects/project';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';

describe('Session with Provider Instances', () => {
  const tempDirContext = useTempLaceDir();
  let testProject: Project;

  beforeEach(() => {
    // Clear any existing sessions
    Session.clearRegistry();   
    
    // Create a project manually in the database since Project.create is broken
    // TODO: Fix Project.create to work with new Session interface
    const { getPersistence } = require('~/persistence/global-persistence');
    const persistence = getPersistence();
    
    const projectData = {
      id: 'test-project-id',
      name: 'Test Project',
      description: 'Test project for session provider instance tests',
      path: tempDirContext.path,
      configuration: {},
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    persistence.saveProject(projectData);
    testProject = new (Project as any)('test-project-id');
  });

  afterEach(() => {
    Session.clearRegistry();
  });

  it('should create session using providerInstanceId and modelId', async () => {
    // Set up a provider instance first
    const { ProviderRegistry } = await import('~/providers/registry');
    const registry = new ProviderRegistry();
    await registry.initialize();

    const instanceManager = registry.instanceManager;
    const config = await instanceManager.loadInstances();
    config.instances['test-instance-id'] = {
      displayName: 'Test Instance',
      catalogProviderId: 'anthropic',
    };
    await instanceManager.saveInstances(config);
    await instanceManager.saveCredential('test-instance-id', { apiKey: 'test-key' });

    // Now Session.create should work with provider instances
    const session = await Session.create({
      name: 'Test Session',
      providerInstanceId: 'test-instance-id',
      modelId: 'claude-3-5-haiku-20241022',
      projectId: 'test-project-id'
    });

    expect(session).toBeDefined();
    
    // Verify that the session was created with the correct provider instance
    // This should fail because current Session.create ignores providerInstanceId
    const sessionData = session.getSessionData();
    expect(sessionData?.configuration?.providerInstanceId).toBe('test-instance-id');
    expect(sessionData?.configuration?.modelId).toBe('claude-3-5-haiku-20241022');
  });
});