// ABOUTME: Tests for Project class functionality including CRUD operations and session management
// ABOUTME: Covers project creation, persistence, updates, and cleanup with proper database isolation

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Project } from '~/projects/project';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';

// Mock the session class
vi.mock('~/sessions/session', () => ({
  Session: {
    getById: vi.fn(),
  },
}));

describe('Project', () => {
  beforeEach(() => {
    setupTestPersistence();
    vi.clearAllMocks();
  });

  afterEach(() => {
    teardownTestPersistence();
  });

  describe('create', () => {
    it('should create a new project with required fields', () => {
      const project = Project.create('Test Project', '/test/path', 'A test project', {
        key: 'value',
      });

      expect(project).toBeInstanceOf(Project);
      expect(project.getId()).toBeDefined();

      // Verify project was actually saved to database
      const retrieved = Project.getById(project.getId());
      expect(retrieved).not.toBeNull();
      expect(retrieved!.getName()).toBe('Test Project');
      expect(retrieved!.getWorkingDirectory()).toBe('/test/path');
    });

    it('should create project with default values', () => {
      const project = Project.create('Test Project', '/test/path');

      expect(project).toBeInstanceOf(Project);

      // Verify project was actually saved with defaults
      const retrieved = Project.getById(project.getId());
      expect(retrieved).not.toBeNull();
      expect(retrieved!.getName()).toBe('Test Project');
      expect(retrieved!.getWorkingDirectory()).toBe('/test/path');
    });
  });

  describe('getAll', () => {
    it('should return all projects', () => {
      // Create real projects in the database
      const _project1 = Project.create('Project 1', '/path1', 'First project');
      const _project2 = Project.create('Project 2', '/path2', 'Second project');

      const projects = Project.getAll();

      // Should have our 2 projects plus the historical project from database initialization
      expect(projects).toHaveLength(3);
      expect(projects.find((p) => p.name === 'Project 1')).toBeDefined();
      expect(projects.find((p) => p.name === 'Project 2')).toBeDefined();
      expect(projects.find((p) => p.name === 'Historical')).toBeDefined(); // Default historical project
      expect(projects.find((p) => p.name === 'Project 1')?.workingDirectory).toBe('/path1');
      expect(projects.find((p) => p.name === 'Project 2')?.workingDirectory).toBe('/path2');
    });

    it('should include historical project by default', () => {
      const projects = Project.getAll();

      // Database always creates a "Historical" project for legacy sessions
      expect(projects).toHaveLength(1);
      expect(projects[0]?.name).toBe('Historical');
      expect(projects[0]?.id).toBe('historical');
    });
  });

  describe('getById', () => {
    it('should return project when found', () => {
      const createdProject = Project.create('Test Project', '/test/path', 'A test project', {
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
      project = Project.create('Test Project', '/test/path', 'A test project', { key: 'value' });
    });

    describe('getInfo', () => {
      it('should return project info', () => {
        const info = project.getInfo();

        expect(info).toEqual({
          id: project.getId(),
          name: 'Test Project',
          description: 'A test project',
          workingDirectory: '/test/path',
          isArchived: false,
          createdAt: expect.any(Date) as Date,
          lastUsedAt: expect.any(Date) as Date,
          sessionCount: 0,
        });
      });

      it('should return null when project not found', () => {
        const nonExistentProject = new Project('non-existent');

        const info = nonExistentProject.getInfo();
        expect(info).toBeNull();
      });
    });

    describe('getName', () => {
      it('should return project name', () => {
        expect(project.getName()).toBe('Test Project');
      });
    });

    describe('getWorkingDirectory', () => {
      it('should return working directory', () => {
        expect(project.getWorkingDirectory()).toBe('/test/path');
      });
    });

    describe('getConfiguration', () => {
      it('should return configuration', () => {
        const config = project.getConfiguration();
        expect(config).toEqual({ key: 'value' });
      });

      it('should return empty object when no configuration', () => {
        const simpleProject = Project.create('Simple', '/path');
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
        project.updateInfo({ workingDirectory: '/new/path' });

        const updated = Project.getById(project.getId());
        expect(updated?.getWorkingDirectory()).toBe('/new/path');
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
      it('should update lastUsedAt timestamp', () => {
        const originalInfo = project.getInfo();
        const originalLastUsed = originalInfo?.lastUsedAt;

        // Wait a bit to ensure timestamp difference
        setTimeout(() => {
          project.touchLastUsed();

          const updatedInfo = project.getInfo();
          const updatedLastUsed = updatedInfo?.lastUsedAt;

          expect(updatedLastUsed).not.toEqual(originalLastUsed);
          expect(updatedLastUsed! > originalLastUsed!).toBe(true);
        }, 10);
      });
    });

    describe('delete', () => {
      it('should delete project and its sessions', async () => {
        const projectId = project.getId();

        // Verify project exists before deletion
        expect(Project.getById(projectId)).not.toBeNull();

        await project.delete();

        // Verify project is deleted
        expect(Project.getById(projectId)).toBeNull();
      });
    });
  });
});
