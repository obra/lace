// ABOUTME: Tests for session naming helper using InfrastructureHelper
// ABOUTME: Validates session name generation with proper constraints and helper integration

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSessionName } from '@lace/web/lib/server/session-naming-helper';

const mockSupervisor = {
  agentRequest: vi.fn(),
};

vi.mock('@lace/web/lib/server/supervisor-service', () => ({
  getSupervisor: vi.fn(async () => mockSupervisor),
  getProviderManagementAgent: vi.fn(async () => ({
    workspaceSessionId: 'ws_test',
    agentSessionId: 'sess_test',
  })),
}));

describe('generateSessionName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should format prompt correctly with project name and user input', async () => {
    mockSupervisor.agentRequest = vi.fn(async (params: { method: string }) => {
      if (params.method === 'session/prompt') {
        return { content: [{ type: 'text', text: 'Fix Auth Bug' }] };
      }
      return {};
    });

    await generateSessionName('MyProject', 'I need to fix the authentication redirect bug');

    expect(mockSupervisor.agentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'session/prompt',
        requestParams: expect.objectContaining({
          content: [
            {
              type: 'text',
              text: `Here's the project name: 'MyProject'. Here's what the user wrote: 'I need to fix the authentication redirect bug'. Return a brief descriptive name for this session. No more than 5 words.`,
            },
          ],
        }),
      })
    );
  });

  it('should return trimmed session name from helper result', async () => {
    mockSupervisor.agentRequest = vi.fn(async (params: { method: string }) => {
      if (params.method === 'session/prompt') {
        return { content: [{ type: 'text', text: '  Fix Auth Bug  ' }] };
      }
      return {};
    });

    const result = await generateSessionName(
      'MyProject',
      'I need to fix the authentication redirect bug'
    );

    expect(result).toBe('Fix Auth Bug');
  });

  it('should handle different project names and user inputs', async () => {
    mockSupervisor.agentRequest = vi.fn(async (params: { method: string }) => {
      if (params.method === 'session/prompt') {
        return { content: [{ type: 'text', text: 'Add Dark Mode' }] };
      }
      return {};
    });

    await generateSessionName('Frontend App', 'Add dark mode toggle to settings');

    expect(mockSupervisor.agentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'session/prompt',
        requestParams: expect.objectContaining({
          content: [
            {
              type: 'text',
              text: `Here's the project name: 'Frontend App'. Here's what the user wrote: 'Add dark mode toggle to settings'. Return a brief descriptive name for this session. No more than 5 words.`,
            },
          ],
        }),
      })
    );
  });

  it('should use fallback model when provided', async () => {
    mockSupervisor.agentRequest = vi.fn(async (params: { method: string }) => {
      if (params.method === 'ent/session/configure') {
        return {};
      }
      if (params.method === 'session/prompt') {
        return { content: [{ type: 'text', text: 'Fix Auth Bug' }] };
      }
      return {};
    });

    await generateSessionName('MyProject', 'Fix auth bug', {
      connectionId: 'conn_test',
      modelId: 'model_test',
    });

    expect(mockSupervisor.agentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'ent/session/configure',
        requestParams: expect.objectContaining({
          connectionId: 'conn_test',
          modelId: 'model_test',
        }),
      })
    );
  });
});
