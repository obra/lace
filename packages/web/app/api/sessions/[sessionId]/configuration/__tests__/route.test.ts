// ABOUTME: Tests for session configuration API endpoints - GET, PUT for session configuration management
// ABOUTME: Covers configuration retrieval, updates with validation and inheritance from projects

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PUT } from '@/app/api/sessions/[sessionId]/configuration/route';

// Type interfaces for API responses
interface ConfigurationResponse {
  configuration: {
    provider?: string;
    model?: string;
    maxTokens?: number;
    tools?: string[];
    toolPolicies?: Record<string, string>;
    workingDirectory?: string;
    environmentVariables?: Record<string, string>;
  };
}

interface ErrorResponse {
  error: string;
  details?: unknown;
}

// Mock session data
const mockSessionData = {
  id: 'session-1',
  projectId: 'project-1',
  name: 'Test Session',
  description: 'A test session',
  configuration: {
    provider: 'openai',
    model: 'gpt-4',
  },
  status: 'active' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Mock project data
const mockProject = {
  getConfiguration: vi.fn().mockReturnValue({
    maxTokens: 4000,
    tools: ['file-read', 'file-write'],
    toolPolicies: {
      'file-read': 'allow',
      'file-write': 'require-approval',
    },
    workingDirectory: '/test/path',
    environmentVariables: { NODE_ENV: 'test' },
  }),
};

vi.mock('@/lib/server/lace-imports', () => ({
  Session: {
    getSession: vi.fn(),
  },
  Project: {
    getById: vi.fn(),
  },
}));

describe('Session Configuration API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/sessions/:sessionId/configuration', () => {
    it('should return session effective configuration when found', async () => {
      const { Session, Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Session.getSession = vi.fn().mockReturnValue(mockSessionData);
      Project.getById = vi.fn().mockReturnValue(mockProject);

      const request = new NextRequest('http://localhost/api/sessions/session-1/configuration');
      const response = GET(request, { params: { sessionId: 'session-1' } });
      const data = (await response.json()) as ConfigurationResponse;

      expect(response.status).toBe(200);
      expect(data.configuration).toEqual({
        provider: 'openai',
        model: 'gpt-4',
        maxTokens: 4000,
        tools: ['file-read', 'file-write'],
        toolPolicies: {
          'file-read': 'allow',
          'file-write': 'require-approval',
        },
        workingDirectory: '/test/path',
        environmentVariables: { NODE_ENV: 'test' },
      });
      expect(Session.getSession).toHaveBeenCalledWith('session-1');
      expect(Project.getById).toHaveBeenCalledWith('project-1');
    });

    it('should return 404 when session not found', async () => {
      const { Session } = vi.mocked(await import('@/lib/server/lace-imports'));
      Session.getSession = vi.fn().mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/sessions/nonexistent/configuration');
      const response = GET(request, { params: { sessionId: 'nonexistent' } });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found');
    });

    it('should handle errors gracefully', async () => {
      const { Session } = vi.mocked(await import('@/lib/server/lace-imports'));
      Session.getSession = vi.fn().mockImplementation(() => {
        throw new Error('Database error');
      });

      const request = new NextRequest('http://localhost/api/sessions/session-1/configuration');
      const response = GET(request, { params: { sessionId: 'session-1' } });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(500);
      expect(data.error).toBe('Database error');
    });
  });

  describe('PUT /api/sessions/:sessionId/configuration', () => {
    it('should update session configuration successfully', async () => {
      const { Session, Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Session.getSession = vi.fn().mockReturnValue(mockSessionData);
      Project.getById = vi.fn().mockReturnValue(mockProject);

      // Mock the database persistence
      const mockPersistence = {
        updateSession: vi.fn(),
      };

      vi.doMock('~/persistence/database', () => ({
        getPersistence: vi.fn().mockReturnValue(mockPersistence),
      }));

      const updates = {
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        maxTokens: 8000,
        toolPolicies: {
          'file-read': 'allow',
          'file-write': 'deny',
        },
      };

      const request = new NextRequest('http://localhost/api/sessions/session-1/configuration', {
        method: 'PUT',
        body: JSON.stringify(updates),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, { params: { sessionId: 'session-1' } });
      const data = (await response.json()) as ConfigurationResponse;

      expect(response.status).toBe(200);
      expect(data.configuration).toBeDefined();
    });

    it('should return 404 when session not found', async () => {
      const { Session } = vi.mocked(await import('@/lib/server/lace-imports'));
      Session.getSession = vi.fn().mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/sessions/nonexistent/configuration', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'openai' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, { params: { sessionId: 'nonexistent' } });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found');
    });

    it('should validate configuration data', async () => {
      const { Session } = vi.mocked(await import('@/lib/server/lace-imports'));
      Session.getSession = vi.fn().mockReturnValue(mockSessionData);

      const invalidUpdates = {
        maxTokens: -1, // Negative maxTokens should be invalid
        toolPolicies: {
          'file-read': 'invalid-policy', // Invalid policy should be invalid
        },
      };

      const request = new NextRequest('http://localhost/api/sessions/session-1/configuration', {
        method: 'PUT',
        body: JSON.stringify(invalidUpdates),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, { params: { sessionId: 'session-1' } });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request data');
      expect(data.details).toBeDefined();
    });

    it('should handle update errors', async () => {
      const { Session, Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Session.getSession = vi.fn().mockReturnValue(mockSessionData);
      Project.getById = vi.fn().mockReturnValue(mockProject);

      // Mock the database persistence to throw error
      const mockPersistence = {
        updateSession: vi.fn().mockImplementation(() => {
          throw new Error('Update failed');
        }),
      };

      vi.doMock('~/persistence/database', () => ({
        getPersistence: vi.fn().mockReturnValue(mockPersistence),
      }));

      const request = new NextRequest('http://localhost/api/sessions/session-1/configuration', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'openai' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PUT(request, { params: { sessionId: 'session-1' } });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(500);
      expect(data.error).toBe('Update failed');
    });
  });
});
