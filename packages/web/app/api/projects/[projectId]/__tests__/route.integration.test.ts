// ABOUTME: Integration tests for individual project API endpoints using real Project class and database
// ABOUTME: Tests GET, PATCH, DELETE operations on specific projects without mocking behavior

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';

// Mock server-only before importing API routes
vi.mock('server-only', () => ({}));

import { GET, PATCH, DELETE } from '@/app/api/projects/[projectId]/route';

// Type interfaces for API responses
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

interface SuccessResponse {
  success: boolean;
}

describe('Individual Project API Integration Tests', () => {
  let testProject: import('~/projects/project').Project;

  beforeEach(async () => {
    setupTestPersistence();

    // Create a test project for each test
    const { Project } = await import('~/projects/project');
    testProject = Project.create('Test Project', '/test/path', 'A test project', { key: 'value' });
  });

  afterEach(() => {
    teardownTestPersistence();
  });

  describe('GET /api/projects/:projectId', () => {
    it('should return project when it exists', async () => {
      const request = new NextRequest(`http://localhost/api/projects/${testProject.getId()}`);
      const response = await GET(request, { params: Promise.resolve({ projectId: testProject.getId() }) });
      const data = (await response.json()) as ProjectResponse;

      expect(response.status).toBe(200);
      expect(data.project.id).toBe(testProject.getId());
      expect(data.project.name).toBe('Test Project');
      expect(data.project.description).toBe('A test project');
      expect(data.project.workingDirectory).toBe('/test/path');
      expect(data.project.isArchived).toBe(false);
      expect(data.project.sessionCount).toBe(0);
      expect(data.project.createdAt).toBeDefined();
      expect(data.project.lastUsedAt).toBeDefined();
    });

    it('should return project with correct session count', async () => {
      // Add some sessions to the project
      testProject.createSession('Session 1');
      testProject.createSession('Session 2');

      const request = new NextRequest(`http://localhost/api/projects/${testProject.getId()}`);
      const response = await GET(request, { params: Promise.resolve({ projectId: testProject.getId() }) });
      const data = (await response.json()) as ProjectResponse;

      expect(response.status).toBe(200);
      expect(data.project.sessionCount).toBe(2);
    });

    it('should return 404 when project does not exist', async () => {
      const request = new NextRequest('http://localhost/api/projects/non-existent-id');
      const response = await GET(request, { params: Promise.resolve({ projectId: 'non-existent-id' }) });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(404);
      expect(data.error).toBe('Project not found');
    });
  });

  describe('PATCH /api/projects/:projectId', () => {
    it('should update project name', async () => {
      const updateData = { name: 'Updated Project Name' };
      const request = new NextRequest(`http://localhost/api/projects/${testProject.getId()}`, {
        method: 'PATCH',
        body: JSON.stringify(updateData),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PATCH(request, { params: Promise.resolve({ projectId: testProject.getId() }) });
      const data = (await response.json()) as ProjectResponse;

      expect(response.status).toBe(200);
      expect(data.project.name).toBe('Updated Project Name');
      expect(data.project.description).toBe('A test project'); // Should remain unchanged
      expect(data.project.workingDirectory).toBe('/test/path'); // Should remain unchanged

      // Verify the update was persisted
      const { Project } = await import('~/projects/project');
      const updatedProject = Project.getById(testProject.getId());
      expect(updatedProject!.getName()).toBe('Updated Project Name');
    });

    it('should update project description', async () => {
      const updateData = { description: 'Updated description' };
      const request = new NextRequest(`http://localhost/api/projects/${testProject.getId()}`, {
        method: 'PATCH',
        body: JSON.stringify(updateData),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PATCH(request, { params: Promise.resolve({ projectId: testProject.getId() }) });
      const data = (await response.json()) as ProjectResponse;

      expect(response.status).toBe(200);
      expect(data.project.description).toBe('Updated description');
      expect(data.project.name).toBe('Test Project'); // Should remain unchanged

      // Verify the update was persisted
      const { Project } = await import('~/projects/project');
      const updatedProject = Project.getById(testProject.getId());
      expect(updatedProject!.getInfo()!.description).toBe('Updated description');
    });

    it('should update working directory', async () => {
      const updateData = { workingDirectory: '/updated/path' };
      const request = new NextRequest(`http://localhost/api/projects/${testProject.getId()}`, {
        method: 'PATCH',
        body: JSON.stringify(updateData),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PATCH(request, { params: Promise.resolve({ projectId: testProject.getId() }) });
      const data = (await response.json()) as ProjectResponse;

      expect(response.status).toBe(200);
      expect(data.project.workingDirectory).toBe('/updated/path');

      // Verify the update was persisted
      const { Project } = await import('~/projects/project');
      const updatedProject = Project.getById(testProject.getId());
      expect(updatedProject!.getWorkingDirectory()).toBe('/updated/path');
    });

    it('should update configuration', async () => {
      const updateData = { configuration: { newKey: 'newValue', another: 'config' } };
      const request = new NextRequest(`http://localhost/api/projects/${testProject.getId()}`, {
        method: 'PATCH',
        body: JSON.stringify(updateData),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PATCH(request, { params: Promise.resolve({ projectId: testProject.getId() }) });
      await response.json();

      expect(response.status).toBe(200);

      // Verify the update was persisted
      const { Project } = await import('~/projects/project');
      const updatedProject = Project.getById(testProject.getId());
      expect(updatedProject!.getConfiguration()).toEqual({ newKey: 'newValue', another: 'config' });
    });

    it('should archive project', async () => {
      const updateData = { isArchived: true };
      const request = new NextRequest(`http://localhost/api/projects/${testProject.getId()}`, {
        method: 'PATCH',
        body: JSON.stringify(updateData),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PATCH(request, { params: Promise.resolve({ projectId: testProject.getId() }) });
      const data = (await response.json()) as ProjectResponse;

      expect(response.status).toBe(200);
      expect(data.project.isArchived).toBe(true);

      // Verify the update was persisted
      const { Project } = await import('~/projects/project');
      const updatedProject = Project.getById(testProject.getId());
      expect(updatedProject!.getInfo()!.isArchived).toBe(true);
    });

    it('should unarchive project', async () => {
      // First archive the project
      testProject.archive();

      const updateData = { isArchived: false };
      const request = new NextRequest(`http://localhost/api/projects/${testProject.getId()}`, {
        method: 'PATCH',
        body: JSON.stringify(updateData),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PATCH(request, { params: Promise.resolve({ projectId: testProject.getId() }) });
      const data = (await response.json()) as ProjectResponse;

      expect(response.status).toBe(200);
      expect(data.project.isArchived).toBe(false);

      // Verify the update was persisted
      const { Project } = await import('~/projects/project');
      const updatedProject = Project.getById(testProject.getId());
      expect(updatedProject!.getInfo()!.isArchived).toBe(false);
    });

    it('should update multiple fields at once', async () => {
      const updateData = {
        name: 'Multi-Update Project',
        description: 'Multiple fields updated',
        workingDirectory: '/multi/path',
        isArchived: true,
        configuration: { multi: 'update' },
      };

      const request = new NextRequest(`http://localhost/api/projects/${testProject.getId()}`, {
        method: 'PATCH',
        body: JSON.stringify(updateData),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PATCH(request, { params: Promise.resolve({ projectId: testProject.getId() }) });
      const data = (await response.json()) as ProjectResponse;

      expect(response.status).toBe(200);
      expect(data.project.name).toBe('Multi-Update Project');
      expect(data.project.description).toBe('Multiple fields updated');
      expect(data.project.workingDirectory).toBe('/multi/path');
      expect(data.project.isArchived).toBe(true);

      // Verify all updates were persisted
      const { Project } = await import('~/projects/project');
      const updatedProject = Project.getById(testProject.getId());
      expect(updatedProject!.getName()).toBe('Multi-Update Project');
      expect(updatedProject!.getInfo()!.description).toBe('Multiple fields updated');
      expect(updatedProject!.getWorkingDirectory()).toBe('/multi/path');
      expect(updatedProject!.getInfo()!.isArchived).toBe(true);
      expect(updatedProject!.getConfiguration()).toEqual({ multi: 'update' });
    });

    it('should return 404 when project does not exist', async () => {
      const updateData = { name: 'Updated Name' };
      const request = new NextRequest('http://localhost/api/projects/non-existent-id', {
        method: 'PATCH',
        body: JSON.stringify(updateData),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PATCH(request, { params: Promise.resolve({ projectId: 'non-existent-id' }) });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(404);
      expect(data.error).toBe('Project not found');
    });

    it('should validate update data', async () => {
      const updateData = { name: '' }; // Empty name should be invalid
      const request = new NextRequest(`http://localhost/api/projects/${testProject.getId()}`, {
        method: 'PATCH',
        body: JSON.stringify(updateData),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PATCH(request, { params: Promise.resolve({ projectId: testProject.getId() }) });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request data');
      expect(data.details).toBeDefined();
    });
  });

  describe('DELETE /api/projects/:projectId', () => {
    it('should delete project successfully', async () => {
      const projectId = testProject.getId();
      const request = new NextRequest(`http://localhost/api/projects/${projectId}`);

      const response = await DELETE(request, { params: Promise.resolve({ projectId }) });
      const data = (await response.json()) as SuccessResponse;

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify the project was actually deleted
      const { Project } = await import('~/projects/project');
      const deletedProject = Project.getById(projectId);
      expect(deletedProject).toBeNull();
    });

    it('should delete project with sessions', async () => {
      // Add sessions to the project
      testProject.createSession('Session 1');
      testProject.createSession('Session 2');

      const projectId = testProject.getId();
      const request = new NextRequest(`http://localhost/api/projects/${projectId}`);

      const response = await DELETE(request, { params: Promise.resolve({ projectId }) });
      const data = (await response.json()) as SuccessResponse;

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify the project was actually deleted
      const { Project } = await import('~/projects/project');
      const deletedProject = Project.getById(projectId);
      expect(deletedProject).toBeNull();
    });

    it('should return 404 when project does not exist', async () => {
      const request = new NextRequest('http://localhost/api/projects/non-existent-id');

      const response = await DELETE(request, { params: Promise.resolve({ projectId: 'non-existent-id' }) });
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(404);
      expect(data.error).toBe('Project not found');
    });
  });
});
