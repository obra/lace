// ABOUTME: Enhanced Agent class for event-driven conversation processing and tool execution
// ABOUTME: Core conversation engine that emits events instead of direct I/O for multiple interface support

import { EventEmitter } from 'events';
import { AIProvider, ProviderMessage } from '../providers/types.js';
import { Tool, ToolResult } from '../tools/types.js';
import { ToolExecutor } from '../tools/executor.js';
import { ThreadManager } from '../threads/thread-manager.js';
import { buildConversationFromEvents } from '../threads/conversation-builder.js';
import { logger } from '../utils/logger.js';
import { StopReasonHandler } from '../token-management/stop-reason-handler.js';
import { TokenBudgetManager } from '../token-management/token-budget-manager.js';
import { TokenBudgetConfig } from '../token-management/types.js';

export interface AgentConfig {
  provider: AIProvider;
  toolExecutor: ToolExecutor;
  threadManager: ThreadManager;
  threadId: string;
  tools: Tool[];
  tokenBudget?: TokenBudgetConfig;
}

export interface AgentResponse {
  content: string;
  toolCalls: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type AgentState = 'idle' | 'thinking' | 'tool_execution' | 'streaming';

// Event type definitions for TypeScript
export interface AgentEvents {
  agent_thinking_start: [];
  agent_token: [{ token: string }];
  agent_thinking_complete: [{ content: string }];
  agent_response_complete: [{ content: string }];
  tool_call_start: [{ toolName: string; input: Record<string, unknown>; callId: string }];
  tool_call_complete: [{ toolName: string; result: ToolResult; callId: string }];
  state_change: [{ from: AgentState; to: AgentState }];
  error: [{ error: Error; context: object }];
  conversation_complete: [];
  token_budget_warning: [{ message: string; usage: object; recommendations: object }];
}

export class Agent extends EventEmitter {
  private readonly _provider: AIProvider;
  private readonly _toolExecutor: ToolExecutor;
  private readonly _threadManager: ThreadManager;
  private readonly _threadId: string;
  private readonly _tools: Tool[];
  private readonly _stopReasonHandler: StopReasonHandler;
  private readonly _tokenBudgetManager: TokenBudgetManager | null;
  private _state: AgentState = 'idle';
  private _isRunning = false;

  constructor(config: AgentConfig) {
    super();
    this._provider = config.provider;
    this._toolExecutor = config.toolExecutor;
    this._threadManager = config.threadManager;
    this._threadId = config.threadId;
    this._tools = config.tools;
    this._stopReasonHandler = new StopReasonHandler();
    this._tokenBudgetManager = config.tokenBudget
      ? new TokenBudgetManager(config.tokenBudget)
      : null;
  }

  // Core conversation methods
  async sendMessage(content: string): Promise<void> {
    if (!this._isRunning) {
      throw new Error('Agent is not started. Call start() first.');
    }

    logger.debug('AGENT: Processing user message', {
      threadId: this._threadId,
      contentLength: content.length,
      currentState: this._state,
    });

    if (content.trim()) {
      // Add user message to thread
      this._threadManager.addEvent(this._threadId, 'USER_MESSAGE', content);
    }

    await this._processConversation();
  }

  async continueConversation(): Promise<void> {
    if (!this._isRunning) {
      throw new Error('Agent is not started. Call start() first.');
    }

    await this._processConversation();
  }

  // Control methods
  start(): void {
    this._isRunning = true;
    logger.info('AGENT: Started', {
      threadId: this._threadId,
      provider: this._provider.providerName,
    });
  }

  stop(): void {
    this._isRunning = false;
    this._setState('idle');
    logger.info('AGENT: Stopped', { threadId: this._threadId });
  }

  pause(): void {
    // TODO: Implement pause/resume functionality
    throw new Error('Pause/resume not yet implemented');
  }

  resume(): void {
    // TODO: Implement pause/resume functionality
    throw new Error('Pause/resume not yet implemented');
  }

  // State access (read-only)
  getConversationHistory(): ProviderMessage[] {
    const events = this._threadManager.getEvents(this._threadId);
    return buildConversationFromEvents(events);
  }

  getCurrentState(): AgentState {
    return this._state;
  }

  getThreadId(): string {
    return this._threadId;
  }

  getAvailableTools(): Tool[] {
    return [...this._tools]; // Return copy to prevent mutation
  }

  get providerName(): string {
    return this._provider.providerName;
  }

  // Token budget management
  getTokenBudgetStatus() {
    return this._tokenBudgetManager?.getBudgetStatus() || null;
  }

  getTokenBudgetRecommendations() {
    return this._tokenBudgetManager?.getRecommendations() || null;
  }

  resetTokenBudget(): void {
    this._tokenBudgetManager?.reset();
  }

  // Private implementation methods
  private async _processConversation(): Promise<void> {
    try {
      // Rebuild conversation from thread events
      const events = this._threadManager.getEvents(this._threadId);
      const conversation = buildConversationFromEvents(events);

      logger.debug('AGENT: Requesting response from provider', {
        threadId: this._threadId,
        conversationLength: conversation.length,
        availableToolCount: this._tools.length,
        availableToolNames: this._tools.map((t) => t.name),
      });

      // Check token budget before making request
      if (this._tokenBudgetManager) {
        const conversationTokens = this._tokenBudgetManager.estimateConversationTokens(
          conversation.map((msg) => ({ role: msg.role, content: msg.content }))
        );

        if (!this._tokenBudgetManager.canMakeRequest(conversationTokens + 200)) {
          const recommendations = this._tokenBudgetManager.getRecommendations();
          this.emit('token_budget_warning', {
            message: 'Cannot make request: would exceed token budget',
            usage: this._tokenBudgetManager.getBudgetStatus(),
            recommendations,
          });

          logger.warn('Request blocked by token budget', {
            threadId: this._threadId,
            estimatedTokens: conversationTokens + 200,
            budgetStatus: this._tokenBudgetManager.getBudgetStatus(),
            recommendations,
          });

          this._setState('idle');
          return;
        }
      }

      // Set state and emit thinking start
      this._setState('thinking');
      this.emit('agent_thinking_start');

      // Get agent response with available tools
      let response: AgentResponse;

      try {
        response = await this._createResponse(conversation, this._tools);

        logger.debug('AGENT: Received response from provider', {
          threadId: this._threadId,
          hasContent: !!response.content,
          contentLength: response.content?.length || 0,
          toolCallCount: response.toolCalls?.length || 0,
        });
      } catch (error: unknown) {
        this._setState('idle');

        logger.error('AGENT: Provider error', {
          threadId: this._threadId,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
          providerName: this._provider.providerName,
        });

        this.emit('error', {
          error: error instanceof Error ? error : new Error(String(error)),
          context: { phase: 'provider_response', threadId: this._threadId },
        });
        return;
      }

      // Process agent response
      if (response.content) {
        // Extract think blocks and regular content
        const cleanedContent = response.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

        // Add agent message to thread
        this._threadManager.addEvent(this._threadId, 'AGENT_MESSAGE', response.content);

        this.emit('agent_thinking_complete', { content: response.content });

        // Emit cleaned response if there's meaningful content
        if (cleanedContent && cleanedContent.length > 0) {
          this.emit('agent_response_complete', { content: cleanedContent });
        }
      }

      // Handle tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        await this._executeToolCalls(response.toolCalls);
        // Recurse to get next response after tool execution
        await this._processConversation();
      } else {
        // No tool calls, conversation is complete for this turn
        this._setState('idle');
        this.emit('conversation_complete');
      }
    } catch (error: unknown) {
      this._setState('idle');

      logger.error('AGENT: Unexpected error in conversation processing', {
        threadId: this._threadId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      this.emit('error', {
        error: error instanceof Error ? error : new Error(String(error)),
        context: { phase: 'conversation_processing', threadId: this._threadId },
      });
    }
  }

  private async _createResponse(
    messages: ProviderMessage[],
    tools: Tool[]
  ): Promise<AgentResponse> {
    // Default to streaming if provider supports it (unless explicitly disabled)
    const useStreaming =
      this._provider.supportsStreaming && this._provider.config?.streaming !== false;

    if (useStreaming) {
      return this._createStreamingResponse(messages, tools);
    } else {
      return this._createNonStreamingResponse(messages, tools);
    }
  }

  private async _createStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[]
  ): Promise<AgentResponse> {
    // Set to streaming state
    this._setState('streaming');

    // Set up provider event listeners
    const tokenListener = ({ token }: { token: string }) => {
      this.emit('agent_token', { token });
    };

    const errorListener = ({ error }: { error: Error }) => {
      this.emit('error', {
        error,
        context: { phase: 'streaming_response', threadId: this._threadId },
      });
    };

    // Subscribe to provider events
    this._provider.on('token', tokenListener);
    this._provider.on('error', errorListener);

    try {
      const response = await this._provider.createStreamingResponse(messages, tools);

      // Apply stop reason handling to filter incomplete tool calls
      const processedResponse = this._stopReasonHandler.handleResponse(response, tools);

      // Record token usage if budget tracking is enabled
      if (this._tokenBudgetManager) {
        this._tokenBudgetManager.recordUsage(processedResponse);

        // Emit warning if approaching budget limits
        const recommendations = this._tokenBudgetManager.getRecommendations();
        if (recommendations.warningMessage) {
          this.emit('token_budget_warning', {
            message: recommendations.warningMessage,
            usage: this._tokenBudgetManager.getBudgetStatus(),
            recommendations,
          });
        }
      }

      return {
        content: processedResponse.content,
        toolCalls: processedResponse.toolCalls,
      };
    } finally {
      // Clean up event listeners
      this._provider.removeListener('token', tokenListener);
      this._provider.removeListener('error', errorListener);
    }
  }

  private async _createNonStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[]
  ): Promise<AgentResponse> {
    const response = await this._provider.createResponse(messages, tools);

    // Apply stop reason handling to filter incomplete tool calls
    const processedResponse = this._stopReasonHandler.handleResponse(response, tools);

    // Record token usage if budget tracking is enabled
    if (this._tokenBudgetManager) {
      this._tokenBudgetManager.recordUsage(processedResponse);

      // Emit warning if approaching budget limits
      const recommendations = this._tokenBudgetManager.getRecommendations();
      if (recommendations.warningMessage) {
        this.emit('token_budget_warning', {
          message: recommendations.warningMessage,
          usage: this._tokenBudgetManager.getBudgetStatus(),
          recommendations,
        });
      }
    }

    return {
      content: processedResponse.content,
      toolCalls: processedResponse.toolCalls,
    };
  }

  private async _executeToolCalls(toolCalls: ToolCall[]): Promise<void> {
    this._setState('tool_execution');

    logger.debug('AGENT: Processing tool calls', {
      threadId: this._threadId,
      toolCallCount: toolCalls.length,
      toolCalls: toolCalls.map((tc) => ({ id: tc.id, name: tc.name })),
    });

    for (const toolCall of toolCalls) {
      logger.debug('AGENT: Executing individual tool call', {
        threadId: this._threadId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
      });

      // Add tool call to thread
      this._threadManager.addEvent(this._threadId, 'TOOL_CALL', {
        toolName: toolCall.name,
        input: toolCall.input,
        callId: toolCall.id,
      });

      // Emit tool call start event
      this.emit('tool_call_start', {
        toolName: toolCall.name,
        input: toolCall.input,
        callId: toolCall.id,
      });

      try {
        // Execute tool
        const result = await this._toolExecutor.executeTool(toolCall.name, toolCall.input, {
          threadId: this._threadId,
        });

        const outputText = result.content[0]?.text || '';

        logger.debug('AGENT: Tool execution completed', {
          threadId: this._threadId,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          success: result.success,
          outputLength: outputText.length,
          hasError: !!result.error,
        });

        // Emit tool call complete event
        this.emit('tool_call_complete', {
          toolName: toolCall.name,
          result,
          callId: toolCall.id,
        });

        // Add tool result to thread
        this._threadManager.addEvent(this._threadId, 'TOOL_RESULT', {
          callId: toolCall.id,
          output: outputText,
          success: result.success,
          error: result.error,
        });
      } catch (error: unknown) {
        logger.error('AGENT: Tool execution error', {
          threadId: this._threadId,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          error: error instanceof Error ? error.message : String(error),
        });

        // Create a failed tool result
        const failedResult: ToolResult = {
          success: false,
          content: [],
          error: error instanceof Error ? error.message : String(error),
        };

        this.emit('tool_call_complete', {
          toolName: toolCall.name,
          result: failedResult,
          callId: toolCall.id,
        });

        // Add failed tool result to thread
        this._threadManager.addEvent(this._threadId, 'TOOL_RESULT', {
          callId: toolCall.id,
          output: '',
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private _setState(newState: AgentState): void {
    const oldState = this._state;
    if (oldState !== newState) {
      this._state = newState;
      this.emit('state_change', { from: oldState, to: newState });

      logger.debug('AGENT: State change', {
        threadId: this._threadId,
        from: oldState,
        to: newState,
      });
    }
  }

  // Override emit to provide type safety
  emit<K extends keyof AgentEvents>(event: K, ...args: AgentEvents[K]): boolean {
    return super.emit(event, ...args);
  }

  // Override on to provide type safety
  on<K extends keyof AgentEvents>(event: K, listener: (...args: AgentEvents[K]) => void): this {
    return super.on(event, listener);
  }

  // Override once to provide type safety
  once<K extends keyof AgentEvents>(event: K, listener: (...args: AgentEvents[K]) => void): this {
    return super.once(event, listener);
  }
}
