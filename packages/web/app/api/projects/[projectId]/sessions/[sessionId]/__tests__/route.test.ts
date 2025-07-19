// ABOUTME: Test suite for individual session API endpoints - GET/PATCH/DELETE operations
// ABOUTME: Tests session ownership validation and proper CRUD operations within project context

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PATCH, DELETE } from '@/app/api/projects/[projectId]/sessions/[sessionId]/route';
import { Project } from '@/lib/server/lace-imports';

// Mock Project
vi.mock('@/lib/server/lace-imports', () => ({
  Project: {
    getById: vi.fn(),
  },
}));

describe('Individual session API endpoints', () => {
  let mockProject: {
    getSession: vi.MockedFunction<(id: string) => unknown>;
    updateSession: vi.MockedFunction<(id: string, data: Record<string, unknown>) => unknown>;
    deleteSession: vi.MockedFunction<(id: string) => boolean>;
  };

  const mockSession = {
    id: 'session1',
    projectId: 'project1',
    name: 'Test Session',
    description: 'A test session',
    configuration: { provider: 'anthropic' },
    status: 'active' as const,
    createdAt: new Date('2023-01-01'),
    updatedAt: new Date('2023-01-01'),
  };

  beforeEach(() => {
    mockProject = {
      getSession: vi.fn(),
      updateSession: vi.fn(),
      deleteSession: vi.fn(),
    };
    const mockedGetById = vi.mocked(Project.getById) as vi.MockedFunction<typeof Project.getById>;
    mockedGetById.mockReturnValue(mockProject as unknown as ReturnType<typeof Project.getById>);
  });

  describe('GET /api/projects/:projectId/sessions/:sessionId', () => {
    it('should return session when it exists and belongs to project', async () => {
      mockProject.getSession.mockReturnValue(mockSession);

      const response = GET(
        new NextRequest('http://localhost/api/projects/project1/sessions/session1'),
        { params: { projectId: 'project1', sessionId: 'session1' } }
      );

      const data = (await response.json()) as { session: typeof mockSession };

      expect(response.status).toBe(200);
      expect(data.session.id).toBe('session1');
      expect(data.session.name).toBe('Test Session');
      expect(data.session.projectId).toBe('project1');
      expect(mockProject.getSession).toHaveBeenCalledWith('session1');
    });

    it('should return 404 when project does not exist', async () => {
      const mockedGetById = vi.mocked(Project.getById) as vi.MockedFunction<typeof Project.getById>;
      mockedGetById.mockReturnValue(null);

      const response = GET(
        new NextRequest('http://localhost/api/projects/project1/sessions/session1'),
        { params: { projectId: 'project1', sessionId: 'session1' } }
      );

      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe('Project not found');
    });

    it('should return 404 when session does not exist', async () => {
      mockProject.getSession.mockReturnValue(null);

      const response = GET(
        new NextRequest('http://localhost/api/projects/project1/sessions/nonexistent'),
        { params: { projectId: 'project1', sessionId: 'nonexistent' } }
      );

      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found in this project');
    });

    it('should handle database errors', async () => {
      mockProject.getSession.mockImplementation(() => {
        throw new Error('Database error');
      });

      const response = GET(
        new NextRequest('http://localhost/api/projects/project1/sessions/session1'),
        { params: { projectId: 'project1', sessionId: 'session1' } }
      );

      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(500);
      expect(data.error).toBe('Database error');
    });
  });

  describe('PATCH /api/projects/:projectId/sessions/:sessionId', () => {
    it('should update session successfully', async () => {
      const updatedSession = {
        ...mockSession,
        name: 'Updated Session',
        description: 'Updated description',
        status: 'completed' as const,
        updatedAt: new Date('2023-01-02'),
      };

      mockProject.updateSession.mockReturnValue(updatedSession);

      const request = new NextRequest('http://localhost/api/projects/project1/sessions/session1', {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Updated Session',
          description: 'Updated description',
          status: 'completed',
        }),
      });

      const response = await PATCH(request, {
        params: { projectId: 'project1', sessionId: 'session1' },
      });

      const data = (await response.json()) as { session: typeof updatedSession };

      expect(response.status).toBe(200);
      expect(data.session.name).toBe('Updated Session');
      expect(data.session.description).toBe('Updated description');
      expect(data.session.status).toBe('completed');
      expect(mockProject.updateSession).toHaveBeenCalledWith('session1', {
        name: 'Updated Session',
        description: 'Updated description',
        status: 'completed',
      });
    });

    it('should return 404 when project does not exist', async () => {
      const mockedGetById = vi.mocked(Project.getById) as vi.MockedFunction<typeof Project.getById>;
      mockedGetById.mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/projects/project1/sessions/session1', {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Updated Session',
        }),
      });

      const response = await PATCH(request, {
        params: { projectId: 'project1', sessionId: 'session1' },
      });

      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe('Project not found');
    });

    it('should return 404 when session does not exist', async () => {
      mockProject.updateSession.mockReturnValue(null);

      const request = new NextRequest(
        'http://localhost/api/projects/project1/sessions/nonexistent',
        {
          method: 'PATCH',
          body: JSON.stringify({
            name: 'Updated Session',
          }),
        }
      );

      const response = await PATCH(request, {
        params: { projectId: 'project1', sessionId: 'nonexistent' },
      });

      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found in this project');
    });

    it('should validate request data', async () => {
      const request = new NextRequest('http://localhost/api/projects/project1/sessions/session1', {
        method: 'PATCH',
        body: JSON.stringify({
          name: '', // Empty name should fail validation
        }),
      });

      const response = await PATCH(request, {
        params: { projectId: 'project1', sessionId: 'session1' },
      });

      const data = (await response.json()) as { error: string; details?: unknown };

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request data');
      expect(data.details).toBeDefined();
    });

    it('should handle partial updates', async () => {
      const updatedSession = {
        ...mockSession,
        name: 'Partially Updated Session',
        updatedAt: new Date('2023-01-02'),
      };

      mockProject.updateSession.mockReturnValue(updatedSession);

      const request = new NextRequest('http://localhost/api/projects/project1/sessions/session1', {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Partially Updated Session',
        }),
      });

      const response = await PATCH(request, {
        params: { projectId: 'project1', sessionId: 'session1' },
      });

      const data = (await response.json()) as { session: typeof updatedSession };

      expect(response.status).toBe(200);
      expect(data.session.name).toBe('Partially Updated Session');
      expect(data.session.description).toBe('A test session'); // Should remain unchanged
      expect(mockProject.updateSession).toHaveBeenCalledWith('session1', {
        name: 'Partially Updated Session',
      });
    });

    it('should handle database errors during update', async () => {
      mockProject.updateSession.mockImplementation(() => {
        throw new Error('Database error');
      });

      const request = new NextRequest('http://localhost/api/projects/project1/sessions/session1', {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Updated Session',
        }),
      });

      const response = await PATCH(request, {
        params: { projectId: 'project1', sessionId: 'session1' },
      });

      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(500);
      expect(data.error).toBe('Database error');
    });
  });

  describe('DELETE /api/projects/:projectId/sessions/:sessionId', () => {
    it('should delete session successfully', async () => {
      mockProject.deleteSession.mockReturnValue(true);

      const response = DELETE(
        new NextRequest('http://localhost/api/projects/project1/sessions/session1'),
        { params: { projectId: 'project1', sessionId: 'session1' } }
      );

      const data = (await response.json()) as { success: boolean };

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockProject.deleteSession).toHaveBeenCalledWith('session1');
    });

    it('should return 404 when project does not exist', async () => {
      const mockedGetById = vi.mocked(Project.getById) as vi.MockedFunction<typeof Project.getById>;
      mockedGetById.mockReturnValue(null);

      const response = DELETE(
        new NextRequest('http://localhost/api/projects/project1/sessions/session1'),
        { params: { projectId: 'project1', sessionId: 'session1' } }
      );

      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe('Project not found');
    });

    it('should return 404 when session does not exist', async () => {
      mockProject.deleteSession.mockReturnValue(false);

      const response = DELETE(
        new NextRequest('http://localhost/api/projects/project1/sessions/nonexistent'),
        { params: { projectId: 'project1', sessionId: 'nonexistent' } }
      );

      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found in this project');
    });

    it('should handle database errors during deletion', async () => {
      mockProject.deleteSession.mockImplementation(() => {
        throw new Error('Database error');
      });

      const response = DELETE(
        new NextRequest('http://localhost/api/projects/project1/sessions/session1'),
        { params: { projectId: 'project1', sessionId: 'session1' } }
      );

      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(500);
      expect(data.error).toBe('Database error');
    });
  });
});
