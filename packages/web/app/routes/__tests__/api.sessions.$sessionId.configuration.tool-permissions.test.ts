// ABOUTME: Integration tests for session configuration API tool permissions with explicit hierarchy structure
// ABOUTME: Uses real sessions and projects to test progressive restriction without mocking

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loader as GET, action as PUT } from '@/app/routes/api.sessions.$sessionId.configuration';
import { getSessionService } from '@/lib/server/session-service';
import { Project, Session } from '@/lib/server/lace-imports';
import { setupWebTest } from '@/test-utils/web-test-setup';
import { setupTestProviderDefaults, cleanupTestProviderDefaults } from '@/lib/server/lace-imports';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@/lib/server/lace-imports';
import { parseResponse } from '@/lib/serialization';
import { createLoaderArgs, createActionArgs } from '@/test-utils/route-test-helpers';

// Type interfaces for new API structure
interface ToolPermissionInfo {
  value: 'allow' | 'ask' | 'deny' | 'disable';
  allowedValues: Array<'allow' | 'ask' | 'deny' | 'disable'>;
  projectValue?: 'allow' | 'ask' | 'deny' | 'disable';
  globalValue?: 'allow' | 'ask' | 'deny' | 'disable';
}

interface ConfigurationResponse {
  configuration: {
    tools?: Record<string, ToolPermissionInfo>;
    availableTools?: string[];
    [key: string]: unknown;
  };
}

describe('Session Configuration API - Tool Permissions Structure', () => {
  const _tempLaceDir = setupWebTest();
  let _sessionService: ReturnType<typeof getSessionService>;
  let testProject: ReturnType<typeof Project.create>;
  let sessionId: string;
  let providerInstanceId: string;

  beforeEach(async () => {
    setupTestProviderDefaults();
    process.env.LACE_DB_PATH = ':memory:';

    _sessionService = getSessionService();

    // Create provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    // Create test project with tool policies
    testProject = Project.create('Tool Permission Test Project', '/test/path');
    testProject.updateConfiguration({
      toolPolicies: {
        bash: 'allow', // Project allows bash
        file_read: 'ask', // Project asks for file_read
        'filesystem/move_file': 'deny', // Project denies move_file
      },
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });

    // Create session with tool policy overrides
    const sessionInstance = Session.create({
      name: 'Test Session',
      projectId: testProject.getId(),
    });

    // Update session configuration with tool policies
    sessionInstance.updateConfiguration({
      toolPolicies: {
        bash: 'ask', // Session overrides bash to ask (more restrictive than project allow)
      },
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });

    const session = sessionInstance.getInfo()!;
    sessionId = session.id;
  });

  afterEach(async () => {
    await cleanupTestProviderInstances();
    cleanupTestProviderDefaults();
  });

  describe('GET loader - Tool permissions with hierarchy', () => {
    it('should return tool permissions with explicit parent values and allowed options', async () => {
      const request = new Request(`http://localhost/api/sessions/${sessionId}/configuration`);
      const loaderArgs = createLoaderArgs(request, { sessionId });

      const response = await GET(loaderArgs);
      const data = parseResponse<ConfigurationResponse>(response);

      // Verify tools structure exists
      expect(data.configuration.tools).toBeDefined();

      // Test bash: session=ask, project=allow
      expect(data.configuration.tools?.bash).toEqual({
        value: 'ask', // Current session value
        allowedValues: ['ask', 'deny', 'disable'], // More restrictive than project 'allow'
        projectValue: 'allow', // What project has set
      });

      // Test file_read: no session override, inherits from project
      expect(data.configuration.tools?.file_read).toEqual({
        value: 'ask', // Inherited from project
        allowedValues: ['ask', 'deny', 'disable'], // More restrictive than project 'ask'
        projectValue: 'ask', // What project has set
      });

      // Test filesystem/move_file: no session override, inherits deny from project
      expect(data.configuration.tools?.['filesystem/move_file']).toEqual({
        value: 'deny', // Inherited from project
        allowedValues: ['deny', 'disable'], // More restrictive than project 'deny'
        projectValue: 'deny', // What project has set
      });
    });

    it('should handle tools with no project override (full permissions)', async () => {
      // Create project with no tool policy overrides
      const cleanProject = Project.create('Clean Project', '/test/path');
      cleanProject.updateConfiguration({
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
        toolPolicies: {}, // Explicitly empty
      });

      const cleanSessionInstance = Session.create({
        name: 'Clean Session',
        projectId: cleanProject.getId(),
      });

      cleanSessionInstance.updateConfiguration({
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
        toolPolicies: {}, // Explicitly empty
      });

      const cleanSession = cleanSessionInstance.getInfo()!;
      const cleanSessionId = cleanSession.id;

      const request = new Request(`http://localhost/api/sessions/${cleanSessionId}/configuration`);
      const loaderArgs = createLoaderArgs(request, { sessionId: cleanSessionId });
      const response = await GET(loaderArgs);
      const data = parseResponse<ConfigurationResponse>(response);

      // When no project override, should show full options
      expect(data.configuration.tools?.bash).toEqual({
        value: 'ask', // Default policy
        allowedValues: ['allow', 'ask', 'deny', 'disable'], // All options available
        // No projectValue since project doesn't set policy
      });
    });
  });

  describe('PUT action - Progressive restriction validation', () => {
    it('should accept valid tool policy changes within allowed values', async () => {
      const request = new Request(`http://localhost/api/sessions/${sessionId}/configuration`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolPolicies: {
            bash: 'deny', // More restrictive than project 'allow' - should be valid
          },
        }),
      });
      const actionArgs = createActionArgs(request, { sessionId });

      const response = await PUT(actionArgs);
      expect(response.status).toBe(200);

      // Verify the policy was actually saved - reload and check
      const verifyRequest = new Request(`http://localhost/api/sessions/${sessionId}/configuration`);
      const updatedResponse = await GET(createLoaderArgs(verifyRequest, { sessionId }));
      const updatedData = parseResponse<ConfigurationResponse>(updatedResponse);
      expect(updatedData.configuration.tools?.bash?.value).toBe('deny');
    });

    it('should reject tool policy changes that are more permissive than parent', async () => {
      // First set project to deny bash
      testProject.updateConfiguration({
        toolPolicies: { bash: 'deny' },
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      });

      const request = new Request(`http://localhost/api/sessions/${sessionId}/configuration`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolPolicies: {
            bash: 'allow', // More permissive than project 'deny' - should fail
          },
        }),
      });
      const actionArgs = createActionArgs(request, { sessionId });

      const response = await PUT(actionArgs);
      expect(response.status).toBe(400);

      const data = parseResponse<{ error: string }>(response);
      expect(data.error).toContain('more permissive than project policy');
    });
  });
});
