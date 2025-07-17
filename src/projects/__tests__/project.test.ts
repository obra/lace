// ABOUTME: Tests for Project class functionality including CRUD operations and session management
// ABOUTME: Covers project creation, persistence, updates, and cleanup with proper database isolation

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Project } from '~/projects/project';
import { DatabasePersistence } from '~/persistence/database';

// Mock the database persistence
vi.mock('~/persistence/database', () => ({
  DatabasePersistence: vi.fn().mockImplementation(() => ({
    saveProject: vi.fn(),
    loadProject: vi.fn(),
    loadAllProjects: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
    loadSessionsByProject: vi.fn().mockReturnValue([]),
    close: vi.fn(),
  })),
}));

// Mock the session class
vi.mock('~/sessions/session', () => ({
  Session: {
    getById: vi.fn(),
  },
}));

describe('Project', () => {
  let mockPersistence: {
    saveProject: ReturnType<typeof vi.fn>;
    loadProject: ReturnType<typeof vi.fn>;
    loadAllProjects: ReturnType<typeof vi.fn>;
    updateProject: ReturnType<typeof vi.fn>;
    deleteProject: ReturnType<typeof vi.fn>;
    loadSessionsByProject: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPersistence = {
      saveProject: vi.fn(),
      loadProject: vi.fn(),
      loadAllProjects: vi.fn(),
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
      loadSessionsByProject: vi.fn().mockReturnValue([]),
      close: vi.fn(),
    };
    vi.mocked(DatabasePersistence).mockImplementation(() => mockPersistence);
  });

  describe('create', () => {
    it('should create a new project with required fields', () => {
      const project = Project.create(
        'Test Project',
        '/test/path',
        'A test project',
        { key: 'value' },
        ':memory:'
      );

      expect(mockPersistence.saveProject).toHaveBeenCalledWith({
        id: expect.any(String),
        name: 'Test Project',
        description: 'A test project',
        workingDirectory: '/test/path',
        configuration: { key: 'value' },
        isArchived: false,
        createdAt: expect.any(Date),
        lastUsedAt: expect.any(Date),
      });

      expect(project).toBeInstanceOf(Project);
      expect(project.getId()).toBeDefined();
    });

    it('should create project with default values', () => {
      const project = Project.create('Test Project', '/test/path');

      expect(mockPersistence.saveProject).toHaveBeenCalledWith({
        id: expect.any(String),
        name: 'Test Project',
        description: '',
        workingDirectory: '/test/path',
        configuration: {},
        isArchived: false,
        createdAt: expect.any(Date),
        lastUsedAt: expect.any(Date),
      });

      expect(project).toBeInstanceOf(Project);
    });
  });

  describe('getAll', () => {
    it('should return all projects', () => {
      const mockProjects = [
        {
          id: 'project1',
          name: 'Project 1',
          description: 'First project',
          workingDirectory: '/path1',
          configuration: {},
          isArchived: false,
          createdAt: new Date('2023-01-01'),
          lastUsedAt: new Date('2023-01-01'),
        },
        {
          id: 'project2',
          name: 'Project 2',
          description: 'Second project',
          workingDirectory: '/path2',
          configuration: {},
          isArchived: false,
          createdAt: new Date('2023-01-02'),
          lastUsedAt: new Date('2023-01-02'),
        },
      ];

      mockPersistence.loadAllProjects.mockReturnValue(mockProjects);

      const projects = Project.getAll(':memory:');

      expect(projects).toHaveLength(2);
      expect(projects[0]).toEqual({
        id: 'project1',
        name: 'Project 1',
        description: 'First project',
        workingDirectory: '/path1',
        isArchived: false,
        createdAt: new Date('2023-01-01'),
        lastUsedAt: new Date('2023-01-01'),
        sessionCount: 0,
      });
    });
  });

  describe('getById', () => {
    it('should return project when found', () => {
      mockPersistence.loadProject.mockReturnValue({
        id: 'project1',
        name: 'Test Project',
        description: 'A test project',
        workingDirectory: '/test/path',
        configuration: {},
        isArchived: false,
        createdAt: new Date(),
        lastUsedAt: new Date(),
      });

      const project = Project.getById('project1', ':memory:');

      expect(project).toBeInstanceOf(Project);
      expect(project?.getId()).toBe('project1');
    });

    it('should return null when not found', () => {
      mockPersistence.loadProject.mockReturnValue(null);

      const project = Project.getById('nonexistent', ':memory:');

      expect(project).toBeNull();
    });
  });

  describe('instance methods', () => {
    let project: Project;

    beforeEach(() => {
      project = new Project('test-project', ':memory:');
      mockPersistence.loadProject.mockReturnValue({
        id: 'test-project',
        name: 'Test Project',
        description: 'A test project',
        workingDirectory: '/test/path',
        configuration: { key: 'value' },
        isArchived: false,
        createdAt: new Date('2023-01-01'),
        lastUsedAt: new Date('2023-01-01'),
      });
    });

    describe('getInfo', () => {
      it('should return project info', () => {
        const info = project.getInfo();

        expect(info).toEqual({
          id: 'test-project',
          name: 'Test Project',
          description: 'A test project',
          workingDirectory: '/test/path',
          isArchived: false,
          createdAt: new Date('2023-01-01'),
          lastUsedAt: new Date('2023-01-01'),
          sessionCount: 0,
        });
      });

      it('should return null when project not found', () => {
        mockPersistence.loadProject.mockReturnValue(null);

        const info = project.getInfo();

        expect(info).toBeNull();
      });
    });

    describe('getName', () => {
      it('should return project name', () => {
        expect(project.getName()).toBe('Test Project');
      });

      it('should return default when project not found', () => {
        mockPersistence.loadProject.mockReturnValue(null);
        expect(project.getName()).toBe('Unknown Project');
      });
    });

    describe('getWorkingDirectory', () => {
      it('should return working directory', () => {
        expect(project.getWorkingDirectory()).toBe('/test/path');
      });

      it('should return process.cwd() when project not found', () => {
        mockPersistence.loadProject.mockReturnValue(null);
        expect(project.getWorkingDirectory()).toBe(process.cwd());
      });
    });

    describe('updateInfo', () => {
      it('should update project info', () => {
        project.updateInfo({
          name: 'Updated Project',
          description: 'Updated description',
        });

        expect(mockPersistence.updateProject).toHaveBeenCalledWith('test-project', {
          name: 'Updated Project',
          description: 'Updated description',
          lastUsedAt: expect.any(Date),
        });
      });
    });

    describe('archive/unarchive', () => {
      it('should archive project', () => {
        project.archive();

        expect(mockPersistence.updateProject).toHaveBeenCalledWith('test-project', {
          isArchived: true,
          lastUsedAt: expect.any(Date),
        });
      });

      it('should unarchive project', () => {
        project.unarchive();

        expect(mockPersistence.updateProject).toHaveBeenCalledWith('test-project', {
          isArchived: false,
          lastUsedAt: expect.any(Date),
        });
      });
    });

    describe('delete', () => {
      it('should delete project and its sessions', () => {
        const mockSessions = [
          { id: 'session1', projectId: 'test-project' },
          { id: 'session2', projectId: 'test-project' },
        ];
        mockPersistence.loadSessionsByProject.mockReturnValue(mockSessions);

        const mockSession = { destroy: vi.fn() };
        const { Session } = vi.mocked(await import('~/sessions/session'));
        Session.getById = vi.fn().mockReturnValue(mockSession);

        project.delete();

        expect(mockPersistence.loadSessionsByProject).toHaveBeenCalledWith('test-project');
        expect(Session.getById).toHaveBeenCalledTimes(2);
        expect(mockSession.destroy).toHaveBeenCalledTimes(2);
        expect(mockPersistence.deleteProject).toHaveBeenCalledWith('test-project');
      });
    });
  });
});
