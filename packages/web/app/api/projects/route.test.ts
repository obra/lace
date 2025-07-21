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

// ❌ PROBLEMATIC MOCK - This mocks the entire Project backend logic
// Should use real Project class with test database for proper integration testing
// Tests currently validate mock responses instead of actual API functionality
vi.mock('@/lib/server/lace-imports', () => ({
  Project: {
    getAll: vi.fn(),
    create: vi.fn().mockReturnValue({
      getId: vi.fn().mockReturnValue('test-project-id'),
      getInfo: vi.fn().mockReturnValue({
        id: 'test-project-id',
        name: 'Test Project',
        description: 'A test project',
        workingDirectory: '/test/path',
        isArchived: false,
        createdAt: '2023-01-01T00:00:00.000Z',
        lastUsedAt: '2023-01-01T00:00:00.000Z',
        sessionCount: 0,
      }),
    }),
  },
}));

describe('Projects API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/projects', () => {
    it('should return all projects', async () => {
      const mockProjects = [
        {
          id: 'project1',
          name: 'Project 1',
          description: 'First project',
          workingDirectory: '/path/1',
          isArchived: false,
          createdAt: '2023-01-01T00:00:00.000Z',
          lastUsedAt: '2023-01-01T00:00:00.000Z',
          sessionCount: 0,
        },
        {
          id: 'project2',
          name: 'Project 2',
          description: 'Second project',
          workingDirectory: '/path/2',
          isArchived: false,
          createdAt: '2023-01-02T00:00:00.000Z',
          lastUsedAt: '2023-01-02T00:00:00.000Z',
          sessionCount: 0,
        },
      ];

      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getAll = vi.fn().mockReturnValue(mockProjects);

      const response = await GET();
      const data = (await response.json()) as ProjectsResponse;

      expect(response.status).toBe(200);
      expect(data.projects).toHaveLength(2);
      expect(data.projects[0].id).toBe('project1');
      expect(data.projects[1].id).toBe('project2');
      expect(Project.getAll).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getAll = vi.fn().mockImplementation(() => {
        throw new Error('Database error');
      });

      const response = await GET();
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(500);
      expect(data.error).toBe('Database error');
    });
  });

  describe('POST /api/projects', () => {
    it('should create new project', async () => {
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

      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));

      const response = await POST(request);
      const data = (await response.json()) as ProjectResponse;

      expect(response.status).toBe(201);
      expect(data.project).toEqual({
        id: 'test-project-id',
        name: 'Test Project',
        description: 'A test project',
        workingDirectory: '/test/path',
        isArchived: false,
        createdAt: '2023-01-01T00:00:00.000Z',
        lastUsedAt: '2023-01-01T00:00:00.000Z',
        sessionCount: 0,
      });

      expect(Project.create).toHaveBeenCalledWith('New Project', '/new/path', 'A new project', {
        key: 'value',
      });
    });

    it('should create project with minimal data', async () => {
      const requestBody = {
        name: 'Minimal Project',
        workingDirectory: '/minimal/path',
      };

      const request = new NextRequest('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));

      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(Project.create).toHaveBeenCalledWith('Minimal Project', '/minimal/path', '', {});
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

    it('should handle creation errors', async () => {
      const requestBody = {
        name: 'Test Project',
        workingDirectory: '/test/path',
      };

      const request = new NextRequest('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.create = vi.fn().mockImplementation(() => {
        throw new Error('Creation failed');
      });

      const response = await POST(request);
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(500);
      expect(data.error).toBe('Creation failed');
    });
  });
});
