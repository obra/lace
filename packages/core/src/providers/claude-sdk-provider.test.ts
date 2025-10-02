import { describe, it, expect, beforeEach } from 'vitest';
import { ClaudeSDKProvider } from './claude-sdk-provider';
import { ToolExecutor } from '~/tools/executor';
import { Tool } from '~/tools/tool';
import { z } from 'zod';
import type { ProviderRequestContext } from '~/providers/base-provider';
import type { ToolContext, ToolResult } from '~/tools/types';
import { ApprovalDecision } from '~/tools/types';

// Simple mock tool for testing
class MockTool extends Tool {
  name = 'mock_tool';
  description = 'A mock tool for testing';
  schema = z.object({
    action: z.string(),
  });

  protected async executeValidated(
    args: z.infer<typeof this.schema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    return {
      id: 'test-id',
      status: 'completed',
      content: [{ type: 'text', text: `Executed: ${args.action}` }],
    };
  }
}

describe('ClaudeSDKProvider', () => {
  let provider: ClaudeSDKProvider;

  beforeEach(() => {
    provider = new ClaudeSDKProvider({ sessionToken: 'test-token' });
  });

  it('should have correct provider name', () => {
    expect(provider.providerName).toBe('claude-agents-sdk');
  });

  it('should support streaming', () => {
    expect(provider.supportsStreaming).toBe(true);
  });

  it('should return provider info', () => {
    const info = provider.getProviderInfo();
    expect(info.name).toBe('claude-agents-sdk');
    expect(info.displayName).toContain('SDK');
    expect(info.requiresApiKey).toBe(true);
  });

  it('should return model list', () => {
    const models = provider.getAvailableModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.id.includes('sonnet'))).toBe(true);
  });

  it('should check configuration', () => {
    expect(provider.isConfigured()).toBe(true);

    const unconfigured = new ClaudeSDKProvider({ sessionToken: null });
    expect(unconfigured.isConfigured()).toBe(false);
  });

  it('should require context parameter', async () => {
    await expect(provider.createResponse([], [], 'model', undefined, undefined)).rejects.toThrow(
      'requires ProviderRequestContext'
    );
  });
});

describe('ClaudeSDKProvider - Session Management', () => {
  it('should not resume on first turn', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });
    const messages = [{ role: 'user' as const, content: 'Hello' }];

    // Access protected method for testing
    expect((provider as any).canResumeSession(messages)).toBe(false);
  });

  it('should resume when history unchanged', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });
    const messages = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi' },
      { role: 'user' as const, content: 'How are you?' },
    ];

    // Simulate first turn
    (provider as any).sessionId = 'session-123';
    (provider as any).updateFingerprint(messages.slice(0, -1));

    // Check second turn with same history
    expect((provider as any).canResumeSession(messages)).toBe(true);
  });

  it('should not resume when history changed', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });

    // First conversation
    const messages1 = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi' },
      { role: 'user' as const, content: 'Question' },
    ];

    (provider as any).sessionId = 'session-123';
    (provider as any).updateFingerprint(messages1.slice(0, -1));

    // Compacted conversation (different history)
    const messages2 = [
      { role: 'assistant' as const, content: 'Summary of previous conversation' },
      { role: 'user' as const, content: 'New question' },
    ];

    expect((provider as any).canResumeSession(messages2)).toBe(false);
  });
});

describe('ClaudeSDKProvider - MCP Integration', () => {
  it('should create MCP server from context', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });
    const toolExecutor = new ToolExecutor();
    const mockTool = new MockTool();
    toolExecutor.registerTool(mockTool.name, mockTool);

    const context: ProviderRequestContext = {
      toolExecutor,
      workingDirectory: '/test',
    };

    const server = (provider as any).createLaceToolsServer(context);

    expect(server).toBeDefined();
    expect(server.type).toBe('sdk');
    expect(server.name).toBe('__lace-tools');
  });

  it('should throw if context lacks toolExecutor', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });
    const context: ProviderRequestContext = {
      workingDirectory: '/test',
    };

    expect(() => {
      (provider as any).createLaceToolsServer(context);
    }).toThrow('ToolExecutor required');
  });

  it('should convert ToolResult to CallToolResult', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });

    const toolResult: ToolResult = {
      id: 'test-id',
      status: 'completed',
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'image', data: 'base64data', mimeType: 'image/png' },
      ],
    };

    const mcpResult = (provider as any).convertToolResultToMCP(toolResult);

    expect(mcpResult.content).toHaveLength(2);
    expect(mcpResult.content[0].type).toBe('text');
    expect(mcpResult.isError).toBe(false);
  });

  it('should mark failed results as errors', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });

    const toolResult: ToolResult = {
      id: 'test-id',
      status: 'failed',
      content: [{ type: 'text', text: 'Error message' }],
    };

    const mcpResult = (provider as any).convertToolResultToMCP(toolResult);
    expect(mcpResult.isError).toBe(true);
  });
});

describe('ClaudeSDKProvider - Permissions', () => {
  it('should map yolo to bypassPermissions', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });
    expect((provider as any).mapPermissionMode('yolo')).toBe('bypassPermissions');
  });

  it('should map read-only to plan', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });
    expect((provider as any).mapPermissionMode('read-only')).toBe('plan');
  });

  it('should map normal to default', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });
    expect((provider as any).mapPermissionMode('normal')).toBe('default');
  });
});

describe('ClaudeSDKProvider - Approval System', () => {
  it('should create pending approval and resolve it', async () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });
    const toolCallId = 'test-call-123';

    // Create a promise that will be resolved by handleApprovalResponse
    const promise = new Promise<ApprovalDecision>((resolve) => {
      (provider as any).pendingApprovals.set(toolCallId, {
        resolve,
        reject: () => {},
      });
    });

    // Simulate approval response
    provider.handleApprovalResponse(toolCallId, ApprovalDecision.ALLOW_ONCE);

    // Promise should resolve
    const decision = await promise;
    expect(decision).toBe(ApprovalDecision.ALLOW_ONCE);
    expect((provider as any).pendingApprovals.has(toolCallId)).toBe(false);
  });

  it('should handle unknown approval responses gracefully', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });

    // Should not throw
    expect(() => {
      provider.handleApprovalResponse('unknown-id', ApprovalDecision.DENY);
    }).not.toThrow();
  });

  // Note: Full canUseTool testing requires Session mock - will be done in integration tests
});

describe('ClaudeSDKProvider - createResponse', () => {
  it('should throw if not configured', async () => {
    const provider = new ClaudeSDKProvider({ sessionToken: null });

    await expect(
      provider.createResponse([{ role: 'user', content: 'Hello' }], [], 'sonnet')
    ).rejects.toThrow('not configured');
  });

  it('should throw if context is missing', async () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });

    await expect(
      provider.createResponse([{ role: 'user', content: 'Hello' }], [], 'sonnet', undefined, undefined)
    ).rejects.toThrow('requires ProviderRequestContext');
  });

  it('should throw if last message is not user message', async () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });
    const toolExecutor = new ToolExecutor();
    const context: ProviderRequestContext = {
      toolExecutor,
      workingDirectory: '/test',
    };

    await expect(
      provider.createResponse([{ role: 'assistant', content: 'Hello' }], [], 'sonnet', undefined, context)
    ).rejects.toThrow('must be a user message');
  });

  // Full SDK integration tests will be in separate integration test file
});

describe('ClaudeSDKProvider - Streaming', () => {
  it('should support streaming', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });
    expect(provider.supportsStreaming).toBe(true);
  });

  // Streaming integration tests will verify token emission
});
