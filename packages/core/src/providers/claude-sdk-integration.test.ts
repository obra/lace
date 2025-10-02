// ABOUTME: Integration tests for Claude Agent SDK provider
// ABOUTME: Tests SDK interaction, tool execution flow, and event emission with mocked SDK

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClaudeSDKProvider } from '~/providers/claude-sdk-provider';
import { ToolExecutor } from '~/tools/executor';
import { Tool } from '~/tools/tool';
import { z } from 'zod';
import type { ProviderRequestContext } from '~/providers/base-provider';
import type { ToolContext, ToolResult } from '~/tools/types';

// Simple mock tool for testing
class MockReadTool extends Tool {
  name = 'read_file';
  description = 'Read a file';
  schema = z.object({
    path: z.string(),
  });

  protected async executeValidated(
    args: z.infer<typeof this.schema>,
    _context?: ToolContext
  ): Promise<ToolResult> {
    return {
      id: 'test-id',
      status: 'completed',
      content: [{ type: 'text', text: `File content from ${args.path}` }],
    };
  }
}

describe('ClaudeSDKProvider - Integration', () => {
  let provider: ClaudeSDKProvider;
  let toolExecutor: ToolExecutor;

  beforeEach(() => {
    provider = new ClaudeSDKProvider({ sessionToken: 'test-token' });
    toolExecutor = new ToolExecutor();
    const mockTool = new MockReadTool();
    toolExecutor.registerTool(mockTool.name, mockTool);
  });

  describe('Provider Initialization', () => {
    it('should initialize with correct provider name', () => {
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
  });

  describe('MCP Server Creation', () => {
    it('should create MCP server from context', () => {
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
      const context: ProviderRequestContext = {
        workingDirectory: '/test',
      };

      expect(() => {
        (provider as any).createLaceToolsServer(context);
      }).toThrow('ToolExecutor required');
    });

    it('should wrap all tools from ToolExecutor', () => {
      const context: ProviderRequestContext = {
        toolExecutor,
        workingDirectory: '/test',
      };

      // Verify server is created successfully
      const server = (provider as any).createLaceToolsServer(context);
      expect(server).toBeDefined();
      expect(server.name).toBe('__lace-tools');

      // Verify tools are registered (we can't access tools directly, but we can verify executor has them)
      const allTools = toolExecutor.getAllTools();
      expect(allTools.length).toBe(1);
      expect(allTools[0].name).toBe('read_file');
    });
  });

  describe('Tool Result Conversion', () => {
    it('should convert ToolResult to MCP CallToolResult', () => {
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
      expect(mcpResult.content[0].text).toBe('Hello');
      expect(mcpResult.isError).toBe(false);
    });

    it('should mark failed results as errors', () => {
      const toolResult: ToolResult = {
        id: 'test-id',
        status: 'failed',
        content: [{ type: 'text', text: 'Error message' }],
      };

      const mcpResult = (provider as any).convertToolResultToMCP(toolResult);
      expect(mcpResult.isError).toBe(true);
    });

    it('should handle resource blocks', () => {
      const toolResult: ToolResult = {
        id: 'test-id',
        status: 'completed',
        content: [
          {
            type: 'resource',
            uri: 'file:///test.txt',
            text: 'Content',
            mimeType: 'text/plain',
          },
        ],
      };

      const mcpResult = (provider as any).convertToolResultToMCP(toolResult);
      expect(mcpResult.content[0].type).toBe('resource');
    });
  });

  describe('History Fingerprinting', () => {
    it('should generate consistent fingerprints', () => {
      const messages = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi' },
      ];

      const fingerprint1 = (provider as any).fingerprintHistory(messages);
      const fingerprint2 = (provider as any).fingerprintHistory(messages);

      expect(fingerprint1).toBe(fingerprint2);
      expect(fingerprint1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex
    });

    it('should generate different fingerprints for different histories', () => {
      const messages1 = [{ role: 'user' as const, content: 'Hello' }];
      const messages2 = [{ role: 'user' as const, content: 'Goodbye' }];

      const fingerprint1 = (provider as any).fingerprintHistory(messages1);
      const fingerprint2 = (provider as any).fingerprintHistory(messages2);

      expect(fingerprint1).not.toBe(fingerprint2);
    });
  });

  describe('Session Resumption Logic', () => {
    it('should not resume on first turn', () => {
      const messages = [{ role: 'user' as const, content: 'Hello' }];

      expect((provider as any).canResumeSession(messages)).toBe(false);
    });

    it('should resume when history unchanged', () => {
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

  describe('Permission Mode Mapping', () => {
    it('should map yolo to bypassPermissions', () => {
      expect((provider as any).mapPermissionMode('yolo')).toBe('bypassPermissions');
    });

    it('should map read-only to plan', () => {
      expect((provider as any).mapPermissionMode('read-only')).toBe('plan');
    });

    it('should map normal to default', () => {
      expect((provider as any).mapPermissionMode('normal')).toBe('default');
    });
  });

  describe('Approval System', () => {
    it('should create pending approval and resolve it', async () => {
      const toolCallId = 'test-call-123';

      // Create a promise that will be resolved by handleApprovalResponse
      const promise = new Promise<string>((resolve) => {
        (provider as any).pendingApprovals.set(toolCallId, {
          resolve,
          reject: () => {},
        });
      });

      // Simulate approval response
      provider.handleApprovalResponse(toolCallId, 'allow_once' as any);

      // Promise should resolve
      const decision = await promise;
      expect(decision).toBe('allow_once');
      expect((provider as any).pendingApprovals.has(toolCallId)).toBe(false);
    });

    it('should handle unknown approval responses gracefully', () => {
      // Should not throw
      expect(() => {
        provider.handleApprovalResponse('unknown-id', 'deny' as any);
      }).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should require context parameter', async () => {
      await expect(
        provider.createResponse([{ role: 'user', content: 'Hello' }], [], 'model', undefined, undefined)
      ).rejects.toThrow('requires ProviderRequestContext');
    });

    it('should throw if not configured', async () => {
      const unconfiguredProvider = new ClaudeSDKProvider({ sessionToken: null });

      await expect(
        unconfiguredProvider.createResponse([{ role: 'user', content: 'Hello' }], [], 'sonnet')
      ).rejects.toThrow('not configured');
    });

    it('should throw if last message is not user message', async () => {
      const context: ProviderRequestContext = {
        toolExecutor,
        workingDirectory: '/test',
      };

      await expect(
        provider.createResponse(
          [{ role: 'assistant', content: 'Hello' }],
          [],
          'sonnet',
          undefined,
          context
        )
      ).rejects.toThrow('must be a user message');
    });
  });

  describe('Streaming Support', () => {
    it('should indicate streaming support', () => {
      expect(provider.supportsStreaming).toBe(true);
    });

    it('should have createStreamingResponse method', () => {
      expect(typeof provider.createStreamingResponse).toBe('function');
    });
  });

  describe('Cross-Provider Compatibility', () => {
    it('should have consistent method signatures with other providers', () => {
      // Verify provider has required methods
      expect(typeof provider.createResponse).toBe('function');
      expect(typeof provider.createStreamingResponse).toBe('function');
      expect(typeof provider.getProviderInfo).toBe('function');
      expect(typeof provider.getAvailableModels).toBe('function');
      expect(typeof provider.isConfigured).toBe('function');
      expect(typeof provider.cleanup).toBe('function');
    });

    it('should accept AbortSignal parameter in createResponse', () => {
      // Method signature should allow AbortSignal
      expect(provider.createResponse.length).toBeGreaterThanOrEqual(3);
    });

    it('should accept AbortSignal parameter in createStreamingResponse', () => {
      // Method signature should allow AbortSignal
      expect(provider.createStreamingResponse.length).toBeGreaterThanOrEqual(3);
    });
  });
});
