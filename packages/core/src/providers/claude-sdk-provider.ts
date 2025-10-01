// ABOUTME: Claude Agent SDK provider using subscription-based authentication
// ABOUTME: Integrates Anthropic's SDK while using Lace's tool system and approval flow

import {
  AIProvider,
  ProviderConfig,
  ProviderResponse,
  ProviderInfo,
  ModelInfo,
  ProviderRequestContext,
} from '~/providers/base-provider';
import type { ProviderMessage } from '~/providers/base-provider';
import type { Tool } from '~/tools/tool';
import { logger } from '~/utils/logger';
import { createHash } from 'crypto';
import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk';
import type { ToolResult } from '~/tools/types';

// MCP CallToolResult format (SDK doesn't export this type)
type CallToolResult = {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
    | { type: 'resource'; resource: { uri: string; text: string; mimeType?: string } }
  >;
  isError: boolean;
};

interface ClaudeSDKProviderConfig extends ProviderConfig {
  sessionToken: string | null; // SDK session credentials
}

export class ClaudeSDKProvider extends AIProvider {
  private sessionId?: string;
  private lastHistoryFingerprint?: string;

  constructor(config: ClaudeSDKProviderConfig) {
    super(config);
  }

  get providerName(): string {
    return 'claude-agents-sdk';
  }

  get supportsStreaming(): boolean {
    return true;
  }

  async createResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    model: string,
    signal?: AbortSignal,
    context?: ProviderRequestContext
  ): Promise<ProviderResponse> {
    throw new Error('Not implemented');
  }

  getProviderInfo(): ProviderInfo {
    return {
      name: 'claude-agents-sdk',
      displayName: 'Claude Agent SDK (Subscription)',
      requiresApiKey: true,
      configurationHint: 'Requires Claude Pro/Team subscription authentication',
    };
  }

  getAvailableModels(): ModelInfo[] {
    // Hardcoded fallback - will be replaced with dynamic fetching
    return [
      this.createModel({
        id: 'claude-sonnet-4',
        displayName: 'Claude 4 Sonnet',
        description: 'Balanced performance and capability',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        isDefault: true,
      }),
      this.createModel({
        id: 'claude-opus-4',
        displayName: 'Claude 4 Opus',
        description: 'Most capable model',
        contextWindow: 200000,
        maxOutputTokens: 8192,
      }),
      this.createModel({
        id: 'claude-haiku-4',
        displayName: 'Claude 4 Haiku',
        description: 'Fastest model',
        contextWindow: 200000,
        maxOutputTokens: 8192,
      }),
    ];
  }

  isConfigured(): boolean {
    const config = this._config as ClaudeSDKProviderConfig;
    return !!config.sessionToken && config.sessionToken.length > 0;
  }

  /**
   * Convert Lace's ToolResult to MCP CallToolResult format
   */
  protected convertToolResultToMCP(result: ToolResult): CallToolResult {
    const content: CallToolResult['content'] = result.content.map((block) => {
      if (block.type === 'text') {
        return { type: 'text', text: block.text || '' };
      } else if (block.type === 'image') {
        return { type: 'image', data: block.data || '', mimeType: 'image/png' };
      } else if (block.type === 'resource') {
        return {
          type: 'resource',
          resource: {
            uri: block.uri || '',
            text: block.text || '',
          },
        };
      }
      // Fallback for unknown types
      return { type: 'text', text: JSON.stringify(block) };
    });

    return {
      content,
      isError: result.status !== 'completed',
    };
  }

  /**
   * Create MCP server that wraps all Lace tools
   * Uses ToolExecutor for full pipeline: validation, approval, execution
   */
  protected createLaceToolsServer(
    context: ProviderRequestContext
  ): ReturnType<typeof createSdkMcpServer> {
    if (!context.toolExecutor) {
      throw new Error('ToolExecutor required for MCP server creation');
    }

    const tools = context.toolExecutor.getAllTools();

    logger.debug('Creating Lace MCP server', {
      toolCount: tools.length,
      toolNames: tools.map((t) => t.name),
    });

    const mcpTools = tools.map((tool) =>
      sdkTool(
        tool.name,
        tool.description,
        tool.schema as any, // Zod schema - SDK expects ZodRawShape but accepts any Zod schema
        async (args: Record<string, unknown>, extra: unknown) => {
          logger.debug('MCP tool called via SDK', {
            toolName: tool.name,
            args,
          });

          // Create tool call matching Lace's format
          const toolCall = {
            id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name: tool.name,
            arguments: args,
          };

          // Build ToolContext from provider context
          const toolContext = {
            signal: new AbortController().signal, // TODO: Get from SDK if available
            workingDirectory: context.workingDirectory,
            agent: context.agent,
            processEnv: context.processEnv,
          };

          try {
            // Execute via Lace's ToolExecutor (full pipeline)
            // This handles: validation, approval flow, execution, events
            const result = await context.toolExecutor!.execute(toolCall, toolContext);

            logger.debug('MCP tool completed', {
              toolName: tool.name,
              status: result.status,
            });

            return this.convertToolResultToMCP(result);
          } catch (error) {
            logger.error('MCP tool execution failed', {
              toolName: tool.name,
              error: error instanceof Error ? error.message : String(error),
            });

            return {
              content: [
                {
                  type: 'text',
                  text: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        }
      )
    );

    return createSdkMcpServer({
      name: '__lace-tools',
      version: '1.0.0',
      tools: mcpTools,
    });
  }

  /**
   * Fingerprint conversation history to detect changes (compaction, edits)
   * Returns SHA256 hash of all messages to enable change detection
   */
  protected fingerprintHistory(messages: ProviderMessage[]): string {
    return createHash('sha256').update(JSON.stringify(messages)).digest('hex');
  }

  /**
   * Check if history has changed since last turn
   * Returns true if we can resume, false if we need new session
   */
  protected canResumeSession(messages: ProviderMessage[]): boolean {
    if (!this.sessionId || !this.lastHistoryFingerprint) {
      return false;
    }

    // Fingerprint everything except the latest user message
    const historyMessages = messages.slice(0, -1);
    const currentFingerprint = this.fingerprintHistory(historyMessages);

    return currentFingerprint === this.lastHistoryFingerprint;
  }

  /**
   * Update fingerprint after successful turn
   */
  protected updateFingerprint(messages: ProviderMessage[]): void {
    this.lastHistoryFingerprint = this.fingerprintHistory(messages);
  }
}
