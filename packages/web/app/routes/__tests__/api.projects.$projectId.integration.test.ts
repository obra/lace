// ABOUTME: Integration tests for individual project API endpoints using real Project class and database
// ABOUTME: Tests GET, PATCH, DELETE operations on specific projects without mocking behavior

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { setupWebTest } from '@/test-utils/web-test-setup';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@/lib/server/lace-imports';

// Mock server-only before importing API routes
vi.mock('server-only', () => ({}));

import { loader as GET, action as PATCH } from '@/app/routes/api.projects.$projectId';
const DELETE = PATCH; // Both PATCH and DELETE use the same action function
import { parseResponse } from '@/lib/serialization';
import { Session } from '@/lib/server/lace-imports';
import type { ProjectInfo } from '@/types/core';

interface ErrorResponse {
  error: string;
  details?: unknown;
}

interface SuccessResponse {
  success: boolean;
}

describe('Individual Project API Integration Tests', () => {
  const _tempLaceDir = setupWebTest();
  let testProject: import('@/lib/server/lace-imports').Project;
  let anthropicInstanceId: string;
  let openaiInstanceId: string;

  beforeEach(async () => {
    // Create test provider instances
    anthropicInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    openaiInstanceId = await createTestProviderInstance({
      catalogId: 'openai',
      models: ['gpt-4o-mini', 'gpt-4o'],
      displayName: 'Test OpenAI Instance',
      apiKey: 'test-openai-key',
    });

    // Create a test project for each test
    const { Project } = await import('@/lib/server/lace-imports');
    testProject = Project.create('Test Project', '/test/path', 'A test project', {
      providerInstanceId: anthropicInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });
  });

  afterEach(async () => {
    // Clean up provider instances
    await cleanupTestProviderInstances([anthropicInstanceId, openaiInstanceId]);
    vi.clearAllMocks();
  });

  describe('GET /api/projects/:projectId', () => {
    it('should return project when it exists', async () => {
      const request = new NextRequest(`http://localhost/api/projects/${testProject.getId()}`);
      const response = await GET({
        request,
        params: { projectId: testProject.getId() },
      });
      const data = await parseResponse<ProjectInfo>(response);

      expect(response.status).toBe(200);
      expect(data.id).toBe(testProject.getId());
      expect(data.name).toBe('Test Project');
      expect(data.description).toBe('A test project');
      expect(data.workingDirectory).toBe('/test/path');
      expect(data.isArchived).toBe(false);
      expect(data.sessionCount).toBe(1); // Project.create() auto-creates a default session
      expect(data.createdAt).toBeDefined();
      expect(data.lastUsedAt).toBeDefined();
    });

    it('should return project with correct session count', async () => {
      // Add some sessions to the project (they inherit provider config from project)
      Session.create({
        name: 'Session 1',
        projectId: testProject.getId(),
      });
      Session.create({
        name: 'Session 2',
        projectId: testProject.getId(),
      });

      const request = new NextRequest(`http://localhost/api/projects/${testProject.getId()}`);
      const response = await GET({
        request,
        params: { projectId: testProject.getId() },
      });
      const data = await parseResponse<ProjectInfo>(response);

      expect(response.status).toBe(200);
      expect(data.sessionCount).toBe(3); // 1 auto-created + 2 explicitly created
    });

    it('should return 404 when project does not exist', async () => {
      const nonExistentId = 'd7af6313-2caa-4645-966e-05447d1524d1';
      const request = new NextRequest(`http://localhost/api/projects/${nonExistentId}`);
      const response = await GET({
        request,
        params: { projectId: nonExistentId },
      });
      const data = await parseResponse<ErrorResponse>(response);

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

      const response = await PATCH({
        request,
        params: { projectId: testProject.getId() },
      });
      const data = await parseResponse<ProjectInfo>(response);

      expect(response.status).toBe(200);
      expect(data.name).toBe('Updated Project Name');
      expect(data.description).toBe('A test project'); // Should remain unchanged
      expect(data.workingDirectory).toBe('/test/path'); // Should remain unchanged

      // Verify the update was persisted
      const { Project } = await import('@/lib/server/lace-imports');
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

      const response = await PATCH({
        request,
        params: { projectId: testProject.getId() },
      });
      const data = await parseResponse<ProjectInfo>(response);

      expect(response.status).toBe(200);
      expect(data.description).toBe('Updated description');
      expect(data.name).toBe('Test Project'); // Should remain unchanged

      // Verify the update was persisted
      const { Project } = await import('@/lib/server/lace-imports');
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

      const response = await PATCH({
        request,
        params: { projectId: testProject.getId() },
      });
      const data = await parseResponse<ProjectInfo>(response);

      expect(response.status).toBe(200);
      expect(data.workingDirectory).toBe('/updated/path');

      // Verify the update was persisted
      const { Project } = await import('@/lib/server/lace-imports');
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

      const response = await PATCH({
        request,
        params: { projectId: testProject.getId() },
      });
      await response.json();

      expect(response.status).toBe(200);

      // Verify the update was persisted
      const { Project } = await import('@/lib/server/lace-imports');
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

      const response = await PATCH({
        request,
        params: { projectId: testProject.getId() },
      });
      const data = await parseResponse<ProjectInfo>(response);

      expect(response.status).toBe(200);
      expect(data.isArchived).toBe(true);

      // Verify the update was persisted
      const { Project } = await import('@/lib/server/lace-imports');
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

      const response = await PATCH({
        request,
        params: { projectId: testProject.getId() },
      });
      const data = await parseResponse<ProjectInfo>(response);

      expect(response.status).toBe(200);
      expect(data.isArchived).toBe(false);

      // Verify the update was persisted
      const { Project } = await import('@/lib/server/lace-imports');
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

      const response = await PATCH({
        request,
        params: { projectId: testProject.getId() },
      });
      const data = await parseResponse<ProjectInfo>(response);

      expect(response.status).toBe(200);
      expect(data.name).toBe('Multi-Update Project');
      expect(data.description).toBe('Multiple fields updated');
      expect(data.workingDirectory).toBe('/multi/path');
      expect(data.isArchived).toBe(true);

      // Verify all updates were persisted
      const { Project } = await import('@/lib/server/lace-imports');
      const updatedProject = Project.getById(testProject.getId());
      expect(updatedProject!.getName()).toBe('Multi-Update Project');
      expect(updatedProject!.getInfo()!.description).toBe('Multiple fields updated');
      expect(updatedProject!.getWorkingDirectory()).toBe('/multi/path');
      expect(updatedProject!.getInfo()!.isArchived).toBe(true);
      expect(updatedProject!.getConfiguration()).toEqual({ multi: 'update' });
    });

    it('should return 404 when project does not exist', async () => {
      const nonExistentId = 'd7af6313-2caa-4645-966e-05447d1524d1';
      const updateData = { name: 'Updated Name' };
      const request = new NextRequest(`http://localhost/api/projects/${nonExistentId}`, {
        method: 'PATCH',
        body: JSON.stringify(updateData),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PATCH({
        request,
        params: { projectId: nonExistentId },
      });
      const data = await parseResponse<ErrorResponse>(response);

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

      const response = await PATCH({
        request,
        params: { projectId: testProject.getId() },
      });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request data');
      expect(data.details).toBeDefined();
    });
  });

  describe('DELETE /api/projects/:projectId', () => {
    it('should delete project successfully', async () => {
      const projectId = testProject.getId();
      const request = new NextRequest(`http://localhost/api/projects/${projectId}`, {
        method: 'DELETE',
      });

      const response = await DELETE({ request, params: { projectId } });
      const data = await parseResponse<SuccessResponse>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify the project was actually deleted
      const { Project } = await import('@/lib/server/lace-imports');
      const deletedProject = Project.getById(projectId);
      expect(deletedProject).toBeNull();
    });

    it('should delete project with sessions', async () => {
      // Add sessions to the project
      Session.create({
        name: 'Session 1',
        projectId: testProject.getId(),
        configuration: {
          providerInstanceId: anthropicInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        },
      });
      Session.create({
        name: 'Session 2',
        projectId: testProject.getId(),
        configuration: {
          providerInstanceId: openaiInstanceId,
          modelId: 'gpt-4o-mini',
        },
      });

      const projectId = testProject.getId();
      const request = new NextRequest(`http://localhost/api/projects/${projectId}`, {
        method: 'DELETE',
      });

      const response = await DELETE({ request, params: { projectId } });
      const data = await parseResponse<SuccessResponse>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify the project was actually deleted
      const { Project } = await import('@/lib/server/lace-imports');
      const deletedProject = Project.getById(projectId);
      expect(deletedProject).toBeNull();
    });

    it('should return 404 when project does not exist', async () => {
      const nonExistentId = 'd7af6313-2caa-4645-966e-05447d1524d1';
      const request = new NextRequest(`http://localhost/api/projects/${nonExistentId}`, {
        method: 'DELETE',
      });

      const response = await DELETE({
        request,
        params: { projectId: nonExistentId },
      });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Project not found');
    });
  });
});
