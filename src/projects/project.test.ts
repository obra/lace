// ABOUTME: Tests for Project class functionality including CRUD operations and session management
// ABOUTME: Covers project creation, persistence, updates, and cleanup with proper database isolation

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Project } from '~/projects/project';
import { Session } from '~/sessions/session';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

// Mock env-loader to control default provider detection
vi.mock('~/config/env-loader', () => ({
  getEnvVar: vi.fn((key: string) => {
    // Mock ANTHROPIC_KEY as present so it defaults to anthropic
    if (key === 'ANTHROPIC_KEY') return 'mock-anthropic-key';
    return undefined;
  }),
}));

describe('Project', () => {
  beforeEach(() => {
    setupTestPersistence();
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

      // Should have our 2 created projects
      expect(projects).toHaveLength(2);
      expect(projects.find((p) => p.name === 'Project 1')).toBeDefined();
      expect(projects.find((p) => p.name === 'Project 2')).toBeDefined();
      expect(projects.find((p) => p.name === 'Project 1')?.workingDirectory).toBe('/path1');
      expect(projects.find((p) => p.name === 'Project 2')?.workingDirectory).toBe('/path2');
    });

    it('should return empty list when no projects exist', () => {
      const projects = Project.getAll();

      // Clean database should have no projects by default
      expect(projects).toHaveLength(0);
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
          sessionCount: 1,
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
        it('should return auto-created session', () => {
          const sessions = project.getSessions();
          expect(sessions).toHaveLength(1);
          expect(sessions[0].projectId).toBe(project.getId());
        });

        it('should return sessions for the project', () => {
          // Create a session (in addition to auto-created one)
          const session = Session.create({
            name: 'Test Session',
            projectId: project.getId(),
            description: 'A test session',
          });

          const sessions = project.getSessions();
          expect(sessions).toHaveLength(2);
          expect(sessions.find((s) => s.id === session.getId())).toBeDefined();
          expect(sessions.find((s) => s.name === 'Test Session')).toBeDefined();
          expect(sessions.every((s) => s.projectId === project.getId())).toBe(true);
        });

        it('should not return sessions from other projects', () => {
          const otherProject = Project.create('Other Project', '/other/path');

          // Create sessions in both projects (in addition to auto-created ones)
          Session.create({ name: 'Project 1 Session', projectId: project.getId() });
          Session.create({ name: 'Project 2 Session', projectId: otherProject.getId() });

          const sessions = project.getSessions();
          expect(sessions).toHaveLength(2); // Auto-created + manually created
          expect(sessions.find((s) => s.name === 'Project 1 Session')).toBeDefined();
          expect(sessions.find((s) => s.name === 'Project 2 Session')).toBeUndefined();
          expect(sessions.every((s) => s.projectId === project.getId())).toBe(true);
        });
      });

      describe('createSession', () => {
        it('should create session with required fields', () => {
          const session = Session.create({
            name: 'Test Session',
            projectId: project.getId(),
            description: 'A test session',
            configuration: { key: 'value' },
          });

          expect(session.getId()).toBeDefined();
          const sessionData = Session.getSession(session.getId());
          expect(sessionData?.projectId).toBe(project.getId());
          expect(sessionData?.name).toBe('Test Session');
          expect(sessionData?.description).toBe('A test session');
          expect(sessionData?.configuration).toEqual({
            key: 'value',
            provider: 'anthropic',
            model: 'claude-3-haiku-20240307',
          });
          expect(sessionData?.status).toBe('active');
          expect(sessionData?.createdAt).toBeInstanceOf(Date);
          expect(sessionData?.updatedAt).toBeInstanceOf(Date);
        });

        it('should create session with default values', () => {
          const session = Session.create({ name: 'Test Session', projectId: project.getId() });

          const sessionData = Session.getSession(session.getId());
          expect(sessionData?.description).toBe('');
          expect(sessionData?.configuration).toEqual({
            provider: 'anthropic',
            model: 'claude-3-haiku-20240307',
          });
          expect(sessionData?.status).toBe('active');
        });
      });

      describe('getSession', () => {
        it('should return session when it exists and belongs to project', () => {
          const createdSession = Session.create({
            name: 'Test Session',
            projectId: project.getId(),
          });

          const session = project.getSession(createdSession.getId());
          expect(session).not.toBeNull();
          expect(session!.id).toBe(createdSession.getId());
          expect(session!.name).toBe('Test Session');
        });

        it('should return null when session does not exist', () => {
          const session = project.getSession('non-existent');
          expect(session).toBeNull();
        });

        it('should return null when session belongs to different project', () => {
          const otherProject = Project.create('Other Project', '/other/path');
          const otherSession = Session.create({
            name: 'Other Session',
            projectId: otherProject.getId(),
          });

          const session = project.getSession(otherSession.getId());
          expect(session).toBeNull();
        });
      });

      describe('updateSession', () => {
        let session: ReturnType<typeof Session.create>;

        beforeEach(() => {
          session = Session.create({
            name: 'Test Session',
            projectId: project.getId(),
            description: 'Original description',
          });
        });

        it('should update session successfully', () => {
          const updatedSession = project.updateSession(session.getId(), {
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
          const otherSession = Session.create({
            name: 'Other Session',
            projectId: otherProject.getId(),
          });

          const updatedSession = project.updateSession(otherSession.getId(), { name: 'Updated' });
          expect(updatedSession).toBeNull();
        });

        it('should update timestamp', async () => {
          const originalSessionData = Session.getSession(session.getId());
          const originalUpdatedAt = originalSessionData?.updatedAt;

          // Wait a bit to ensure timestamp difference
          await new Promise((resolve) => setTimeout(resolve, 10));

          const updatedSession = project.updateSession(session.getId(), {
            name: 'Updated',
          });
          expect(updatedSession!.updatedAt > originalUpdatedAt!).toBe(true);
        });
      });

      describe('deleteSession', () => {
        let session: ReturnType<typeof Session.create>;

        beforeEach(() => {
          session = Session.create({ name: 'Test Session', projectId: project.getId() });
        });

        it('should delete session successfully', () => {
          const result = project.deleteSession(session.getId());

          expect(result).toBe(true);
          expect(project.getSession(session.getId())).toBeNull();
        });

        it('should return false when session does not exist', () => {
          const result = project.deleteSession('non-existent');
          expect(result).toBe(false);
        });

        it('should return false when session belongs to different project', () => {
          const otherProject = Project.create('Other Project', '/other/path');
          const otherSession = Session.create({
            name: 'Other Session',
            projectId: otherProject.getId(),
          });

          const result = project.deleteSession(otherSession.getId());
          expect(result).toBe(false);
        });
      });

      describe('getSessionCount', () => {
        it('should return 1 for auto-created session', () => {
          expect(project.getSessionCount()).toBe(1);
        });

        it('should return correct count', () => {
          Session.create({ name: 'Session 1', projectId: project.getId() });
          Session.create({ name: 'Session 2', projectId: project.getId() });

          expect(project.getSessionCount()).toBe(3); // Auto-created + 2 manual
        });

        it('should update when sessions are deleted', () => {
          const session1 = Session.create({ name: 'Session 1', projectId: project.getId() });
          const session2 = Session.create({ name: 'Session 2', projectId: project.getId() });

          expect(project.getSessionCount()).toBe(3); // Auto-created + 2 manual

          project.deleteSession(session1.getId());
          expect(project.getSessionCount()).toBe(2);

          project.deleteSession(session2.getId());
          expect(project.getSessionCount()).toBe(1); // Auto-created session remains
        });
      });
    });
  });
});
