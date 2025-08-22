// ABOUTME: Integration tests for project API endpoints using real Project class and database
// ABOUTME: Tests actual behavior without mocking the Project class - uses real database operations

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { setupWebTest } from '@/test-utils/web-test-setup';

// CRITICAL: Setup test isolation BEFORE any imports that might initialize persistence
const _tempLaceDir = setupWebTest();
import { setupTestProviderDefaults, cleanupTestProviderDefaults } from '@/lib/server/lace-imports';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@/lib/server/lace-imports';
import { parseResponse } from '@/lib/serialization';
import type { ProjectInfo } from '@/types/core';

// Mock server-only before importing API routes
vi.mock('server-only', () => ({}));

import { GET, POST } from '@/app/api/projects/route';

interface ErrorResponse {
  error: string;
  details?: unknown;
}

describe('Projects API Integration Tests', () => {
  // _tempLaceDir already set up at module level
  let providerInstanceId: string;

  beforeEach(async () => {
    setupTestProviderDefaults();

    // Force persistence reset to ensure clean database state
    const { resetPersistence } = await import('@lace/core/persistence/database');
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
    it('should return all projects with session counts', async () => {
      // Create some test projects directly using the real Project class
      const { Project } = await import('@lace/core/projects/project');

      const project1 = Project.create('Project 1', '/path/1', 'First project', {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      });
      Project.create('Project 2', '/path/2', 'Second project', {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      });

      // Create sessions in project1 to test session counting
      const { Session } = await import('@lace/core/sessions/session');
      Session.create({
        name: 'Session 1',
        projectId: project1.getId(),
      });
      Session.create({
        name: 'Session 2',
        projectId: project1.getId(),
      });

      const response = await GET();
      const data = await parseResponse<ProjectInfo[]>(response);

      expect(response.status).toBe(200);
      expect(data).toHaveLength(2); // 2 created projects

      // Find our created projects
      const proj1 = data.find((p) => p.name === 'Project 1');
      const proj2 = data.find((p) => p.name === 'Project 2');

      expect(proj1).toBeDefined();
      expect(proj1!.sessionCount).toBe(3); // 1 auto-created + 2 explicitly created
      expect(proj1!.workingDirectory).toBe('/path/1');
      expect(proj1!.description).toBe('First project');
      expect(proj1!.isArchived).toBe(false);

      expect(proj2).toBeDefined();
      expect(proj2!.sessionCount).toBe(1); // Project.create() auto-creates a default session
      expect(proj2!.workingDirectory).toBe('/path/2');
      expect(proj2!.description).toBe('Second project');
      expect(proj2!.isArchived).toBe(false);
    });

    it('should return empty projects array when no projects exist', async () => {
      const response = await GET();
      const data = await parseResponse<ProjectInfo[]>(response);

      expect(response.status).toBe(200);
      expect(data).toHaveLength(0); // No projects in clean database
    });
  });

  describe('POST /api/projects', () => {
    it('should create new project with all fields', async () => {
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
      expect(data.isArchived).toBe(false);
      expect(data.sessionCount).toBe(1); // Project.create() auto-creates a default session
      expect(data.id).toBeDefined();
      expect(data.createdAt).toBeDefined();
      expect(data.lastUsedAt).toBeDefined();

      // Verify the project was actually created in the database
      const { Project } = await import('@lace/core/projects/project');
      const createdProject = Project.getById(data.id);
      expect(createdProject).not.toBeNull();
      expect(createdProject!.getName()).toBe('New Project');
      expect(createdProject!.getWorkingDirectory()).toBe('/new/path');
      expect(createdProject!.getConfiguration()).toEqual({ key: 'value' });
    });

    it('should create project with minimal required fields', async () => {
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
      expect(data.id).toBeDefined();

      // Verify the project was actually created in the database
      const { Project } = await import('@lace/core/projects/project');
      const createdProject = Project.getById(data.id);
      expect(createdProject).not.toBeNull();
      expect(createdProject!.getName()).toBe('Minimal Project');
      expect(createdProject!.getConfiguration()).toEqual({});
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
      expect(data.details).toBeDefined();
    });

    it('should auto-generate name from directory when name is empty', async () => {
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

    it('should validate empty working directory', async () => {
      const requestBody = {
        name: 'Test Project',
        workingDirectory: '',
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
      expect(data.details).toBeDefined();
    });

    it('should handle invalid JSON in request body', async () => {
      const request = new NextRequest('http://localhost/api/projects', {
        method: 'POST',
        body: 'invalid json',
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(500);
      expect(data.error).toBeDefined();
    });

    it('should handle duplicate project names', async () => {
      const requestBody = {
        name: 'Duplicate Project',
        workingDirectory: '/duplicate/path',
      };

      const request1 = new NextRequest('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const request2 = new NextRequest('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      // Create first project
      const response1 = await POST(request1);
      expect(response1.status).toBe(201);

      // Create second project with same name (should succeed - names don't need to be unique)
      const response2 = await POST(request2);
      expect(response2.status).toBe(201);

      // Verify both projects exist
      const getResponse = await GET();
      const data = await parseResponse<ProjectInfo[]>(getResponse);
      const duplicateProjects = data.filter((p) => p.name === 'Duplicate Project');
      expect(duplicateProjects).toHaveLength(2);
    });
  });
});
