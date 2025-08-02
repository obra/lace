// ABOUTME: Test suite for session API endpoints under projects hierarchy
// ABOUTME: Tests CRUD operations with proper project-session relationships and validation

import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/projects/[projectId]/sessions/route';
import { Project } from '@/lib/server/lace-imports';
import { parseResponse } from '@/lib/serialization';

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
  interface MockProject {
    getSessions: () => unknown[];
    createSession: (name: string, description: string, config: Record<string, unknown>) => unknown;
  }

  let mockProject: MockProject;

  beforeEach(() => {
    const getSessionsMock = vi.fn();
    const createSessionMock = vi.fn();

    mockProject = {
      getSessions: getSessionsMock,
      createSession: createSessionMock,
    };
    const mockedGetById = vi.mocked(Project.getById);
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

      vi.mocked(mockProject.getSessions).mockReturnValue(mockSessions);

      const response = await GET(
        new NextRequest('http://localhost/api/projects/project1/sessions'),
        {
          params: Promise.resolve({ projectId: 'project1' }),
        }
      );

      const data = await parseResponse<{ sessions: typeof mockSessions }>(response);

      expect(response.status).toBe(200);
      expect(data.sessions).toHaveLength(2);
      expect(data.sessions[0].id).toBe('session1');
      expect(data.sessions[1].id).toBe('session2');
    });

    it('should return empty array when no sessions exist', async () => {
      vi.mocked(mockProject.getSessions).mockReturnValue([]);

      const response = await GET(
        new NextRequest('http://localhost/api/projects/project1/sessions'),
        {
          params: Promise.resolve({ projectId: 'project1' }),
        }
      );

      const data = await parseResponse<{ sessions: [] }>(response);

      expect(response.status).toBe(200);
      expect(data.sessions).toHaveLength(0);
    });

    it('should return 404 when project not found', async () => {
      const mockedGetById = vi.mocked(Project.getById);
      mockedGetById.mockReturnValue(null);

      const response = await GET(
        new NextRequest('http://localhost/api/projects/project1/sessions'),
        {
          params: Promise.resolve({ projectId: 'project1' }),
        }
      );

      const data = await parseResponse<{ error: string }>(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Project not found');
    });

    it('should handle database errors', async () => {
      vi.mocked(mockProject.getSessions).mockImplementation(() => {
        throw new Error('Database error');
      });

      const response = await GET(
        new NextRequest('http://localhost/api/projects/project1/sessions'),
        {
          params: Promise.resolve({ projectId: 'project1' }),
        }
      );

      const data = await parseResponse<{ error: string }>(response);

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
      const data = await parseResponse<{
        session: { id: string; name: string; projectId: string };
      }>(response);

      expect(response.status).toBe(201);
      expect(data.session.id).toBe('test-session-id');
      expect(data.session.name).toBe('New Session');
    });

    it('should return 404 when project not found', async () => {
      const mockedGetById = vi.mocked(Project.getById);
      mockedGetById.mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/projects/nonexistent/sessions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Session',
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ projectId: 'nonexistent' }),
      });
      const data = await parseResponse<{ error: string }>(response);

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
      const data = await parseResponse<{ error: string; details?: unknown }>(response);

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
      const data = await parseResponse<{ error: string }>(response);

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
      const data = await parseResponse<{
        session: { id: string; name: string };
      }>(response);

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
      const data = await parseResponse<{ error: string }>(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Database error');
    });
  });
});
