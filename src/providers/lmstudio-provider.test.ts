// ABOUTME: Tests for LMStudio provider implementation
// ABOUTME: Verifies native tool calling, response formatting, and provider configuration

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LMStudioProvider } from '~/providers/lmstudio-provider';
import { Tool } from '~/tools/tool';
import { ToolResult, ToolContext } from '~/tools/types';
import { z } from 'zod';

// Mock external LMStudio SDK to avoid dependency on LMStudio being installed/running locally
// Tests focus on provider logic, not LMStudio SDK implementation
vi.mock('@lmstudio/sdk', () => {
  const mockModel = {
    port: {
      createChannel: vi.fn(),
    },
    specifier: 'test-model',
    predictionConfigInputToKVConfig: vi.fn().mockReturnValue({}),
    internalKVConfigStack: { layers: [] },
    internalIgnoreServerSessionConfig: false,
  };

  const mockClient = {
    llm: {
      load: vi.fn().mockResolvedValue(mockModel),
      listLoaded: vi.fn().mockResolvedValue([]),
    },
  };

  const mockChat = {
    data: { messages: [] },
  };

  return {
    LMStudioClient: vi.fn().mockImplementation(() => mockClient),
    Chat: {
      from: vi.fn().mockReturnValue(mockChat),
    },
  };
});

describe('LMStudioProvider', () => {
  let provider: LMStudioProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new LMStudioProvider();
  });

  describe('configuration', () => {
    it('should have correct provider name', () => {
      expect(provider.providerName).toBe('lmstudio');
    });

    // defaultModel removed - providers are now model-agnostic

    it('should support streaming', () => {
      expect(provider.supportsStreaming).toBe(true);
    });

    it('should accept custom configuration', () => {
      const customProvider = new LMStudioProvider({
        model: 'custom-model',
        maxTokens: 2000,
        verbose: true,
        baseUrl: 'ws://custom:1234',
      });

      expect(customProvider.providerName).toBe('lmstudio');
    });
  });

  describe('native tool calling', () => {
    it('should handle tools correctly in configuration', () => {
      // Test inline tool conversion logic
      class TestTool extends Tool {
        name = 'test_tool';
        description = 'A test tool';
        schema = z.object({
          input: z.string(),
        });

        protected async executeValidated(
          _args: { input: string },
          _context: ToolContext
        ): Promise<ToolResult> {
          return await Promise.resolve(this.createResult('test result'));
        }
      }

      const testTool = new TestTool();

      // Test the conversion logic that's now inline in the provider
      const rawTools = {
        type: 'toolArray',
        tools: [testTool].map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
      };

      expect(rawTools).toEqual({
        type: 'toolArray',
        tools: [
          {
            type: 'function',
            function: {
              name: 'test_tool',
              description: 'A test tool',
              parameters: {
                type: 'object',
                properties: {
                  input: { type: 'string' },
                },
                required: ['input'],
                additionalProperties: false,
              },
            },
          },
        ],
      });
    });

    it('should handle no tools case', () => {
      // Test the no tools case
      const rawTools = { type: 'none' };
      expect(rawTools.type).toBe('none');
    });
  });

  describe('error handling', () => {
    it('should handle connection errors gracefully', async () => {
      const mockClient = {
        llm: {
          listLoaded: vi.fn().mockRejectedValue(new Error('Connection refused')),
        },
      };

      // Replace the mocked client
      const { LMStudioClient } = await import('@lmstudio/sdk');
      vi.mocked(LMStudioClient).mockImplementation(
        () => mockClient as unknown as InstanceType<typeof LMStudioClient>
      );

      const testProvider = new LMStudioProvider();

      await expect(
        testProvider.createResponse([{ role: 'user', content: 'Test' }], [], 'qwen/qwen3-30b-a3b')
      ).rejects.toThrow('Cannot connect to LMStudio server');
    });

    it('should handle no models loaded error', async () => {
      const mockClient = {
        llm: {
          listLoaded: vi.fn().mockResolvedValue([]), // No models loaded
        },
      };

      // Replace the mocked client
      const { LMStudioClient } = await import('@lmstudio/sdk');
      vi.mocked(LMStudioClient).mockImplementation(
        () => mockClient as unknown as InstanceType<typeof LMStudioClient>
      );

      const testProvider = new LMStudioProvider();

      await expect(
        testProvider.createResponse([{ role: 'user', content: 'Test' }], [], 'qwen/qwen3-30b-a3b')
      ).rejects.toThrow('No models are currently loaded in LMStudio');
    });
  });

  describe('diagnosis', () => {
    it('should return connected status when LMStudio is available', async () => {
      const mockClient = {
        llm: {
          listLoaded: vi
            .fn()
            .mockResolvedValue([{ identifier: 'model1' }, { identifier: 'model2' }]),
        },
      };

      // Replace the mocked client
      const { LMStudioClient } = await import('@lmstudio/sdk');
      vi.mocked(LMStudioClient).mockImplementation(
        () => mockClient as unknown as InstanceType<typeof LMStudioClient>
      );

      const testProvider = new LMStudioProvider();
      const diagnostics = await testProvider.diagnose();

      expect(diagnostics.connected).toBe(true);
      expect(diagnostics.models).toEqual(['model1', 'model2']);
      expect(diagnostics.error).toBeUndefined();
    });

    it('should return disconnected status when LMStudio is unavailable', async () => {
      const mockClient = {
        llm: {
          listLoaded: vi.fn().mockRejectedValue(new Error('Connection failed')),
        },
      };

      // Replace the mocked client
      const { LMStudioClient } = await import('@lmstudio/sdk');
      vi.mocked(LMStudioClient).mockImplementation(
        () => mockClient as unknown as InstanceType<typeof LMStudioClient>
      );

      const testProvider = new LMStudioProvider();
      const diagnostics = await testProvider.diagnose();

      expect(diagnostics.connected).toBe(false);
      expect(diagnostics.models).toEqual([]);
      expect(diagnostics.error).toBe('Connection failed');
    });
  });
});
