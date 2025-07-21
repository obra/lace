// ABOUTME: Test suite for session API endpoints under projects hierarchy
// ABOUTME: Tests CRUD operations with proper project-session relationships and validation

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

// Mock sessionService
const mockSessionService = {
  createSession: vi.fn(),
};

vi.mock('@/lib/server/session-service', () => ({
  getSessionService: () => mockSessionService,
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

      const response = await GET(
        new NextRequest('http://localhost/api/projects/project1/sessions'),
        {
          params: Promise.resolve({ projectId: 'project1' }),
        }
      );

      const data = (await response.json()) as { sessions: typeof mockSessions };

      expect(response.status).toBe(200);
      expect(data.sessions).toHaveLength(2);
      expect(data.sessions[0].id).toBe('session1');
      expect(data.sessions[1].id).toBe('session2');
      expect(mockProject.getSessions).toHaveBeenCalled();
    });

    it('should return empty array when no sessions exist', async () => {
      mockProject.getSessions.mockReturnValue([]);

      const response = await GET(
        new NextRequest('http://localhost/api/projects/project1/sessions'),
        {
          params: Promise.resolve({ projectId: 'project1' }),
        }
      );

      const data = (await response.json()) as { sessions: [] };

      expect(response.status).toBe(200);
      expect(data.sessions).toHaveLength(0);
    });

    it('should return 404 when project not found', async () => {
      const mockedGetById = vi.mocked(Project.getById) as vi.MockedFunction<typeof Project.getById>;
      mockedGetById.mockReturnValue(null);

      const response = await GET(
        new NextRequest('http://localhost/api/projects/project1/sessions'),
        {
          params: Promise.resolve({ projectId: 'project1' }),
        }
      );

      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe('Project not found');
    });

    it('should handle database errors', async () => {
      mockProject.getSessions.mockImplementation(() => {
        throw new Error('Database error');
      });

      const response = await GET(
        new NextRequest('http://localhost/api/projects/project1/sessions'),
        {
          params: Promise.resolve({ projectId: 'project1' }),
        }
      );

      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(500);
      expect(data.error).toBe('Database error');
    });
  });

  describe('POST /api/projects/:projectId/sessions', () => {
    it('should create session in project', async () => {
      const mockSession = {
        id: 'test-session-id',
        name: 'New Session',
        createdAt: '2023-01-01T00:00:00.000Z',
        agents: [],
      };

      mockSessionService.createSession.mockResolvedValue(mockSession);

      const request = new NextRequest('http://localhost/api/projects/project1/sessions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Session',
          description: 'A new session',
          configuration: { provider: 'anthropic' },
        }),
      });

      const response = await POST(request, { params: Promise.resolve({ projectId: 'project1' }) });
      const data = (await response.json()) as {
        session: { id: string; name: string; projectId: string };
      };

      expect(response.status).toBe(201);
      expect(data.session.id).toBe('test-session-id');
      expect(data.session.name).toBe('New Session');
      expect(mockSessionService.createSession).toHaveBeenCalledWith(
        'New Session',
        'anthropic',
        'claude-3-haiku-20240307',
        'project1'
      );
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

      const response = await POST(request, { params: Promise.resolve({ projectId: 'nonexistent' }) });
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

      const response = await POST(request, { params: Promise.resolve({ projectId: 'project1' }) });
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

      const response = await POST(request, { params: Promise.resolve({ projectId: 'project1' }) });
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request data');
    });

    it('should use default values for optional fields', async () => {
      const mockSession = {
        id: 'test-session-id',
        name: 'Minimal Session',
        createdAt: '2023-01-01T00:00:00.000Z',
        agents: [],
      };

      mockSessionService.createSession.mockResolvedValue(mockSession);

      const request = new NextRequest('http://localhost/api/projects/project1/sessions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Minimal Session',
        }),
      });

      const response = await POST(request, { params: Promise.resolve({ projectId: 'project1' }) });
      const data = (await response.json()) as {
        session: { id: string; name: string };
      };

      expect(response.status).toBe(201);
      expect(data.session.id).toBe('test-session-id');
      expect(data.session.name).toBe('Minimal Session');
    });

    it('should handle database errors during creation', async () => {
      mockSessionService.createSession.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost/api/projects/project1/sessions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Session',
        }),
      });

      const response = await POST(request, { params: Promise.resolve({ projectId: 'project1' }) });
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(500);
      expect(data.error).toBe('Database error');
    });
  });
});
