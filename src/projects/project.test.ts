// ABOUTME: Tests for Project class functionality including CRUD operations and session management
// ABOUTME: Covers project creation, persistence, updates, and cleanup with proper database isolation

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Project } from '~/projects/project';
import { setupTestPersistence, teardownTestPersistence } from '~/test-setup-dir/persistence-helper';

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
      it('should delete project and its sessions', () => {
        const projectId = project.getId();

        // Verify project exists before deletion
        expect(Project.getById(projectId)).not.toBeNull();

        project.delete();

        // Verify project is deleted
        expect(Project.getById(projectId)).toBeNull();
      });
    });

    describe('session management', () => {
      describe('getSessions', () => {
        it('should return empty array when no sessions exist', () => {
          const sessions = project.getSessions();
          expect(sessions).toHaveLength(0);
        });

        it('should return sessions for the project', () => {
          // Create a session
          const session = project.createSession('Test Session', 'A test session');

          const sessions = project.getSessions();
          expect(sessions).toHaveLength(1);
          expect(sessions[0].id).toBe(session.id);
          expect(sessions[0].name).toBe('Test Session');
          expect(sessions[0].projectId).toBe(project.getId());
        });

        it('should not return sessions from other projects', () => {
          const otherProject = Project.create('Other Project', '/other/path');

          // Create sessions in both projects
          project.createSession('Project 1 Session');
          otherProject.createSession('Project 2 Session');

          const sessions = project.getSessions();
          expect(sessions).toHaveLength(1);
          expect(sessions[0].name).toBe('Project 1 Session');
        });
      });

      describe('createSession', () => {
        it('should create session with required fields', () => {
          const session = project.createSession('Test Session', 'A test session', { key: 'value' });

          expect(session.id).toBeDefined();
          expect(session.projectId).toBe(project.getId());
          expect(session.name).toBe('Test Session');
          expect(session.description).toBe('A test session');
          expect(session.configuration).toEqual({ key: 'value' });
          expect(session.status).toBe('active');
          expect(session.createdAt).toBeInstanceOf(Date);
          expect(session.updatedAt).toBeInstanceOf(Date);
        });

        it('should create session with default values', () => {
          const session = project.createSession('Test Session');

          expect(session.description).toBe('');
          expect(session.configuration).toEqual({});
          expect(session.status).toBe('active');
        });
      });

      describe('getSession', () => {
        it('should return session when it exists and belongs to project', () => {
          const createdSession = project.createSession('Test Session');

          const session = project.getSession(createdSession.id);
          expect(session).not.toBeNull();
          expect(session!.id).toBe(createdSession.id);
          expect(session!.name).toBe('Test Session');
        });

        it('should return null when session does not exist', () => {
          const session = project.getSession('non-existent');
          expect(session).toBeNull();
        });

        it('should return null when session belongs to different project', () => {
          const otherProject = Project.create('Other Project', '/other/path');
          const otherSession = otherProject.createSession('Other Session');

          const session = project.getSession(otherSession.id);
          expect(session).toBeNull();
        });
      });

      describe('updateSession', () => {
        let session: any;

        beforeEach(() => {
          session = project.createSession('Test Session', 'Original description');
        });

        it('should update session successfully', () => {
          const updatedSession = project.updateSession((session as { id: string }).id, {
            name: 'Updated Session',
            description: 'Updated description',
            status: 'completed',
            configuration: { updated: true },
          });

          expect(updatedSession).not.toBeNull();
          expect(updatedSession!.name).toBe('Updated Session');
          expect(updatedSession!.description).toBe('Updated description');
          expect(updatedSession!.status).toBe('completed');
          expect(updatedSession!.configuration).toEqual({ updated: true });
        });

        it('should return null when session does not exist', () => {
          const updatedSession = project.updateSession('non-existent', { name: 'Updated' });
          expect(updatedSession).toBeNull();
        });

        it('should return null when session belongs to different project', () => {
          const otherProject = Project.create('Other Project', '/other/path');
          const otherSession = otherProject.createSession('Other Session');

          const updatedSession = project.updateSession(otherSession.id, { name: 'Updated' });
          expect(updatedSession).toBeNull();
        });

        it('should update timestamp', async () => {
          const originalUpdatedAt = (session as { updatedAt: Date }).updatedAt;

          // Wait a bit to ensure timestamp difference
          await new Promise((resolve) => setTimeout(resolve, 10));

          const updatedSession = project.updateSession((session as { id: string }).id, {
            name: 'Updated',
          });
          expect(updatedSession!.updatedAt > originalUpdatedAt).toBe(true);
        });
      });

      describe('deleteSession', () => {
        let session: any;

        beforeEach(() => {
          session = project.createSession('Test Session');
        });

        it('should delete session successfully', () => {
          const result = project.deleteSession((session as { id: string }).id);

          expect(result).toBe(true);
          expect(project.getSession((session as { id: string }).id)).toBeNull();
        });

        it('should return false when session does not exist', () => {
          const result = project.deleteSession('non-existent');
          expect(result).toBe(false);
        });

        it('should return false when session belongs to different project', () => {
          const otherProject = Project.create('Other Project', '/other/path');
          const otherSession = otherProject.createSession('Other Session');

          const result = project.deleteSession(otherSession.id);
          expect(result).toBe(false);
        });
      });

      describe('getSessionCount', () => {
        it('should return 0 when no sessions exist', () => {
          expect(project.getSessionCount()).toBe(0);
        });

        it('should return correct count', () => {
          project.createSession('Session 1');
          project.createSession('Session 2');

          expect(project.getSessionCount()).toBe(2);
        });

        it('should update when sessions are deleted', () => {
          const session1 = project.createSession('Session 1');
          const session2 = project.createSession('Session 2');

          expect(project.getSessionCount()).toBe(2);

          project.deleteSession(session1.id);
          expect(project.getSessionCount()).toBe(1);

          project.deleteSession(session2.id);
          expect(project.getSessionCount()).toBe(0);
        });
      });
    });
  });
});
