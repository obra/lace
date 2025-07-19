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

// Mock session data that matches what SessionService expects
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
  getProjectId: vi.fn().mockReturnValue('project-1'),
  getConfiguration: vi.fn().mockReturnValue({
    provider: 'openai',
    model: 'gpt-4',
  }),
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

// Mock the business logic classes that SessionService depends on
vi.mock('@/lib/server/lace-imports', () => ({
  Session: {
    getSession: vi.fn(),
  },
  Project: {
    getById: vi.fn(),
  },
}));

// Mock persistence for SessionService
vi.mock('~/persistence/database', () => ({
  getPersistence: vi.fn(),
}));

describe('Session Configuration API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/sessions/:sessionId/configuration', () => {
    it('should return session effective configuration when found', async () => {
      // Mock the dependencies that SessionService uses
      const { Session, Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Session.getSession = vi.fn().mockReturnValue(mockSessionData);
      Project.getById = vi.fn().mockReturnValue(mockProject);

      const request = new NextRequest('http://localhost/api/sessions/session-1/configuration');
      const response = await GET(request, { params: { sessionId: 'session-1' } });
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

      // Verify the SessionService called the underlying dependencies
      expect(Session.getSession).toHaveBeenCalledWith('session-1');
      expect(Project.getById).toHaveBeenCalledWith('project-1');
    });

    it('should return 404 when session not found', async () => {
      const { Session } = vi.mocked(await import('@/lib/server/lace-imports'));
      Session.getSession = vi.fn().mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/sessions/nonexistent/configuration');
      const response = await GET(request, { params: { sessionId: 'nonexistent' } });
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
      const response = await GET(request, { params: { sessionId: 'session-1' } });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(500);
      expect(data.error).toBe('Database error');
    });
  });

  describe('PUT /api/sessions/:sessionId/configuration', () => {
    it('should update session configuration successfully', async () => {
      const { Session, Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      const { getPersistence } = vi.mocked(await import('~/persistence/database'));

      const mockPersistence = {
        updateSession: vi.fn(),
      };

      Session.getSession = vi.fn().mockReturnValue(mockSessionData);
      Project.getById = vi.fn().mockReturnValue(mockProject);
      getPersistence.mockReturnValue(mockPersistence);

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
      expect(mockPersistence.updateSession).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({
          configuration: expect.objectContaining(updates) as Record<string, unknown>,
          updatedAt: expect.any(Date) as Date,
        }) as Record<string, unknown>
      );
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
      const { getPersistence } = vi.mocked(await import('~/persistence/database'));

      Session.getSession = vi.fn().mockReturnValue(mockSessionData);
      Project.getById = vi.fn().mockReturnValue(mockProject);

      // Mock the database persistence to throw error
      const mockPersistence = {
        updateSession: vi.fn().mockImplementation(() => {
          throw new Error('Update failed');
        }),
      };

      getPersistence.mockReturnValue(mockPersistence);

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

describe('TDD: Direct Session Usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call session.getEffectiveConfiguration() directly', async () => {
    // Mock the dependencies with proper Session object having getEffectiveConfiguration
    const { Session, Project } = vi.mocked(await import('@/lib/server/lace-imports'));

    const mockSessionWithMethod = {
      ...mockSessionData,
      getEffectiveConfiguration: vi.fn().mockReturnValue({
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
      }),
    };

    Session.getSession = vi.fn().mockReturnValue(mockSessionWithMethod);
    Project.getById = vi.fn().mockReturnValue(mockProject);

    const request = new NextRequest('http://localhost/api/sessions/test-session/configuration');

    // This should PASS because route uses session.getEffectiveConfiguration() directly
    await GET(request, { params: { sessionId: 'test-session' } });

    // Verify the session was retrieved
    expect(Session.getSession).toHaveBeenCalledWith('test-session');

    // Verify the session's getEffectiveConfiguration method was called directly
    expect(mockSessionWithMethod.getEffectiveConfiguration).toHaveBeenCalled();
  });
});

describe('TDD: Direct Session Configuration Update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call session.updateConfiguration() directly', async () => {
    // Mock the dependencies
    const { Session, Project } = vi.mocked(await import('@/lib/server/lace-imports'));
    const { getPersistence } = vi.mocked(await import('~/persistence/database'));

    const mockSession = {
      ...mockSessionData,
      updateConfiguration: vi.fn(),
      getEffectiveConfiguration: vi.fn().mockReturnValue({
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        maxTokens: 8000,
        toolPolicies: {
          'file-read': 'allow',
          'file-write': 'deny',
        },
      }),
    };

    const mockPersistence = {
      updateSession: vi.fn(),
    };

    Session.getSession = vi.fn().mockReturnValue(mockSession);
    Project.getById = vi.fn().mockReturnValue(mockProject);
    getPersistence.mockReturnValue(mockPersistence);

    const configUpdate = {
      provider: 'anthropic',
      model: 'claude-3-sonnet',
      maxTokens: 8000,
      toolPolicies: {
        'file-read': 'allow',
        'file-write': 'deny',
      },
    };

    const request = new NextRequest('http://localhost/api/sessions/test-session/configuration', {
      method: 'PUT',
      body: JSON.stringify(configUpdate),
      headers: { 'Content-Type': 'application/json' },
    });

    // This should FAIL initially because route still uses sessionService.updateSessionConfiguration
    await PUT(request, { params: { sessionId: 'test-session' } });

    // Verify session was retrieved
    expect(Session.getSession).toHaveBeenCalledWith('test-session');

    // Verify session.updateConfiguration was called directly
    expect(mockSession.updateConfiguration).toHaveBeenCalledWith(configUpdate);
  });
});
