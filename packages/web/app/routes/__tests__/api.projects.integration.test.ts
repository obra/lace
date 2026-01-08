// ABOUTME: Integration tests for project API endpoints using real Project class and database
// ABOUTME: Tests actual behavior without mocking the Project class - uses real database operations

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';

// CRITICAL: Setup test isolation BEFORE any imports that might initialize persistence
const context = setupWebTest();
import { Project } from '@lace/web/lib/server/projects/project';
import { parseResponse } from '@lace/web/lib/serialization';
import type { ProjectInfo } from '@lace/web/types/core';
import { promises as fs } from 'fs';
import { join } from 'path';
import { getSupervisor, shutdownSupervisorForTests } from '@lace/web/lib/server/supervisor-service';
import {
  createEntTestConnection,
  deleteEntTestConnection,
} from '@lace/web/test-utils/ent-test-helpers';

// Mock server-only before importing API routes
vi.mock('server-only', () => ({}));

import { loader, action } from '@lace/web/app/routes/api.projects';
import { createLoaderArgs, createActionArgs } from '@lace/web/test-utils/route-test-helpers';

interface ErrorResponse {
  error: string;
  details?: unknown;
}

describe('Projects API Integration Tests', () => {
  // context already set up at module level
  let providerInstanceId: string;

  beforeEach(async () => {
    providerInstanceId = (await createEntTestConnection({ providerId: 'openai' })).connectionId;
  });

  afterEach(async () => {
    await shutdownSupervisorForTests();
    await deleteEntTestConnection(providerInstanceId);
    vi.clearAllMocks();
  });

  describe('GET /api/projects', () => {
    it('should return all projects with session counts', async () => {
      // Create some test projects directly using the real Project class
      const project1Dir = join(context.tempProjectDir, 'project1');
      const project2Dir = join(context.tempProjectDir, 'project2');
      await fs.mkdir(project1Dir, { recursive: true });
      await fs.mkdir(project2Dir, { recursive: true });

      const project1 = Project.create('Project 1', project1Dir, 'First project', {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      });
      const project2 = Project.create('Project 2', project2Dir, 'Second project', {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      });

      // Create workspace sessions for project1 to test session counting
      const supervisor = await getSupervisor();
      const ws1 = await supervisor.createWorkspaceSession(project1Dir);
      const ws2 = await supervisor.createWorkspaceSession(project1Dir);
      await supervisor.updateWorkspaceSession(ws1.workspaceSessionId, {
        projectId: project1.getId(),
      });
      await supervisor.updateWorkspaceSession(ws2.workspaceSessionId, {
        projectId: project1.getId(),
      });

      const response = await loader(
        createLoaderArgs(new Request('http://localhost/api/projects'), {})
      );
      const data = await parseResponse<ProjectInfo[]>(response);

      expect(response.status).toBe(200);
      expect(data).toHaveLength(2); // 2 created projects

      // Find our created projects
      const proj1 = data.find((p) => p.name === 'Project 1');
      const proj2 = data.find((p) => p.name === 'Project 2');

      expect(proj1).toBeDefined();
      expect(proj1!.sessionCount).toBe(2);
      expect(proj1!.workingDirectory).toBe(project1Dir);
      expect(proj1!.description).toBe('First project');
      expect(proj1!.isArchived).toBe(false);

      expect(proj2).toBeDefined();
      expect(proj2!.sessionCount).toBe(0);
      expect(proj2!.workingDirectory).toBe(project2Dir);
      expect(proj2!.description).toBe('Second project');
      expect(proj2!.isArchived).toBe(false);
      expect(proj2!.id).toBe(project2.getId());
    });

    it('should return empty projects array when no projects exist', async () => {
      const response = await loader(
        createLoaderArgs(new Request('http://localhost/api/projects'), {})
      );
      const data = await parseResponse<ProjectInfo[]>(response);

      expect(response.status).toBe(200);
      expect(data).toHaveLength(0); // No projects in clean database
    });
  });

  describe('POST /api/projects', () => {
    it('should create new project with all fields', async () => {
      const newProjectDir = join(context.tempProjectDir, 'new-project');
      await fs.mkdir(newProjectDir, { recursive: true });

      const requestBody = {
        name: 'New Project',
        description: 'A new project',
        workingDirectory: newProjectDir,
        configuration: { key: 'value' },
      };

      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await action(createActionArgs(request, {}));
      const data = await parseResponse<ProjectInfo>(response);

      expect(response.status).toBe(201);
      expect(data.name).toBe('New Project');
      expect(data.description).toBe('A new project');
      expect(data.workingDirectory).toBe(newProjectDir);
      expect(data.isArchived).toBe(false);
      expect(data.sessionCount).toBe(0);
      expect(data.id).toBeDefined();
      expect(data.createdAt).toBeDefined();
      expect(data.lastUsedAt).toBeDefined();

      // Verify the project was actually created in the database
      const createdProject = Project.getById(data.id);
      expect(createdProject).not.toBeNull();
      expect(createdProject!.getName()).toBe('New Project');
      expect(createdProject!.getWorkingDirectory()).toBe(newProjectDir);
      expect(createdProject!.getConfiguration()).toEqual({ key: 'value' });
    });

    it('should create project with minimal required fields', async () => {
      const minimalDir = join(context.tempProjectDir, 'minimal-project');
      await fs.mkdir(minimalDir, { recursive: true });

      const requestBody = {
        name: 'Minimal Project',
        workingDirectory: minimalDir,
      };

      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await action(createActionArgs(request, {}));
      const data = await parseResponse<ProjectInfo>(response);

      expect(response.status).toBe(201);
      expect(data.name).toBe('Minimal Project');
      expect(data.description).toBe('');
      expect(data.workingDirectory).toBe(minimalDir);
      expect(data.id).toBeDefined();

      // Verify the project was actually created in the database
      const createdProject = Project.getById(data.id);
      expect(createdProject).not.toBeNull();
      expect(createdProject!.getName()).toBe('Minimal Project');
      expect(createdProject!.getConfiguration()).toEqual({});
    });

    it('should validate required fields', async () => {
      const requestBody = {
        description: 'Missing name and workingDirectory',
      };

      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await action(createActionArgs(request, {}));
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request data');
      expect(data.details).toBeDefined();
    });

    it('should auto-generate name from directory when name is empty', async () => {
      const awesomeDir = join(context.tempProjectDir, 'my-awesome-project');
      await fs.mkdir(awesomeDir, { recursive: true });

      const requestBody = {
        name: '',
        workingDirectory: awesomeDir,
      };

      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await action(createActionArgs(request, {}));
      const data = await parseResponse<ProjectInfo>(response);

      expect(response.status).toBe(201);
      expect(data.name).toBe('my-awesome-project');
      expect(data.workingDirectory).toBe(awesomeDir);
    });

    it('should validate empty working directory', async () => {
      const requestBody = {
        name: 'Test Project',
        workingDirectory: '',
      };

      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await action(createActionArgs(request, {}));
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request data');
      expect(data.details).toBeDefined();
    });

    it('should handle invalid JSON in request body', async () => {
      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        body: 'invalid json',
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await action(createActionArgs(request, {}));
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(500);
      expect(data.error).toBeDefined();
    });

    it('should handle duplicate project names', async () => {
      const duplicateDir = join(context.tempProjectDir, 'duplicate-project');
      await fs.mkdir(duplicateDir, { recursive: true });

      const requestBody = {
        name: 'Duplicate Project',
        workingDirectory: duplicateDir,
      };

      const request1 = new Request('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const request2 = new Request('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      // Create first project
      const response1 = await action(createActionArgs(request1, {}));
      expect(response1.status).toBe(201);

      // Create second project with same name (should succeed - names don't need to be unique)
      const response2 = await action(createActionArgs(request2, {}));
      expect(response2.status).toBe(201);

      // Verify both projects exist
      const getResponse = await loader(
        createLoaderArgs(new Request('http://localhost/api/projects'), {})
      );
      const data = await parseResponse<ProjectInfo[]>(getResponse);
      const duplicateProjects = data.filter((p) => p.name === 'Duplicate Project');
      expect(duplicateProjects).toHaveLength(2);
    });
  });
});
