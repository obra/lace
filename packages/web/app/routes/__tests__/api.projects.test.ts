// ABOUTME: Tests for project API endpoints including CRUD operations and error handling
// ABOUTME: Covers GET all projects, POST new project with validation and error scenarios

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';
import { loader, action } from '@lace/web/app/routes/api.projects';
import { createLoaderArgs, createActionArgs } from '@lace/web/test-utils/route-test-helpers';
import { parseResponse } from '@lace/web/lib/serialization';
import type { ProjectInfo } from '@lace/web/types/core';
import { promises as fs } from 'fs';
import { join } from 'path';

interface ErrorResponse {
  error: string;
  details?: unknown;
}

// Setup test context BEFORE imports
const context = setupWebTest();

describe('Projects API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/projects', () => {
    it('should return all projects', async () => {
      // Arrange: Create test projects using real Project class
      const { Project } = await import('@lace/web/lib/server/lace-imports');

      // Create temp project directories
      const dir1 = join(context.tempProjectDir, 'project1');
      const dir2 = join(context.tempProjectDir, 'project2');
      await fs.mkdir(dir1, { recursive: true });
      await fs.mkdir(dir2, { recursive: true });

      // Create projects and they will be stored in our mocked persistence
      const _project1 = Project.create('Project 1', dir1, 'First project');
      const _project2 = Project.create('Project 2', dir2, 'Second project');

      // Act: Call the API endpoint
      const response = await loader(
        createLoaderArgs(new Request('http://localhost/api/projects'), {})
      );
      const data = await parseResponse<ProjectInfo[]>(response);

      // Assert: Verify the projects are returned
      expect(response.status).toBe(200);
      expect(data).toHaveLength(2);

      // Find projects by name since IDs are generated
      const returnedProject1 = data.find((p) => p.name === 'Project 1');
      const returnedProject2 = data.find((p) => p.name === 'Project 2');

      expect(returnedProject1).toMatchObject({
        name: 'Project 1',
        description: 'First project',
        workingDirectory: dir1,
        isArchived: false,
        sessionCount: 0,
      });
      expect(returnedProject2).toMatchObject({
        name: 'Project 2',
        description: 'Second project',
        workingDirectory: dir2,
        isArchived: false,
        sessionCount: 0,
      });
    });

    it('should return empty array when no projects exist', async () => {
      // Act: Call API with no projects created
      const response = await loader(
        createLoaderArgs(new Request('http://localhost/api/projects'), {})
      );
      const data = await parseResponse<ProjectInfo[]>(response);

      // Assert: Empty array returned
      expect(response.status).toBe(200);
      expect(data).toHaveLength(0);
    });
  });

  describe('POST /api/projects', () => {
    it('should create new project with full data', async () => {
      // Arrange: Create temp directory and prepare request with full project data
      const newDir = join(context.tempProjectDir, 'new-project');
      await fs.mkdir(newDir, { recursive: true });

      const requestBody = {
        name: 'New Project',
        description: 'A new project',
        workingDirectory: newDir,
        configuration: { key: 'value' },
      };

      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      // Act: Create the project via API
      const response = await action(createActionArgs(request, {}));
      const data = await parseResponse<ProjectInfo>(response);

      // Assert: Verify project was created with correct data
      expect(response.status).toBe(201);
      expect(data).toMatchObject({
        name: 'New Project',
        description: 'A new project',
        workingDirectory: newDir,
        isArchived: false,
        sessionCount: 0,
      });
      expect(data.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(data.createdAt).toBeTruthy();
      expect(data.lastUsedAt).toBeTruthy();

      // Verify the project can be retrieved via Project.getAll() (tests persistence)
      const { Project } = await import('@lace/web/lib/server/lace-imports');
      const allProjects = Project.getAll();
      const createdProject = allProjects.find((p) => p.name === 'New Project');
      expect(createdProject).toBeTruthy();
      expect(createdProject?.description).toBe('A new project');
    });

    it('should create project with minimal required data', async () => {
      // Arrange: Create temp directory and request with only required fields
      const minimalDir = join(context.tempProjectDir, 'minimal');
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

      // Act: Create project with minimal data
      const response = await action(createActionArgs(request, {}));
      const data = await parseResponse<ProjectInfo>(response);

      // Assert: Verify project created with defaults for optional fields
      expect(response.status).toBe(201);
      expect(data).toMatchObject({
        name: 'Minimal Project',
        description: '', // Default empty description
        workingDirectory: minimalDir,
        isArchived: false,
        sessionCount: 0,
      });
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

    it('should handle empty name by auto-generating', async () => {
      const testDir = join(context.tempProjectDir, 'auto-name');
      await fs.mkdir(testDir, { recursive: true });

      const requestBody = {
        name: '',
        workingDirectory: testDir,
      };

      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await action(createActionArgs(request, {}));
      const data = await parseResponse<ProjectInfo>(response);

      expect(response.status).toBe(201);
      expect(data.name).toBeTruthy(); // Auto-generated name should exist
      expect(data.name).not.toBe(''); // Should not be empty
    });

    it('should handle creation errors gracefully', async () => {
      const errorTestDir = join(context.tempProjectDir, 'missing-directory');

      const requestBody = {
        name: 'Test Project',
        workingDirectory: errorTestDir,
      };

      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      // Act: Attempt to create project when persistence fails
      const response = await action(createActionArgs(request, {}));
      const data = await parseResponse<ErrorResponse>(response);

      // Assert: API handles the persistence error gracefully
      expect(response.status).toBe(500);
      expect(data.error).toContain('does not exist');
    });
  });
});
