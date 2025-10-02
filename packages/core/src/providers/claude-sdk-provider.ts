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
import { Project } from '~/projects/project';
import {
  createSdkMcpServer,
  tool as sdkTool,
  query as sdkQuery,
} from '@anthropic-ai/claude-agent-sdk';
import type { ToolResult, PermissionOverrideMode } from '~/tools/types';
import { ApprovalDecision } from '~/tools/types';

// SDK permission mode types (SDK doesn't export these)
type SDKPermissionMode = 'default' | 'bypassPermissions' | 'plan';

// SDK permission result types (SDK doesn't export these)
type PermissionResult = {
  behavior: 'allow' | 'deny';
  updatedInput?: Record<string, unknown>;
  message?: string;
  interrupt?: boolean;
};

type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  context: { signal: AbortSignal; suggestions?: unknown[] }
) => Promise<PermissionResult>;

// MCP CallToolResult format (SDK doesn't export this type)
type CallToolResult = {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
    | { type: 'resource'; resource: { uri: string; text: string; mimeType?: string } }
  >;
  isError: boolean;
};

// Anthropic message content block types (SDK returns these but doesn't export types)
type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

// Anthropic message format returned by SDK
// Index signature allows compatibility with SDK's BetaMessage type
type AnthropicMessage = {
  content: AnthropicContentBlock[];
} & Record<string, unknown>;

// SDK query options type (simplified version - SDK's Options type is complex)
type SDKQueryOptions = {
  resume?: string;
  forkSession?: boolean;
  model: string;
  systemPrompt?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  includePartialMessages: boolean;
  settingSources: string[];
  mcpServers: Record<string, ReturnType<typeof createSdkMcpServer>>;
  allowedTools: string[];
  permissionMode: SDKPermissionMode;
  canUseTool: CanUseTool;
  abortController?: AbortController;
};

interface ClaudeSDKProviderConfig extends ProviderConfig {
  sessionToken: string | null; // SDK session credentials
}

export class ClaudeSDKProvider extends AIProvider {
  private sessionId?: string;
  private lastHistoryFingerprint?: string;

  // Map of pending tool approvals waiting for user decision
  private pendingApprovals = new Map<
    string,
    {
      resolve: (decision: ApprovalDecision) => void;
      reject: (error: Error) => void;
    }
  >();

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
    logger.info('SDK Provider createResponse', {
      messageCount: messages.length,
      toolCount: tools.length,
      model,
      hasSession: !!this.sessionId,
      hasContext: !!context,
    });

    // Get config
    const config = this._config as ClaudeSDKProviderConfig;

    // Session token is optional - SDK will use existing Claude authentication if available
    // (from Claude Code CLI, browser session, or ANTHROPIC_API_KEY env var)

    if (!context) {
      throw new Error('SDK provider requires ProviderRequestContext');
    }

    // Check if we can resume previous session
    const canResume = this.canResumeSession(messages);
    const latestMessage = messages[messages.length - 1];

    if (!latestMessage || latestMessage.role !== 'user') {
      throw new Error('Last message must be a user message');
    }

    logger.debug('SDK query configuration', {
      canResume,
      sessionId: this.sessionId,
      model,
      systemPrompt: this._systemPrompt?.substring(0, 100),
    });

    // Create MCP server wrapping Lace tools
    const laceToolsServer = this.createLaceToolsServer(context);

    // Get project MCP servers if session available
    const projectId = context.session?.getProjectId();
    const project = projectId ? Project.getById(projectId) : null;
    const projectMcpServers = project?.getMCPServers() || {};

    // Get permission mode from session
    const permissionMode = context.session
      ? this.mapPermissionMode(context.session.getPermissionOverrideMode())
      : 'default';

    // Build SDK query options
    const queryOptions: SDKQueryOptions = {
      resume: canResume ? this.sessionId : undefined,
      forkSession: !canResume && this.sessionId !== undefined,
      model,
      systemPrompt: this._systemPrompt,
      cwd: context.workingDirectory,
      env: context.processEnv,
      includePartialMessages: false, // Disable for non-streaming
      settingSources: [], // Don't load filesystem settings
      mcpServers: {
        __lace_tools: laceToolsServer,
        ...projectMcpServers,
      },
      allowedTools: ['WebSearch'], // Only SDK's server-side WebSearch
      permissionMode,
      canUseTool: this.buildCanUseToolHandler(context),
      // SDK accepts object with signal property, cast to satisfy type
      abortController: signal ? ({ signal } as unknown as AbortController) : undefined,
    };

    // Create SDK query
    const query = sdkQuery({
      prompt: latestMessage.content,
      options: queryOptions as any, // Cast to avoid type mismatch with SDK's complex Options type
    });

    // Process SDK messages
    let content = '';
    let toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    let usage: ProviderResponse['usage'];
    let stopReason: string | undefined;

    try {
      for await (const msg of query) {
        logger.debug('SDK message received', {
          type: msg.type,
          subtype: (msg as any).subtype,
          hasMessage: !!(msg as any).message,
        });

        if (msg.type === 'system' && msg.subtype === 'init') {
          // Capture session ID for next turn
          this.sessionId = msg.session_id;
          logger.debug('SDK session initialized', { sessionId: this.sessionId });
        }

        if (msg.type === 'assistant') {
          // Extract content and tool calls from Anthropic message format
          const anthropicMsg = msg.message as unknown as AnthropicMessage;

          // Extract text content
          const textBlocks = anthropicMsg.content.filter(
            (block): block is Extract<AnthropicContentBlock, { type: 'text' }> =>
              block.type === 'text'
          );
          content = textBlocks.map((block) => block.text).join('');

          // Extract tool calls
          const toolUseBlocks = anthropicMsg.content.filter(
            (block): block is Extract<AnthropicContentBlock, { type: 'tool_use' }> =>
              block.type === 'tool_use'
          );
          toolCalls = toolUseBlocks.map((block) => ({
            id: block.id,
            name: block.name,
            arguments: block.input,
          }));

          logger.debug('Assistant message processed', {
            contentLength: content.length,
            toolCallCount: toolCalls.length,
          });
        }

        if (msg.type === 'result') {
          // Extract usage and stop reason
          if (msg.subtype === 'success') {
            usage = {
              promptTokens: msg.usage.input_tokens,
              completionTokens: msg.usage.output_tokens,
              totalTokens: msg.usage.input_tokens + msg.usage.output_tokens,
            };
            stopReason = 'stop'; // Success = natural stop
          } else {
            // Error subtypes - check for authentication failures
            stopReason = 'error';

            // Detect authentication errors and emit re-auth event
            const errorMessage = String(msg.subtype);
            if (
              errorMessage.includes('authentication') ||
              errorMessage.includes('unauthorized') ||
              errorMessage.includes('401')
            ) {
              logger.warn('SDK authentication failed - re-authentication required', {
                subtype: msg.subtype,
              });
              this.emit('authentication_required', {
                reason: errorMessage,
                providerId: this.providerName,
              });
            }

            throw new Error(`SDK execution failed: ${msg.subtype}`);
          }

          logger.debug('SDK result received', {
            subtype: msg.subtype,
            usage,
          });
          break; // Exit iteration
        }
      }

      // Update fingerprint for next turn
      this.updateFingerprint(messages);

      return {
        content,
        toolCalls,
        stopReason,
        usage,
      };
    } catch (error) {
      logger.error('SDK query failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      });
      throw error;
    }
  }

  async createStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    model: string,
    signal?: AbortSignal,
    context?: ProviderRequestContext
  ): Promise<ProviderResponse> {
    logger.info('SDK Provider createStreamingResponse', {
      messageCount: messages.length,
      toolCount: tools.length,
      model,
    });

    const config = this._config as ClaudeSDKProviderConfig;

    // Session token is optional - SDK will use existing Claude authentication if available
    // (from Claude Code CLI, browser session, or ANTHROPIC_API_KEY env var)

    if (!context) {
      throw new Error('SDK provider requires ProviderRequestContext');
    }

    const canResume = this.canResumeSession(messages);
    const latestMessage = messages[messages.length - 1];

    if (!latestMessage || latestMessage.role !== 'user') {
      throw new Error('Last message must be a user message');
    }

    // Create MCP server wrapping Lace tools
    const laceToolsServer = this.createLaceToolsServer(context);

    // Get project MCP servers
    const projectId = context.session?.getProjectId();
    const project = projectId ? Project.getById(projectId) : null;
    const projectMcpServers = project?.getMCPServers() || {};

    // Get permission mode from session
    const permissionMode = context.session
      ? this.mapPermissionMode(context.session.getPermissionOverrideMode())
      : 'default';

    // Build query options with streaming enabled
    const queryOptions: SDKQueryOptions = {
      resume: canResume ? this.sessionId : undefined,
      forkSession: !canResume && this.sessionId !== undefined,
      model,
      systemPrompt: this._systemPrompt,
      cwd: context.workingDirectory,
      env: context.processEnv,
      includePartialMessages: true, // Enable streaming
      settingSources: [],
      mcpServers: {
        __lace_tools: laceToolsServer,
        ...projectMcpServers,
      },
      allowedTools: ['WebSearch'],
      permissionMode,
      canUseTool: this.buildCanUseToolHandler(context),
      // SDK accepts object with signal property, cast to satisfy type
      abortController: signal ? ({ signal } as unknown as AbortController) : undefined,
    };

    const query = sdkQuery({
      prompt: latestMessage.content,
      options: queryOptions as any, // Cast to avoid type mismatch with SDK's complex Options type
    });

    let content = '';
    let toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    let usage: ProviderResponse['usage'];
    let stopReason: string | undefined;

    try {
      for await (const msg of query) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          this.sessionId = msg.session_id;
        }

        // Handle streaming events
        if (msg.type === 'stream_event') {
          const event = msg.event;

          // Extract text deltas from Anthropic streaming format
          if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              const textDelta = event.delta.text;
              this.emit('token', { token: textDelta });
            }
          }

          // Track progressive token usage
          if (event.type === 'message_delta' && event.usage) {
            this.emit('token_usage_update', {
              usage: {
                promptTokens: event.usage.input_tokens || 0,
                completionTokens: event.usage.output_tokens || 0,
                totalTokens: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0),
              },
            });
          }
        }

        if (msg.type === 'assistant') {
          const anthropicMsg = msg.message as unknown as AnthropicMessage;

          const textBlocks = anthropicMsg.content.filter(
            (block): block is Extract<AnthropicContentBlock, { type: 'text' }> =>
              block.type === 'text'
          );
          content = textBlocks.map((block) => block.text).join('');

          const toolUseBlocks = anthropicMsg.content.filter(
            (block): block is Extract<AnthropicContentBlock, { type: 'tool_use' }> =>
              block.type === 'tool_use'
          );
          toolCalls = toolUseBlocks.map((block) => ({
            id: block.id,
            name: block.name,
            arguments: block.input,
          }));
        }

        if (msg.type === 'result') {
          if (msg.subtype === 'success') {
            usage = {
              promptTokens: msg.usage.input_tokens,
              completionTokens: msg.usage.output_tokens,
              totalTokens: msg.usage.input_tokens + msg.usage.output_tokens,
            };
            stopReason = 'stop';

            // Emit final usage
            this.emit('token_usage_update', { usage });
          } else {
            // Error subtypes - check for authentication failures
            stopReason = 'error';

            // Detect authentication errors and emit re-auth event
            const errorMessage = String(msg.subtype);
            if (
              errorMessage.includes('authentication') ||
              errorMessage.includes('unauthorized') ||
              errorMessage.includes('401')
            ) {
              logger.warn('SDK authentication failed - re-authentication required', {
                subtype: msg.subtype,
              });
              this.emit('authentication_required', {
                reason: errorMessage,
                providerId: this.providerName,
              });
            }

            throw new Error(`SDK execution failed: ${msg.subtype}`);
          }
          break;
        }
      }

      this.updateFingerprint(messages);

      const response = {
        content,
        toolCalls,
        stopReason,
        usage,
      };

      // Emit completion
      this.emit('complete', { response });

      return response;
    } catch (error) {
      logger.error('SDK streaming query failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      });
      throw error;
    }
  }

  getProviderInfo(): ProviderInfo {
    return {
      name: 'claude-agents-sdk',
      displayName: 'Claude Agent SDK (Subscription)',
      requiresApiKey: false, // SDK auto-detects authentication
      configurationHint:
        'Uses existing Claude authentication. Works automatically if logged in to Claude Code CLI or claude.ai.',
    };
  }

  getAvailableModels(): ModelInfo[] {
    // SDK uses short model identifiers, not full API model IDs
    return [
      this.createModel({
        id: 'default',
        displayName: 'Default (Sonnet 4.5)',
        description: 'Smartest model for daily use (recommended)',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        isDefault: true,
      }),
      this.createModel({
        id: 'opus',
        displayName: 'Opus 4.1',
        description: 'Most capable for complex tasks',
        contextWindow: 200000,
        maxOutputTokens: 8192,
      }),
      this.createModel({
        id: 'sonnet[1m]',
        displayName: 'Sonnet (1M context)',
        description: 'Sonnet 4.5 with extended 1M context window',
        contextWindow: 1000000,
        maxOutputTokens: 8192,
      }),
    ];
  }

  isConfigured(): boolean {
    // SDK provider is always "configured" - it will use existing Claude authentication
    // Session token is optional - SDK auto-detects auth from Claude Code CLI, browser, or env vars
    return true;
  }

  /**
   * Map Lace's permission override mode to SDK permission mode
   */
  protected mapPermissionMode(laceMode: PermissionOverrideMode): SDKPermissionMode {
    switch (laceMode) {
      case 'yolo':
        return 'bypassPermissions';
      case 'read-only':
        return 'plan'; // Plan mode doesn't execute, only plans
      case 'normal':
      default:
        return 'default';
    }
  }

  /**
   * Handle approval response from external event system
   * Called when TOOL_APPROVAL_RESPONSE event arrives
   */
  public handleApprovalResponse(toolCallId: string, decision: ApprovalDecision): void {
    const pending = this.pendingApprovals.get(toolCallId);
    if (pending) {
      logger.debug('Resolving pending approval', { toolCallId, decision });
      pending.resolve(decision);
      this.pendingApprovals.delete(toolCallId);
    } else {
      logger.warn('Received approval response for unknown tool call', { toolCallId });
    }
  }

  /**
   * Build canUseTool callback that integrates with Lace's approval system
   * This is passed to SDK and called before each tool execution
   *
   * NOTE: This handler is called by SDK BEFORE tool execution to check permissions.
   * It does NOT execute the tool - that happens in the MCP handler.
   * This is purely for permission checking and approval flow.
   */
  protected buildCanUseToolHandler(context: ProviderRequestContext): CanUseTool {
    const { toolExecutor, session } = context;

    if (!toolExecutor || !session) {
      throw new Error('ToolExecutor and Session required for approval handler');
    }

    return async (toolName, input, { signal, suggestions: _suggestions }) => {
      try {
        // Check tool allowlist first (fail-closed security)
        const config = session.getEffectiveConfiguration();
        if (config.tools && !config.tools.includes(toolName)) {
          logger.debug('Tool denied - not in allowlist', { toolName });
          return {
            behavior: 'deny',
            message: `Tool '${toolName}' is not in the allowed tools list`,
            interrupt: false,
          };
        }

        // Check if tool is marked as safeInternal (auto-allowed)
        const tool = toolExecutor.getTool(toolName);
        if (tool?.annotations?.safeInternal) {
          logger.debug('Tool auto-allowed - safeInternal', { toolName });
          return { behavior: 'allow', updatedInput: input };
        }

        // Get effective policy (respects permission override mode)
        const configuredPolicy = session.getToolPolicy(toolName);
        const effectivePolicy = tool
          ? toolExecutor.getEffectivePolicy(tool, configuredPolicy)
          : configuredPolicy;

        logger.debug('Checking tool permission', {
          toolName,
          configuredPolicy,
          effectivePolicy,
          permissionMode: session.getPermissionOverrideMode(),
        });

        // Handle based on effective policy
        switch (effectivePolicy) {
          case 'allow':
            return { behavior: 'allow', updatedInput: input };

          case 'deny':
            return {
              behavior: 'deny',
              message: `Tool '${toolName}' is denied by policy`,
              interrupt: false,
            };

          case 'ask': {
            // Need user approval - create promise and emit event
            const toolCallId = `approval-${Date.now()}-${Math.random().toString(36).slice(2)}`;

            logger.debug('Requesting tool approval', { toolName, toolCallId });

            const approvalPromise = new Promise<ApprovalDecision>((resolve, reject) => {
              this.pendingApprovals.set(toolCallId, { resolve, reject });

              // Emit event for external approval system
              this.emit('approval_request', {
                toolName,
                input,
                isReadOnly: tool?.annotations?.readOnlySafe || false,
                requestId: toolCallId,
                resolve, // Pass resolve directly so emitter can resolve
              });

              // Handle abort
              signal.addEventListener(
                'abort',
                () => {
                  this.pendingApprovals.delete(toolCallId);
                  reject(new Error('Tool approval aborted'));
                },
                { once: true }
              );
            });

            // Wait for approval decision
            const decision = await approvalPromise;

            logger.debug('Approval received', { toolName, toolCallId, decision });

            // Check if approval was granted
            const isAllowed = [
              ApprovalDecision.ALLOW_ONCE,
              ApprovalDecision.ALLOW_SESSION,
              ApprovalDecision.ALLOW_PROJECT,
              ApprovalDecision.ALLOW_ALWAYS,
            ].includes(decision);

            if (isAllowed) {
              return { behavior: 'allow', updatedInput: input };
            } else {
              return {
                behavior: 'deny',
                message: 'User denied tool execution',
                interrupt: true,
              };
            }
          }

          default:
            // Safe default: require approval
            logger.warn('Unknown policy, defaulting to ask', { effectivePolicy });
            return {
              behavior: 'deny',
              message: `Unknown policy for tool '${toolName}'`,
              interrupt: false,
            };
        }
      } catch (error) {
        logger.error('Error in canUseTool handler', {
          toolName,
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          behavior: 'deny',
          message: `Permission check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          interrupt: false,
        };
      }
    };
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tool.schema as any, // Zod schema - SDK expects ZodRawShape but accepts any Zod schema
        async (args: Record<string, unknown>, _extra: unknown) => {
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
