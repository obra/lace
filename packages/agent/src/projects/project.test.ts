// ABOUTME: Tests for Project class functionality including CRUD operations
// ABOUTME: Covers project creation, persistence, updates, and cleanup with proper test isolation

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Project } from './project';
import { setupCoreTest } from '@lace/agent/test-utils/core-test-setup';
import { existsSync, mkdirSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getProcessTempDir } from '@lace/agent/config/lace-dir';

describe('Project', () => {
  const tempLaceDirContext = setupCoreTest();
  let tempProjectDir: string;

  beforeEach(async () => {
    // Create a real temp directory for each test
    tempProjectDir = join(tempLaceDirContext.tempDir, 'test-project');
    mkdirSync(tempProjectDir, { recursive: true });
  });

  describe('create', () => {
    it('should create a new project with required fields', () => {
      const project = Project.create('Test Project', tempProjectDir, 'A test project', {
        key: 'value',
      });

      expect(project).toBeInstanceOf(Project);
      expect(project.getId()).toBeDefined();

      // Verify project was actually saved to the project store
      const retrieved = Project.getById(project.getId());
      expect(retrieved).not.toBeNull();
      expect(retrieved!.getName()).toBe('Test Project');
      expect(retrieved!.getWorkingDirectory()).toBe(tempProjectDir);
    });

    it('should create project with default values', () => {
      const project = Project.create('Test Project', tempProjectDir);

      expect(project).toBeInstanceOf(Project);

      // Verify project was actually saved with defaults
      const retrieved = Project.getById(project.getId());
      expect(retrieved).not.toBeNull();
      expect(retrieved!.getName()).toBe('Test Project');
      expect(retrieved!.getWorkingDirectory()).toBe(tempProjectDir);
    });

    it('should auto-generate name from directory path', () => {
      const projectPath = join(tempLaceDirContext.tempDir, 'my-awesome-project');
      mkdirSync(projectPath, { recursive: true });
      const project = Project.create(
        '', // empty name to trigger auto-generation
        projectPath,
        'Test description'
      );

      const info = project.getInfo();
      expect(info?.name).toBe('my-awesome-project');
    });

    it('should handle trailing slashes in directory path', () => {
      const projectPath = join(tempLaceDirContext.tempDir, 'my-project');
      mkdirSync(projectPath, { recursive: true });
      const project = Project.create('', projectPath + '/', 'Test description');

      const info = project.getInfo();
      expect(info?.name).toBe('my-project');
    });

    it('should handle root directory', () => {
      // Use a single-letter directory name to test the edge case behavior
      const projectPath = join(tempLaceDirContext.tempDir, 'r');
      mkdirSync(projectPath, { recursive: true });
      const project = Project.create('', projectPath, 'Test description');

      const info = project.getInfo();
      expect(info?.name).toBe('r');
    });

    it('should use provided name when given', () => {
      const projectPath = join(tempLaceDirContext.tempDir, 'my-project');
      mkdirSync(projectPath, { recursive: true });
      const project = Project.create('Custom Name', projectPath, 'Test description');

      const info = project.getInfo();
      expect(info?.name).toBe('Custom Name');
    });
  });

  describe('getAll', () => {
    it('should return all projects', () => {
      // Create real projects in the project store
      const path1 = join(tempLaceDirContext.tempDir, 'project1');
      const path2 = join(tempLaceDirContext.tempDir, 'project2');
      mkdirSync(path1, { recursive: true });
      mkdirSync(path2, { recursive: true });

      const _project1 = Project.create('Project 1', path1, 'First project');
      const _project2 = Project.create('Project 2', path2, 'Second project');

      const projects = Project.getAll();

      // Should have our 2 created projects
      expect(projects).toHaveLength(2);
      expect(projects.find((p) => p.name === 'Project 1')).toBeDefined();
      expect(projects.find((p) => p.name === 'Project 2')).toBeDefined();
      expect(projects.find((p) => p.name === 'Project 1')?.workingDirectory).toBe(path1);
      expect(projects.find((p) => p.name === 'Project 2')?.workingDirectory).toBe(path2);
    });

    it('should return empty list when no projects exist', () => {
      const projects = Project.getAll();

      // Clean project store should have no projects by default
      expect(projects).toHaveLength(0);
    });
  });

  describe('getById', () => {
    it('should return project when found', () => {
      const createdProject = Project.create('Test Project', tempProjectDir, 'A test project', {
        key: 'value',
      });
      const projectId = createdProject.getId();

      const project = Project.getById(projectId);

      expect(project).toBeInstanceOf(Project);
      expect(project?.getId()).toBe(projectId);
      expect(project?.getName()).toBe('Test Project');
    });

    it('should return null when not found', () => {
      const project = Project.getById('non-existent');

      expect(project).toBeNull();
    });
  });

  describe('instance methods', () => {
    let project: Project;

    beforeEach(() => {
      project = Project.create('Test Project', tempProjectDir, 'A test project', {
        key: 'value',
      });
    });

    describe('getInfo', () => {
      it('should return project info', () => {
        const info = project.getInfo();

        expect(info).toEqual({
          id: project.getId(),
          name: 'Test Project',
          description: 'A test project',
          workingDirectory: tempProjectDir,
          isArchived: false,
          createdAt: expect.any(Date) as Date,
          lastUsedAt: expect.any(Date) as Date,
        });
      });

      it('should return null when project not found via getById', () => {
        const nonExistentProject = Project.getById('non-existent');
        expect(nonExistentProject).toBeNull();
      });
    });

    describe('getName', () => {
      it('should return project name', () => {
        expect(project.getName()).toBe('Test Project');
      });
    });

    describe('getWorkingDirectory', () => {
      it('should return working directory', () => {
        expect(project.getWorkingDirectory()).toBe(tempProjectDir);
      });
    });

    describe('getConfiguration', () => {
      it('should return configuration', () => {
        const config = project.getConfiguration();
        expect(config).toEqual({
          key: 'value',
        });
      });

      it('should return empty object when no configuration', () => {
        const simplePath = join(tempLaceDirContext.tempDir, 'simple-project');
        mkdirSync(simplePath, { recursive: true });
        const simpleProject = Project.create('Simple', simplePath);
        const config = simpleProject.getConfiguration();
        expect(config).toEqual({});
      });
    });

    describe('updateInfo', () => {
      it('should update project name', () => {
        project.updateInfo({ name: 'Updated Name' });

        const updated = Project.getById(project.getId());
        expect(updated?.getName()).toBe('Updated Name');
      });

      it('should update project description', () => {
        project.updateInfo({ description: 'Updated description' });

        const updated = Project.getById(project.getId());
        expect(updated?.getInfo()?.description).toBe('Updated description');
      });

      it('should update working directory', () => {
        const newPath = join(tempLaceDirContext.tempDir, 'new-path');
        mkdirSync(newPath, { recursive: true });
        project.updateInfo({ workingDirectory: newPath });

        const updated = Project.getById(project.getId());
        expect(updated?.getWorkingDirectory()).toBe(newPath);
      });

      it('should update configuration', () => {
        project.updateInfo({ configuration: { newKey: 'newValue' } });

        const updated = Project.getById(project.getId());
        expect(updated?.getConfiguration()).toEqual({ newKey: 'newValue' });
      });
    });

    describe('archive', () => {
      it('should archive project', () => {
        project.archive();

        const updated = Project.getById(project.getId());
        expect(updated?.getInfo()?.isArchived).toBe(true);
      });
    });

    describe('unarchive', () => {
      it('should unarchive project', () => {
        project.archive();
        project.unarchive();

        const updated = Project.getById(project.getId());
        expect(updated?.getInfo()?.isArchived).toBe(false);
      });
    });

    describe('touchLastUsed', () => {
      it('should update lastUsedAt timestamp', async () => {
        const originalInfo = project.getInfo();
        const originalLastUsed = originalInfo?.lastUsedAt;

        // Wait a bit to ensure timestamp difference
        await new Promise((resolve) => setTimeout(resolve, 10));

        project.touchLastUsed();

        const updatedInfo = project.getInfo();
        const updatedLastUsed = updatedInfo?.lastUsedAt;

        expect(updatedLastUsed).not.toEqual(originalLastUsed);
        expect(updatedLastUsed! > originalLastUsed!).toBe(true);
      });
    });

    describe('delete', () => {
      it('should delete project', () => {
        const projectId = project.getId();

        // Verify project exists before deletion
        expect(Project.getById(projectId)).not.toBeNull();

        project.delete();

        // Verify project is deleted
        expect(Project.getById(projectId)).toBeNull();
      });
    });

    describe('updateConfiguration', () => {
      it('should merge configuration updates', () => {
        project.updateConfiguration({ newKey: 'newValue' });

        const updated = Project.getById(project.getId());
        expect(updated?.getConfiguration()).toEqual({ key: 'value', newKey: 'newValue' });
      });
    });
  });

  describe('temp directory management', () => {
    it('should create project temp directory', () => {
      const projectId = 'test-project-123';
      const tempDir = Project.getProjectTempDir(projectId);

      expect(tempDir).toContain(`project-${projectId}`);
      expect(existsSync(tempDir)).toBe(true);
    });

    it('should return same directory for same project', () => {
      const projectId = 'test-project-456';
      const tempDir1 = Project.getProjectTempDir(projectId);
      const tempDir2 = Project.getProjectTempDir(projectId);

      expect(tempDir1).toBe(tempDir2);
    });

    it('should create different directories for different projects', () => {
      const tempDir1 = Project.getProjectTempDir('project-a');
      const tempDir2 = Project.getProjectTempDir('project-b');

      expect(tempDir1).not.toBe(tempDir2);
      expect(tempDir1).toContain('project-a');
      expect(tempDir2).toContain('project-b');
    });

    it('should create directory under process temp dir', () => {
      const projectId = 'nested-test';
      const tempDir = Project.getProjectTempDir(projectId);
      const processTempDir = getProcessTempDir();

      expect(tempDir).toContain(processTempDir);
    });
  });

  describe('MCP Server Management', () => {
    function makeUniqueTempProjectDir(): string {
      return mkdtempSync(join(tmpdir(), 'lace-project-test-'));
    }
    it('should start async discovery when adding MCP server', async () => {
      const { ToolCatalog } = await import('@lace/agent/tools/tool-catalog');
      const discoverSpy = vi.spyOn(ToolCatalog, 'discoverAndCacheTools').mockResolvedValue(void 0);

      // Use temp directory that exists
      const tempDir = getProcessTempDir();
      const project = Project.create('Test Project', tempDir);

      project.addMCPServer('filesystem', {
        command: 'npx',
        args: ['@modelcontextprotocol/server-filesystem'],
        enabled: true,
        tools: {},
      });

      expect(discoverSpy).toHaveBeenCalledWith(
        'filesystem',
        expect.objectContaining({ command: 'npx' }),
        project.getWorkingDirectory()
      );
    });

    it('should not block on tool discovery', async () => {
      const { ToolCatalog } = await import('@lace/agent/tools/tool-catalog');

      let resolveDiscovery: (() => void) | undefined;
      const discoveryPromise = new Promise<void>((resolve) => {
        resolveDiscovery = resolve;
      });

      // Mock discovery with deferred promise
      vi.spyOn(ToolCatalog, 'discoverAndCacheTools').mockReturnValue(discoveryPromise);

      const tempDir = makeUniqueTempProjectDir();
      const project = Project.create('Test Project', tempDir);

      // addMCPServer should resolve before discovery completes
      project.addMCPServer('slow-server', {
        command: 'slow-command',
        enabled: true,
        tools: {},
      });

      // Since addMCPServer is now sync, no need to await

      // Assert that the server was added to config immediately (non-blocking behavior)
      const servers = project.getMCPServers();
      expect(servers['slow-server']).toBeDefined();
      expect(servers['slow-server'].command).toBe('slow-command');

      // Now complete the discovery
      if (resolveDiscovery) {
        resolveDiscovery();
      }
      await discoveryPromise;

      // Assert discovery spy was called (proves discovery was initiated)
      expect(vi.mocked(ToolCatalog.discoverAndCacheTools)).toHaveBeenCalledWith(
        'slow-server',
        expect.objectContaining({ command: 'slow-command' }),
        project.getWorkingDirectory()
      );
    });

    it('should throw error for duplicate server IDs', async () => {
      // This test verifies that the duplicate check works correctly
      // We'll mock ToolCatalog to avoid server startup but allow testing the duplicate logic
      const { ToolCatalog } = await import('@lace/agent/tools/tool-catalog');

      // Mock with spy to track calls and avoid actual discovery
      const discoverSpy = vi
        .spyOn(ToolCatalog, 'discoverAndCacheTools')
        .mockImplementation(async (serverId, config, projectDir) => {
          // Simulate the immediate config save that the real method does
          const { MCPConfigLoader } = await import('@lace/agent/config/mcp-config-loader');
          const pendingConfig = {
            ...config,
            discoveryStatus: 'discovering' as const,
            lastDiscovery: new Date().toISOString(),
          };
          MCPConfigLoader.updateServerConfig(serverId, pendingConfig, projectDir);
          // Don't run the background discovery
        });

      const tempDir = getProcessTempDir();
      const project = Project.create('Test Project', tempDir);

      // Add first server
      project.addMCPServer('duplicate-server', {
        command: 'test-command',
        enabled: true,
        tools: {},
      });

      // Verify the first server was actually added
      const serversAfterFirst = project.getMCPServers();
      expect(serversAfterFirst['duplicate-server']).toBeDefined();

      // Try to add same server ID again - this should throw
      expect(() =>
        project.addMCPServer('duplicate-server', {
          command: 'another-command',
          enabled: true,
          tools: {},
        })
      ).toThrow("MCP server 'duplicate-server' already exists in project");

      // Cleanup
      discoverSpy.mockRestore();
    });
  });
});
