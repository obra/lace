// ABOUTME: Tests for session configuration API tool permissions with explicit hierarchy structure
// ABOUTME: Validates that API returns tool policies with parent values and allowed options for progressive restriction

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Route } from '../api.sessions.$sessionId.configuration';
import { loader, action } from '../api.sessions.$sessionId.configuration';

// Mock the session service
const mockSession = {
  getEffectiveConfiguration: vi.fn(),
  updateConfiguration: vi.fn(),
  getProjectId: vi.fn(),
};

const mockProject = {
  getConfiguration: vi.fn(),
};

vi.mock('@/lib/server/session-service', () => ({
  getSessionService: vi.fn(() => ({
    getSession: vi.fn(() => mockSession),
  })),
}));

vi.mock('@/lib/server/lace-imports', () => ({
  ToolCatalog: {
    getAvailableTools: vi.fn(() => ['bash', 'file_read', 'filesystem/move_file']),
  },
  Project: {
    getById: vi.fn(() => mockProject),
  },
}));

describe('Session Configuration API - Tool Permissions Structure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.getProjectId.mockReturnValue('test-project-id');
  });

  describe('GET loader - Tool permissions with hierarchy', () => {
    it('should return tool permissions with parent values and allowed options', async () => {
      // Setup: Session has some overrides, project has policies, global has different policies
      mockSession.getEffectiveConfiguration.mockReturnValue({
        toolPolicies: {
          bash: 'ask', // Session overrides to ask
          'filesystem/move_file': null, // Session inherits from project
        },
      });

      mockProject.getConfiguration.mockReturnValue({
        toolPolicies: {
          bash: 'allow', // Project allows bash
          'filesystem/move_file': 'deny', // Project denies move_file
          file_read: 'ask', // Project asks for file_read
        },
      });

      const request = new Request('http://localhost/api/sessions/test-session/configuration');
      const params = { sessionId: 'test-session' };

      const response = await loader({ request, params, context: {} });
      const data = await response.json();

      expect(data.configuration.tools).toEqual({
        bash: {
          value: 'ask', // Current effective value
          allowedValues: ['ask', 'deny', 'disable'], // Can be equal or more restrictive than parent 'allow'
          projectValue: 'allow', // What project has set
        },
        file_read: {
          value: 'ask', // Inherited from project
          allowedValues: ['ask', 'deny', 'disable'], // Can be equal or more restrictive than parent 'ask'
          projectValue: 'ask', // What project has set
        },
        'filesystem/move_file': {
          value: 'deny', // Inherited from project
          allowedValues: ['deny', 'disable'], // Can only be equal or more restrictive than parent 'deny'
          projectValue: 'deny', // What project has set
        },
      });
    });

    it('should handle tools with no project override (inherit from global)', async () => {
      mockSession.getEffectiveConfiguration.mockReturnValue({
        toolPolicies: {},
      });

      mockProject.getConfiguration.mockReturnValue({
        toolPolicies: {}, // No project overrides
      });

      const request = new Request('http://localhost/api/sessions/test-session/configuration');
      const params = { sessionId: 'test-session' };

      const response = await loader({ request, params, context: {} });
      const data = await response.json();

      // When no project override, should show what options are available
      expect(data.configuration.tools['bash']).toEqual({
        value: 'ask', // Default policy
        allowedValues: ['allow', 'ask', 'deny', 'disable'], // All options available (no restrictions)
        // No projectValue since project doesn't override
      });
    });

    it('should calculate allowedValues based on most restrictive parent policy', async () => {
      mockSession.getEffectiveConfiguration.mockReturnValue({
        toolPolicies: {},
      });

      // Project denies the tool
      mockProject.getConfiguration.mockReturnValue({
        toolPolicies: {
          bash: 'deny',
        },
      });

      const request = new Request('http://localhost/api/sessions/test-session/configuration');
      const params = { sessionId: 'test-session' };

      const response = await loader({ request, params, context: {} });
      const data = await response.json();

      expect(data.configuration.tools['bash']).toEqual({
        value: 'deny', // Inherited from project
        allowedValues: ['deny', 'disable'], // Can only be equal or more restrictive
        projectValue: 'deny', // What project has set
      });
    });
  });

  describe('PUT action - Tool permissions validation', () => {
    it('should accept valid tool policy changes within allowed values', async () => {
      const request = new Request('http://localhost/api/sessions/test-session/configuration', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolPolicies: {
            bash: 'deny', // More restrictive than project 'allow' - should be valid
          },
        }),
      });
      const params = { sessionId: 'test-session' };

      mockSession.getEffectiveConfiguration.mockReturnValue({
        toolPolicies: {},
      });
      mockProject.getConfiguration.mockReturnValue({
        toolPolicies: { bash: 'allow' },
      });

      const response = await action({ request, params, context: {} });

      expect(response.status).toBe(200);
      expect(mockSession.updateConfiguration).toHaveBeenCalledWith({
        toolPolicies: { bash: 'deny' },
      });
    });

    it('should reject tool policy changes that are more permissive than parent', async () => {
      const request = new Request('http://localhost/api/sessions/test-session/configuration', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolPolicies: {
            bash: 'allow', // More permissive than project 'deny' - should fail
          },
        }),
      });
      const params = { sessionId: 'test-session' };

      mockProject.getConfiguration.mockReturnValue({
        toolPolicies: { bash: 'deny' },
      });

      const response = await action({ request, params, context: {} });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('more permissive than project policy');
    });
  });
});
