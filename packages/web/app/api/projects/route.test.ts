// ABOUTME: Tests for project API endpoints including CRUD operations and error handling
// ABOUTME: Covers GET all projects, POST new project with validation and error scenarios

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { setupWebTest } from '@/test-utils/web-test-setup';

// Mock auth for business logic testing
vi.mock('@/lib/server/api-auth', () => ({
  requireAuth: vi.fn().mockReturnValue(null), // null = authenticated
  extractTokenFromRequest: vi.fn().mockReturnValue('mock-token'),
  createAuthErrorResponse: vi.fn()
}));

// CRITICAL: Setup test isolation BEFORE any imports that might initialize persistence
const _tempLaceDir = setupWebTest();
import { setupTestProviderDefaults, cleanupTestProviderDefaults } from '@/lib/server/lace-imports';
import { createTestProviderInstance, cleanupTestProviderInstances } from '@/lib/server/lace-imports';

import { GET, POST } from '@/app/api/projects/route';
import { parseResponse } from '@/lib/serialization';
import type { ProjectInfo } from '@/types/core';

interface ErrorResponse {
  error: string;
  details?: unknown;
}

describe('Projects API', () => {
  // _tempLaceDir already set up at module level  
  let providerInstanceId: string;

  beforeEach(async () => {
    setupTestProviderDefaults();
    const { Session } = await import('@/lib/server/lace-imports');
    Session.clearProviderCache();

    // Force persistence reset to ensure clean database state
    const { resetPersistence } = await import('~/persistence/database');
    resetPersistence();

    // Create test provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });
  });

  afterEach(async () => {
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances([providerInstanceId]);
    vi.clearAllMocks();
  });

  describe('GET /api/projects', () => {
    it('should return all projects', async () => {
      // Create projects using real Project class
      const { Project } = await import('~/projects/project');
      Project.create('Project 1', '/path/1', 'First project');
      Project.create('Project 2', '/path/2', 'Second project');

      const mockRequest = new Request('http://localhost:3000/api/projects') as NextRequest;
      const response = await GET(mockRequest);
      const data = await parseResponse<ProjectInfo[]>(response);

      expect(response.status).toBe(200);
      expect(data).toHaveLength(2);

      const proj1 = data.find((p) => p.name === 'Project 1');
      const proj2 = data.find((p) => p.name === 'Project 2');

      expect(proj1).toBeDefined();
      expect(proj1!.workingDirectory).toBe('/path/1');
      expect(proj1!.description).toBe('First project');

      expect(proj2).toBeDefined();
      expect(proj2!.workingDirectory).toBe('/path/2');
      expect(proj2!.description).toBe('Second project');
    });

    it('should return empty array when no projects exist', async () => {
      const mockRequest = new Request('http://localhost:3000/api/projects') as NextRequest;
      const response = await GET(mockRequest);
      const data = await parseResponse<ProjectInfo[]>(response);

      expect(response.status).toBe(200);
      expect(data).toHaveLength(0);
    });
  });

  describe('POST /api/projects', () => {
    it('should create new project with full data', async () => {
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

      const response = await POST(request);
      const data = await parseResponse<ProjectInfo>(response);

      expect(response.status).toBe(201);
      expect(data.name).toBe('New Project');
      expect(data.description).toBe('A new project');
      expect(data.workingDirectory).toBe('/new/path');
    });

    it('should create project with minimal required data', async () => {
      const requestBody = {
        name: 'Minimal Project',
        workingDirectory: '/minimal/path',
      };

      const request = new NextRequest('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await parseResponse<ProjectInfo>(response);

      expect(response.status).toBe(201);
      expect(data.name).toBe('Minimal Project');
      expect(data.description).toBe('');
      expect(data.workingDirectory).toBe('/minimal/path');
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
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request data');
    });

    it('should handle empty name by auto-generating', async () => {
      const requestBody = {
        name: '',
        workingDirectory: '/test/my-awesome-project',
      };

      const request = new NextRequest('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await parseResponse<ProjectInfo>(response);

      expect(response.status).toBe(201);
      expect(data.name).toBe('my-awesome-project');
      expect(data.workingDirectory).toBe('/test/my-awesome-project');
    });

    it('should handle creation errors gracefully', async () => {
      const requestBody = {
        name: 'Test Project',
        workingDirectory: '', // Invalid empty working directory
      };

      const request = new NextRequest('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request data');
    });
  });

  describe('Authentication', () => {
    it('should require authentication for GET requests', async () => {
      // Mock requireAuth to return an error response for this test
      const mockRequireAuth = vi.mocked(
        (await import('@/lib/server/api-auth')).requireAuth
      );
      mockRequireAuth.mockReturnValueOnce(
        NextResponse.json({ error: 'Authentication required' }, {
          status: 401,
        })
      );

      const mockRequest = new Request('http://localhost:3000/api/projects') as NextRequest;
      const response = await GET(mockRequest);

      expect(response.status).toBe(401);
      
      const data = await response.json();
      expect(data.error).toBe('Authentication required');
    });

    it('should require authentication for POST requests', async () => {
      // Mock requireAuth to return an error response for this test
      const mockRequireAuth = vi.mocked(
        (await import('@/lib/server/api-auth')).requireAuth
      );
      mockRequireAuth.mockReturnValueOnce(
        NextResponse.json({ error: 'Authentication required' }, {
          status: 401,
        })
      );

      const request = new NextRequest('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test', workingDirectory: '/test' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      
      const data = await response.json();
      expect(data.error).toBe('Authentication required');
    });
  });
});