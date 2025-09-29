// ABOUTME: Integration tests for Session with workspace manager
// ABOUTME: Verifies Session creates and uses workspace managers correctly

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Session } from './session';
import { Project } from '~/projects/project';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

describe('Session with WorkspaceManager', () => {
  const _testContext = setupCoreTest();
  let tempProjectDir: string;
  let project: Project;

  beforeEach(() => {
    // Set up mock provider configuration
    process.env.ANTHROPIC_KEY = 'test-key';

    // Create temp project directory
    tempProjectDir = mkdtempSync(join(tmpdir(), 'session-workspace-test-'));

    // Create a project
    project = Project.create('Test Project', tempProjectDir, 'Test project for workspace');
  });

  afterEach(() => {
    // Clean up temp directory
    if (tempProjectDir) {
      rmSync(tempProjectDir, { recursive: true, force: true });
    }
  });

  describe('local mode (null-container)', () => {
    it('should create session with local workspace manager by default', async () => {
      const session = Session.create({
        projectId: project.getId(),
        name: 'Test Session',
        configuration: {
          // No workspaceMode specified, should default to 'local'
          providerInstanceId: 'anthropic-default',
          modelId: 'claude-3-5-sonnet-20241022',
        },
      });
      await session.waitForWorkspace();

      expect(session).toBeDefined();
      expect(session.getWorkspaceManager()).toBeDefined();
      expect(session.getWorkspaceInfo()).toBeDefined();

      const workspaceInfo = session.getWorkspaceInfo();
      expect(workspaceInfo?.sessionId).toBe(session.getId());
      expect(workspaceInfo?.projectDir).toBe(tempProjectDir);
      expect(workspaceInfo?.clonePath).toBe(tempProjectDir); // Local mode uses project dir directly
      expect(workspaceInfo?.state).toBe('running');

      // Clean up
      await session.destroy();
    });

    it('should explicitly create local workspace when mode is specified', async () => {
      const session = Session.create({
        projectId: project.getId(),
        name: 'Test Session',
        configuration: {
          workspaceMode: 'local',
          providerInstanceId: 'anthropic-default',
          modelId: 'claude-3-5-sonnet-20241022',
        },
      });
      await session.waitForWorkspace();

      expect(session).toBeDefined();
      expect(session.getWorkspaceManager()).toBeDefined();
      expect(session.getWorkspaceInfo()).toBeDefined();

      const workspaceInfo = session.getWorkspaceInfo();
      expect(workspaceInfo?.containerId).toMatch(/^local-/); // Local mode uses fake container ID

      await session.destroy();
    });

    it('should clean up workspace on session destroy', async () => {
      const session = Session.create({
        projectId: project.getId(),
        name: 'Test Session',
        configuration: {
          workspaceMode: 'local',
          providerInstanceId: 'anthropic-default',
          modelId: 'claude-3-5-sonnet-20241022',
        },
      });
      await session.waitForWorkspace();

      const workspaceManager = session.getWorkspaceManager();
      const workspaceInfo = session.getWorkspaceInfo();

      expect(workspaceManager).toBeDefined();
      expect(workspaceInfo).toBeDefined();

      // Mock the destroyWorkspace method to track if it's called
      const destroySpy = vi.spyOn(workspaceManager!, 'destroyWorkspace');

      await session.destroy();

      expect(destroySpy).toHaveBeenCalledWith(workspaceInfo!.sessionId);
    });
  });

  describe('container mode', () => {
    it('should fall back to local mode on unsupported platforms', async () => {
      const originalPlatform = process.platform;

      // Mock a non-Darwin platform
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });

      const session = Session.create({
        projectId: project.getId(),
        name: 'Test Session',
        configuration: {
          workspaceMode: 'container', // Request container mode
          providerInstanceId: 'anthropic-default',
          modelId: 'claude-3-5-sonnet-20241022',
        },
      });
      await session.waitForWorkspace();

      // Should fall back to local mode
      const workspaceInfo = session.getWorkspaceInfo();
      expect(workspaceInfo?.containerId).toMatch(/^local-/);

      await session.destroy();

      // Restore platform
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    });

    it.skip('should create container workspace on macOS', async () => {
      // Skip this test for now - requires git repository
      // Only test container mode on macOS
      if (process.platform !== 'darwin') {
        console.log('Skipping container test on non-macOS platform');
        return;
      }

      const session = Session.create({
        projectId: project.getId(),
        name: 'Test Session',
        configuration: {
          workspaceMode: 'container',
          providerInstanceId: 'anthropic-default',
          modelId: 'claude-3-5-sonnet-20241022',
        },
      });
      await session.waitForWorkspace();

      const workspaceInfo = session.getWorkspaceInfo();
      expect(workspaceInfo).toBeDefined();
      expect(workspaceInfo?.containerId).toMatch(/^workspace-/);
      expect(workspaceInfo?.clonePath).not.toBe(tempProjectDir); // Container mode creates a clone

      await session.destroy();
    });
  });

  describe('session loading', () => {
    it('should properly clean up sessions with workspaces', async () => {
      // Create a session first
      const session = Session.create({
        projectId: project.getId(),
        name: 'Test Session',
        configuration: {
          providerInstanceId: 'anthropic-default',
          modelId: 'claude-3-5-sonnet-20241022',
        },
      });
      await session.waitForWorkspace();

      const sessionId = session.getId();

      // Session should have workspace
      expect(session.getWorkspaceManager()).toBeDefined();
      expect(session.getWorkspaceInfo()).toBeDefined();

      // Load the session (different instance, same ID)
      const loadedSession = await Session.getById(sessionId);

      expect(loadedSession).toBeDefined();
      // Loaded sessions get workspace too
      expect(loadedSession?.getWorkspaceManager()).toBeDefined();
      expect(loadedSession?.getWorkspaceInfo()).toBeDefined();

      // Clean up both sessions
      await session.destroy();
      if (loadedSession) {
        await loadedSession.destroy();
      }
    });
  });
});
