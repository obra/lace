// ABOUTME: Tests for project configuration API endpoints - GET, PUT for project configuration management
// ABOUTME: Covers configuration retrieval, updates with validation and error handling

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loader, action } from '@/app/routes/api.projects.$projectId.configuration';
import { parseResponse } from '@/lib/serialization';
import { createLoaderArgs, createActionArgs } from '@/test-utils/route-test-helpers';

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

const mockToolExecutor = {
  registerAllAvailableTools: vi.fn(),
  getAllTools: vi.fn(() => [
    { name: 'file-read', annotations: {} },
    { name: 'file-write', annotations: {} },
    { name: 'bash', annotations: {} },
    { name: 'internal-tool', annotations: { safeInternal: true } },
  ]),
};

// Mock project instance
const mockProject = {
  getId: vi.fn().mockReturnValue('test-project'),
  getConfiguration: vi.fn().mockReturnValue({
    provider: 'anthropic',
    model: 'claude-3-sonnet',
    maxTokens: 4000,
    tools: ['file-read', 'file-write'],
    toolPolicies: {
      'file-read': 'allow',
      'file-write': 'ask',
    },
    workingDirectory: '/test/path',
    environmentVariables: { NODE_ENV: 'test' },
  }),
  updateConfiguration: vi.fn(),
  createToolExecutor: vi.fn().mockResolvedValue(mockToolExecutor),
};

vi.mock('@/lib/server/lace-imports', () => ({
  Project: {
    getById: vi.fn(),
  },
  ProviderRegistry: {
    getInstance: vi.fn(() => ({
      getConfiguredInstances: vi.fn(() => []),
    })),
  },
  ToolCatalog: {
    getAvailableTools: vi.fn(() => ['file_read', 'file_write', 'bash']),
  },
}));

describe('Project Configuration API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/projects/:projectId/configuration', () => {
    it('should return project configuration when found', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(mockProject);

      const request = new Request('http://localhost/api/projects/test-project/configuration');
      const response = await loader(createLoaderArgs(request, { projectId: 'test-project' }));
      const data = await parseResponse<ConfigurationResponse>(response);

      expect(response.status).toBe(200);
      expect(data.configuration).toEqual({
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        maxTokens: 4000,
        tools: ['file-read', 'file-write'],
        toolPolicies: {
          'file-read': 'allow',
          'file-write': 'ask',
        },
        workingDirectory: '/test/path',
        environmentVariables: { NODE_ENV: 'test' },
        availableTools: ['file_read', 'file_write', 'bash'], // From ToolCatalog
      });
    });

    it('should return 404 when project not found', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(null);

      const request = new Request('http://localhost/api/projects/nonexistent/configuration');
      const response = await loader(createLoaderArgs(request, { projectId: 'nonexistent' }));
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Project not found');
    });

    it('should handle errors gracefully', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockImplementation(() => {
        throw new Error('Database error');
      });

      const request = new Request('http://localhost/api/projects/test-project/configuration');
      const response = await loader(createLoaderArgs(request, { projectId: 'test-project' }));
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Database error');
    });
  });

  describe('PUT /api/projects/:projectId/configuration', () => {
    it('should update project configuration successfully', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(mockProject);

      const updates = {
        provider: 'openai',
        model: 'gpt-4',
        maxTokens: 8000,
        tools: ['file-read', 'file-write', 'bash'],
        toolPolicies: {
          'file-read': 'allow',
          'file-write': 'ask',
          bash: 'deny',
        },
      };

      const request = new Request('http://localhost/api/projects/test-project/configuration', {
        method: 'PUT',
        body: JSON.stringify(updates),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await action(createActionArgs(request, { projectId: 'test-project' }));
      const data = await parseResponse<ConfigurationResponse>(response);

      expect(response.status).toBe(200);
      expect(data.configuration).toBeDefined();
    });

    it('should return 404 when project not found', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(null);

      const request = new Request('http://localhost/api/projects/nonexistent/configuration', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'openai' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await action(createActionArgs(request, { projectId: 'nonexistent' }));
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Project not found');
    });

    it('should validate configuration data', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(mockProject);

      const invalidUpdates = {
        maxTokens: -1, // Negative maxTokens should be invalid
        toolPolicies: {
          'file-read': 'invalid-policy', // Invalid policy should be invalid
        },
      };

      const request = new Request('http://localhost/api/projects/test-project/configuration', {
        method: 'PUT',
        body: JSON.stringify(invalidUpdates),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await action(createActionArgs(request, { projectId: 'test-project' }));
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(400);
      expect(data.error).toContain('Validation failed');
      expect(data.details).toBeDefined();
    });

    it('should handle update errors', async () => {
      const { Project } = vi.mocked(await import('@/lib/server/lace-imports'));
      Project.getById = vi.fn().mockReturnValue(mockProject);
      mockProject.updateConfiguration = vi.fn().mockImplementation(() => {
        throw new Error('Update failed');
      });

      const request = new Request('http://localhost/api/projects/test-project/configuration', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'openai' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await action(createActionArgs(request, { projectId: 'test-project' }));
      const data = await parseResponse<ErrorResponse>(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Update failed');
    });
  });
});
