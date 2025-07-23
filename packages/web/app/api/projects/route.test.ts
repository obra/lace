// ABOUTME: Tests for project API endpoints including CRUD operations and error handling
// ABOUTME: Covers GET all projects, POST new project with validation and error scenarios

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/projects/route';

// Type interfaces for API responses
interface ProjectsResponse {
  projects: Array<{
    id: string;
    name: string;
    description: string;
    workingDirectory: string;
    isArchived: boolean;
    createdAt: string;
    lastUsedAt: string;
    sessionCount: number;
  }>;
}

interface ProjectResponse {
  project: {
    id: string;
    name: string;
    description: string;
    workingDirectory: string;
    isArchived: boolean;
    createdAt: string;
    lastUsedAt: string;
    sessionCount: number;
  };
}

interface ErrorResponse {
  error: string;
  details?: unknown;
}

// Mock external dependencies (database persistence) but not business logic
const projectStore = new Map<string, Record<string, unknown>>();
const sessionStore = new Map<string, Record<string, unknown>>();

vi.mock('~/persistence/database', () => {
  return {
    getPersistence: vi.fn(() => ({
      // Mock the persistence layer to use in-memory storage for testing
      loadAllProjects: vi.fn(() => {
        return Array.from(projectStore.values()) as Record<string, unknown>[];
      }),
      loadProject: vi.fn((projectId: string) => {
        return projectStore.get(projectId) || null;
      }),
      saveProject: vi.fn((project: Record<string, unknown> & { id: string }) => {
        projectStore.set(project.id, project);
      }),
      // Mock method needed by Project.getSessions() -> Project.getSessionCount()
      loadSessionsByProject: vi.fn((_projectId: string) => {
        // Return empty sessions for now - we can add session testing later if needed
        return [];
      }),
      // Session methods needed by Session.create()
      saveSession: vi.fn((session: Record<string, unknown> & { id: string }) => {
        sessionStore.set(session.id, session);
      }),
      loadSession: vi.fn((sessionId: string) => {
        return sessionStore.get(sessionId) || null;
      }),
    })),
  };
});

// Mock ThreadManager for session counting - external dependency
vi.mock('~/threads/thread-manager', () => ({
  ThreadManager: vi.fn(() => ({
    getSessionsForProject: vi.fn(() => []), // Empty array for clean tests
    generateThreadId: vi.fn(() => {
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const random = Math.random().toString(36).substring(2, 8);
      return `lace_${date}_${random}`;
    }),
    createThread: vi.fn((threadId?: string, _sessionId?: string, _projectId?: string) => {
      // Return the provided threadId or generate a new one
      return (
        threadId ||
        `lace_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${Math.random().toString(36).substring(2, 8)}`
      );
    }),
    getThread: vi.fn((threadId: string) => {
      // Return a mock thread object when requested
      return {
        id: threadId,
        metadata: {},
        events: [],
      };
    }),
    saveThread: vi.fn((thread: unknown) => {
      // Mock saving thread - just return success
      return thread as typeof thread;
    }),
  })),
}));

describe('Projects API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the in-memory stores between tests
    projectStore.clear();
    sessionStore.clear();
  });

  describe('GET /api/projects', () => {
    it('should return all projects', async () => {
      // Arrange: Create test projects using real Project class
      const { Project } = await import('@/lib/server/lace-imports');

      // Create projects and they will be stored in our mocked persistence
      const _project1 = Project.create('Project 1', '/path/1', 'First project');
      const _project2 = Project.create('Project 2', '/path/2', 'Second project');

      // Act: Call the API endpoint
      const response = await GET();
      const data = (await response.json()) as ProjectsResponse;

      // Assert: Verify the projects are returned
      expect(response.status).toBe(200);
      expect(data.projects).toHaveLength(2);

      // Find projects by name since IDs are generated
      const returnedProject1 = data.projects.find((p) => p.name === 'Project 1');
      const returnedProject2 = data.projects.find((p) => p.name === 'Project 2');

      expect(returnedProject1).toMatchObject({
        name: 'Project 1',
        description: 'First project',
        workingDirectory: '/path/1',
        isArchived: false,
        sessionCount: 0,
      });
      expect(returnedProject2).toMatchObject({
        name: 'Project 2',
        description: 'Second project',
        workingDirectory: '/path/2',
        isArchived: false,
        sessionCount: 0,
      });
    });

    it('should return empty array when no projects exist', async () => {
      // Act: Call API with no projects created
      const response = await GET();
      const data = (await response.json()) as ProjectsResponse;

      // Assert: Empty array returned
      expect(response.status).toBe(200);
      expect(data.projects).toHaveLength(0);
    });
  });

  describe('POST /api/projects', () => {
    it('should create new project with full data', async () => {
      // Arrange: Prepare request with full project data
      const requestBody = {
        name: 'New Project',
        description: 'A new project',
        workingDirectory: '/new/path',
        configuration: { key: 'value' },
      };

      const request = new NextRequest('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      // Act: Create the project via API
      const response = await POST(request);
      const data = (await response.json()) as ProjectResponse;

      // Assert: Verify project was created with correct data
      expect(response.status).toBe(201);
      expect(data.project).toMatchObject({
        name: 'New Project',
        description: 'A new project',
        workingDirectory: '/new/path',
        isArchived: false,
        sessionCount: 0,
      });
      expect(data.project.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(data.project.createdAt).toBeTruthy();
      expect(data.project.lastUsedAt).toBeTruthy();

      // Verify the project can be retrieved via Project.getAll() (tests persistence)
      const { Project } = await import('@/lib/server/lace-imports');
      const allProjects = Project.getAll();
      const createdProject = allProjects.find((p) => p.name === 'New Project');
      expect(createdProject).toBeTruthy();
      expect(createdProject?.description).toBe('A new project');
    });

    it('should create project with minimal required data', async () => {
      // Arrange: Request with only required fields
      const requestBody = {
        name: 'Minimal Project',
        workingDirectory: '/minimal/path',
      };

      const request = new NextRequest('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      // Act: Create project with minimal data
      const response = await POST(request);
      const data = (await response.json()) as ProjectResponse;

      // Assert: Verify project created with defaults for optional fields
      expect(response.status).toBe(201);
      expect(data.project).toMatchObject({
        name: 'Minimal Project',
        description: '', // Default empty description
        workingDirectory: '/minimal/path',
        isArchived: false,
        sessionCount: 0,
      });
    });

    it('should validate required fields', async () => {
      const requestBody = {
        description: 'Missing name and workingDirectory',
      };

      const request = new NextRequest('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request data');
      expect(data.details).toBeDefined();
    });

    it('should handle empty name', async () => {
      const requestBody = {
        name: '',
        workingDirectory: '/test/path',
      };

      const request = new NextRequest('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request data');
    });

    it('should handle creation errors gracefully', async () => {
      // Arrange: Mock persistence layer to simulate database error
      const mockPersistence = {
        loadAllProjects: vi.fn(() => []),
        loadProject: vi.fn(() => null),
        saveProject: vi.fn(() => {
          throw new Error('Database connection failed');
        }),
      };

      // Override the persistence mock for this test
      const { getPersistence } = await import('~/persistence/database');
      vi.mocked(getPersistence).mockReturnValue(
        mockPersistence as unknown as ReturnType<typeof getPersistence>
      );

      const requestBody = {
        name: 'Test Project',
        workingDirectory: '/test/path',
      };

      const request = new NextRequest('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      // Act: Attempt to create project when persistence fails
      const response = await POST(request);
      const data = (await response.json()) as ErrorResponse;

      // Assert: API handles the persistence error gracefully
      expect(response.status).toBe(500);
      expect(data.error).toBe('Database connection failed');
    });
  });
});
