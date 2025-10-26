// ABOUTME: Tests for Claude SDK provider tool approval integration
// ABOUTME: Verifies canUseTool callback properly integrates with Lace approval workflow

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClaudeSDKProvider } from './claude-sdk-provider';
import type { ProviderRequestContext } from './base-provider';
import { ApprovalDecision } from '~/tools/types';

describe('ClaudeSDKProvider Tool Approval', () => {
  it('should create pending approval when SDK calls canUseTool', async () => {
    // This test will fail initially - the approval integration is broken

    const provider = new ClaudeSDKProvider({
      model: 'default',
      apiKey: null,
      sessionToken: 'test-token',
      catalogProvider: {
        id: 'claude-agents-sdk',
        name: 'Test',
        type: 'claude-agents-sdk',
      },
    });

    // Mock context with ToolExecutor, Session, and Agent
    const mockToolExecutor = {
      getTool: vi.fn().mockReturnValue({
        name: 'bash',
        annotations: { readOnlySafe: false },
      }),
      getEffectivePolicy: vi.fn().mockReturnValue('ask'),
    };

    const mockSession = {
      getId: () => 'test-session',
      getEffectiveConfiguration: () => ({ tools: ['bash'] }),
      getToolPolicy: vi.fn().mockReturnValue('ask'),
      getPermissionOverrideMode: () => 'default',
    };

    const mockAgent = {
      requestToolApproval: vi.fn().mockResolvedValue(ApprovalDecision.ALLOW_ONCE),
    };

    const context: ProviderRequestContext = {
      workingDirectory: '/tmp',
      processEnv: process.env,
      toolExecutor: mockToolExecutor as any,
      session: mockSession as any,
      agent: mockAgent as any,
    };

    // Build the canUseTool handler
    const canUseTool = (provider as any).buildCanUseToolHandler(context);

    // Simulate SDK calling canUseTool
    const result = await canUseTool(
      'bash',
      { command: 'ls' },
      { signal: new AbortController().signal }
    );

    // Should have called Agent's requestToolApproval
    expect(mockAgent.requestToolApproval).toHaveBeenCalled();

    // Should return allow after approval
    expect(result.behavior).toBe('allow');
  });
});
