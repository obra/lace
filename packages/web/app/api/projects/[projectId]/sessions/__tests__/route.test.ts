// ABOUTME: Test suite for session API endpoints under projects hierarchy
// ABOUTME: Tests CRUD operations with proper project-session relationships and validation

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/projects/[projectId]/sessions/route';
import { Project } from '@/lib/server/lace-imports';

// Mock Project
vi.mock('@/lib/server/lace-imports', () => ({
  Project: {
    getById: vi.fn(),
  },
}));

// Mock generateId
vi.mock('@/lib/utils/id-generator', () => ({
  generateId: vi.fn(() => 'test-session-id'),
}));

describe('Session API endpoints under projects', () => {
  let mockProject: {
    getSessions: vi.MockedFunction<() => unknown[]>;
    createSession: vi.MockedFunction<
      (name: string, description: string, config: Record<string, unknown>) => unknown
    >;
  };

  beforeEach(() => {
    mockProject = {
      getSessions: vi.fn(),
      createSession: vi.fn(),
    };
    const mockedGetById = vi.mocked(Project.getById) as vi.MockedFunction<typeof Project.getById>;
    mockedGetById.mockReturnValue(mockProject as unknown as ReturnType<typeof Project.getById>);
  });

  describe('GET /api/projects/:projectId/sessions', () => {
    it('should return sessions for project', async () => {
      const mockSessions = [
        {
          id: 'session1',
          projectId: 'project1',
          name: 'Session 1',
          description: 'First session',
          configuration: {},
          status: 'active',
          createdAt: new Date('2023-01-01'),
          updatedAt: new Date('2023-01-01'),
        },
        {
          id: 'session2',
          projectId: 'project1',
          name: 'Session 2',
          description: 'Second session',
          configuration: {},
          status: 'active',
          createdAt: new Date('2023-01-02'),
          updatedAt: new Date('2023-01-02'),
        },
      ];

      mockProject.getSessions.mockReturnValue(mockSessions);

      const response = GET(new NextRequest('http://localhost/api/projects/project1/sessions'), {
        params: { projectId: 'project1' },
      });

      const data = (await response.json()) as { sessions: typeof mockSessions };

      expect(response.status).toBe(200);
      expect(data.sessions).toHaveLength(2);
      expect(data.sessions[0].id).toBe('session1');
      expect(data.sessions[1].id).toBe('session2');
      expect(mockProject.getSessions).toHaveBeenCalled();
    });

    it('should return empty array when no sessions exist', async () => {
      mockProject.getSessions.mockReturnValue([]);

      const response = GET(new NextRequest('http://localhost/api/projects/project1/sessions'), {
        params: { projectId: 'project1' },
      });

      const data = (await response.json()) as { sessions: [] };

      expect(response.status).toBe(200);
      expect(data.sessions).toHaveLength(0);
    });

    it('should return 404 when project not found', async () => {
      const mockedGetById = vi.mocked(Project.getById) as vi.MockedFunction<typeof Project.getById>;
      mockedGetById.mockReturnValue(null);

      const response = GET(new NextRequest('http://localhost/api/projects/project1/sessions'), {
        params: { projectId: 'project1' },
      });

      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe('Project not found');
    });

    it('should handle database errors', async () => {
      mockProject.getSessions.mockImplementation(() => {
        throw new Error('Database error');
      });

      const response = GET(new NextRequest('http://localhost/api/projects/project1/sessions'), {
        params: { projectId: 'project1' },
      });

      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(500);
      expect(data.error).toBe('Database error');
    });
  });

  describe('POST /api/projects/:projectId/sessions', () => {
    it('should create session in project', async () => {
      const mockSession = {
        id: 'test-session-id',
        projectId: 'project1',
        name: 'New Session',
        description: 'A new session',
        configuration: { provider: 'anthropic' },
        status: 'active',
        createdAt: new Date('2023-01-01'),
        updatedAt: new Date('2023-01-01'),
      };

      mockProject.createSession.mockReturnValue(mockSession);

      const request = new NextRequest('http://localhost/api/projects/project1/sessions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Session',
          description: 'A new session',
          configuration: { provider: 'anthropic' },
        }),
      });

      const response = await POST(request, { params: { projectId: 'project1' } });
      const data = (await response.json()) as {
        session: { id: string; name: string; projectId: string };
      };

      expect(response.status).toBe(201);
      expect(data.session.id).toBe('test-session-id');
      expect(data.session.name).toBe('New Session');
      expect(data.session.projectId).toBe('project1');
      expect(mockProject.createSession).toHaveBeenCalledWith('New Session', 'A new session', {
        provider: 'anthropic',
      });
    });

    it('should return 404 when project not found', async () => {
      const mockedGetById = vi.mocked(Project.getById) as vi.MockedFunction<typeof Project.getById>;
      mockedGetById.mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/projects/nonexistent/sessions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Session',
        }),
      });

      const response = await POST(request, { params: { projectId: 'nonexistent' } });
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe('Project not found');
    });

    it('should validate required fields', async () => {
      const request = new NextRequest('http://localhost/api/projects/project1/sessions', {
        method: 'POST',
        body: JSON.stringify({
          name: '', // Empty name should fail validation
        }),
      });

      const response = await POST(request, { params: { projectId: 'project1' } });
      const data = (await response.json()) as { error: string; details?: unknown };

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request data');
      expect(data.details).toBeDefined();
    });

    it('should handle missing request body', async () => {
      const request = new NextRequest('http://localhost/api/projects/project1/sessions', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const response = await POST(request, { params: { projectId: 'project1' } });
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request data');
    });

    it('should use default values for optional fields', async () => {
      const mockSession = {
        id: 'test-session-id',
        projectId: 'project1',
        name: 'Minimal Session',
        description: '',
        configuration: {},
        status: 'active',
        createdAt: new Date('2023-01-01'),
        updatedAt: new Date('2023-01-01'),
      };

      mockProject.createSession.mockReturnValue(mockSession);

      const request = new NextRequest('http://localhost/api/projects/project1/sessions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Minimal Session',
        }),
      });

      const response = await POST(request, { params: { projectId: 'project1' } });
      const data = (await response.json()) as {
        session: { description: string; configuration: Record<string, unknown> };
      };

      expect(response.status).toBe(201);
      expect(data.session.description).toBe('');
      expect(data.session.configuration).toEqual({});
    });

    it('should handle database errors during creation', async () => {
      mockProject.createSession.mockImplementation(() => {
        throw new Error('Database error');
      });

      const request = new NextRequest('http://localhost/api/projects/project1/sessions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Session',
        }),
      });

      const response = await POST(request, { params: { projectId: 'project1' } });
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(500);
      expect(data.error).toBe('Database error');
    });
  });
});
