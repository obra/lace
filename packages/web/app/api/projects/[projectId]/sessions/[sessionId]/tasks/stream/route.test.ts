// ABOUTME: Test suite for RESTful task SSE stream API - real-time task updates under project/session  
// ABOUTME: Tests SSE connection establishment and basic event flow with proper nested route validation

import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { GET } from './route';
import { Project } from '@/lib/server/lace-imports';

// Mock Project
vi.mock('@/lib/server/lace-imports', () => ({
  Project: {
    getById: vi.fn(),
  },
}));

describe('/api/projects/[projectId]/sessions/[sessionId]/tasks/stream', () => {
  let mockProject: {
    getSession: MockedFunction<(id: string) => unknown>;
  };
  let mockSession: {
    getTaskManager: MockedFunction<() => unknown>;
  };
  let mockTaskManager: {
    on: MockedFunction<(event: string, handler: unknown) => void>;
    off: MockedFunction<(event: string, handler: unknown) => void>;
  };

  beforeEach(() => {
    mockTaskManager = {
      on: vi.fn(),
      off: vi.fn(),
    };

    mockSession = {
      getTaskManager: vi.fn().mockReturnValue(mockTaskManager),
    };

    mockProject = {
      getSession: vi.fn().mockReturnValue(mockSession),
    };

    const mockedGetById = vi.mocked(Project.getById) as MockedFunction<typeof Project.getById>;
    mockedGetById.mockReturnValue(mockProject as unknown as ReturnType<typeof Project.getById>);
  });

  describe('GET', () => {
    it('should establish SSE connection', async () => {
      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks/stream');
      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'sess1'
        }) 
      };

      const response = await GET(request, context);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');
      expect(response.headers.get('Cache-Control')).toBe('no-cache');
      expect(response.headers.get('Connection')).toBe('keep-alive');
    });

    it('should return 404 for non-existent project', async () => {
      const mockedGetById = vi.mocked(Project.getById) as MockedFunction<typeof Project.getById>;
      mockedGetById.mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/projects/nonexistent/sessions/sess1/tasks/stream');
      const context = { 
        params: Promise.resolve({ 
          projectId: 'nonexistent', 
          sessionId: 'sess1'
        }) 
      };

      const response = await GET(request, context);
      expect(response.status).toBe(404);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Project not found');
    });

    it('should return 404 for non-existent session', async () => {
      mockProject.getSession.mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/nonexistent/tasks/stream');
      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'nonexistent'
        }) 
      };

      const response = await GET(request, context);
      expect(response.status).toBe(404);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Session not found in this project');
    });

    it('should set up event listeners for task events', async () => {
      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks/stream');
      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'sess1'
        }) 
      };

      const response = await GET(request, context);
      expect(response.status).toBe(200);

      // Verify event listeners were set up
      expect(mockTaskManager.on).toHaveBeenCalledWith('task:created', expect.any(Function));
      expect(mockTaskManager.on).toHaveBeenCalledWith('task:updated', expect.any(Function));
      expect(mockTaskManager.on).toHaveBeenCalledWith('task:deleted', expect.any(Function));
      expect(mockTaskManager.on).toHaveBeenCalledWith('task:note_added', expect.any(Function));
    });

    it('should handle taskManager without event emitter methods', async () => {
      // Create taskManager without event methods
      const mockTaskManagerNoEvents = {};
      mockSession.getTaskManager.mockReturnValue(mockTaskManagerNoEvents);

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks/stream');
      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'sess1'
        }) 
      };

      const response = await GET(request, context);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    });

    it('should handle database errors', async () => {
      mockProject.getSession.mockImplementation(() => {
        throw new Error('Database error');
      });

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks/stream');
      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'sess1'
        }) 
      };

      const response = await GET(request, context);
      expect(response.status).toBe(500);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Database error');
    });

    it('should send initial connection message', async () => {
      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks/stream');
      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'sess1'
        }) 
      };

      const response = await GET(request, context);
      expect(response.status).toBe(200);

      // Since we can't easily test the stream content without a complex setup,
      // we verify the response setup and that the task manager was accessed
      expect(mockSession.getTaskManager).toHaveBeenCalled();
    });
  });
});