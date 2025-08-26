// ABOUTME: Tests for individual project API endpoints - GET, PATCH, DELETE by project ID
// ABOUTME: Tests HTTP behavior, response data, and error handling rather than mock interactions

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { loader as GET, action as PATCH } from '@/app/routes/api.projects.$projectId';
const DELETE = PATCH; // Both PATCH and DELETE use the same action function
import { parseResponse } from '@/lib/serialization';
import type { ProjectInfo } from '@/types/core';

interface ErrorResponse {
  error: string;
  details?: unknown;
}

interface SuccessResponse {
  success: boolean;
}

// Mock project instance
const mockProject = {
  getId: vi.fn().mockReturnValue('test-project'),
  getInfo: vi.fn().mockReturnValue({
    id: 'test-project',
    name: 'Test Project',
    description: 'A test project',
    workingDirectory: '/test/path',
    isArchived: false,
    createdAt: new Date('2023-01-01'),
    lastUsedAt: new Date('2023-01-01'),
    sessionCount: 0,
  }),
  updateInfo: vi.fn(),
  delete: vi.fn(),
};

vi.mock('@/lib/server/lace-imports', () => ({
  Project: {
    getById: vi.fn(),
  },
}));

describe('Individual Project API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/projects/:projectId', () => {
    it('should return project when found', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(mockProject);

      const request = new NextRequest('http://localhost/api/projects/test-project', {
        method: 'DELETE',
      });
      const response = await GET({
        request,
        params: { projectId: 'test-project' },
      });
      const data = await parseResponse<ProjectInfo>(response);

      expect(response.status).toBe(200);
      expect(data).toEqual({
        id: 'test-project',
        name: 'Test Project',
        description: 'A test project',
        workingDirectory: '/test/path',
        isArchived: false,
        createdAt: new Date('2023-01-01T00:00:00.000Z'),
        lastUsedAt: new Date('2023-01-01T00:00:00.000Z'),
        sessionCount: 0,
      });
    });

    it('should return 404 when project not found', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/projects/nonexistent');
      const response = await GET({
        request,
        params: { projectId: 'nonexistent' },
      });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Project not found');
    });

    it('should handle errors gracefully', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockImplementation(() => {
        throw new Error('Database error');
      });

      const request = new NextRequest('http://localhost/api/projects/test-project', {
        method: 'DELETE',
      });
      const response = await GET({
        request,
        params: { projectId: 'test-project' },
      });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Database error');
    });
  });

  describe('PATCH /api/projects/:projectId', () => {
    it('should update project successfully', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(mockProject);

      const updates = {
        name: 'Updated Project',
        description: 'Updated description',
        isArchived: true,
      };

      const request = new NextRequest('http://localhost/api/projects/test-project', {
        method: 'PATCH',
        body: JSON.stringify(updates),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PATCH({
        request,
        params: { projectId: 'test-project' },
      });
      const data = await parseResponse<ProjectInfo>(response);

      expect(response.status).toBe(200);
      expect(data).toBeDefined();
    });

    it('should return 404 when project not found', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/projects/nonexistent', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PATCH({
        request,
        params: { projectId: 'nonexistent' },
      });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Project not found');
    });

    it('should validate update data', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(mockProject);

      const invalidUpdates = {
        name: '', // Empty name should be invalid
        workingDirectory: '', // Empty working directory should be invalid
      };

      const request = new NextRequest('http://localhost/api/projects/test-project', {
        method: 'PATCH',
        body: JSON.stringify(invalidUpdates),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PATCH({
        request,
        params: { projectId: 'test-project' },
      });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request data');
      expect(data.details).toBeDefined();
    });

    it('should handle update errors', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(mockProject);
      mockProject.updateInfo = vi.fn().mockImplementation(() => {
        throw new Error('Update failed');
      });

      const request = new NextRequest('http://localhost/api/projects/test-project', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PATCH({
        request,
        params: { projectId: 'test-project' },
      });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Update failed');
    });
  });

  describe('DELETE /api/projects/:projectId', () => {
    it('should delete project successfully', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(mockProject);

      const request = new NextRequest('http://localhost/api/projects/test-project', {
        method: 'DELETE',
      });
      const response = await DELETE({
        request,
        params: { projectId: 'test-project' },
      });
      const data = await parseResponse<SuccessResponse>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should return 404 when project not found', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/projects/nonexistent', {
        method: 'DELETE',
      });
      const response = await DELETE({
        request,
        params: { projectId: 'nonexistent' },
      });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Project not found');
    });

    it('should handle deletion errors', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(mockProject);
      mockProject.delete = vi.fn().mockImplementation(() => {
        throw new Error('Deletion failed');
      });

      const request = new NextRequest('http://localhost/api/projects/test-project', {
        method: 'DELETE',
      });
      const response = await DELETE({
        request,
        params: { projectId: 'test-project' },
      });
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Deletion failed');
    });
  });
});
