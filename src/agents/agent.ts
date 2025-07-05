// ABOUTME: Enhanced Agent class for event-driven conversation processing and tool execution
// ABOUTME: Core conversation engine that emits events instead of direct I/O for multiple interface support

import { EventEmitter } from 'events';
import {
  AIProvider,
  ProviderMessage,
  ProviderToolCall,
  ProviderToolResult,
} from '../providers/base-provider.js';
import { ToolCall, ToolResult } from '../tools/types.js';
import { Tool } from '../tools/tool.js';
import { ToolExecutor } from '../tools/executor.js';
import { ApprovalDecision } from '../tools/approval-types.js';
import { ThreadManager } from '../threads/thread-manager.js';
import { ThreadEvent } from '../threads/types.js';
import { logger } from '../utils/logger.js';
import { StopReasonHandler } from '../token-management/stop-reason-handler.js';
import { TokenBudgetManager } from '../token-management/token-budget-manager.js';
import { TokenBudgetConfig } from '../token-management/types.js';
import { loadPromptConfig } from '../config/prompts.js';
import { estimateTokens } from '../utils/token-estimation.js';

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
  toolCalls: ProviderToolCall[];
}

export type AgentState = 'idle' | 'thinking' | 'tool_execution' | 'streaming';

export interface CurrentTurnMetrics {
  startTime: Date;
  elapsedMs: number;
  tokensIn: number; // User input + tool results + model context
  tokensOut: number; // Model responses + tool calls
  turnId: string; // Unique ID for this user turn
}

// Event type definitions for TypeScript
export interface AgentEvents {
  agent_thinking_start: [];
  agent_token: [{ token: string }]; // Raw tokens including thinking block content during streaming
  agent_thinking_complete: [];
  agent_response_complete: [{ content: string }]; // Clean content with thinking blocks removed
  tool_call_start: [{ toolName: string; input: Record<string, unknown>; callId: string }];
  tool_call_complete: [{ toolName: string; result: ToolResult; callId: string }];
  state_change: [{ from: AgentState; to: AgentState }];
  error: [{ error: Error; context: object }];
  conversation_complete: [];
  token_usage_update: [{ usage: object }];
  token_budget_warning: [{ message: string; usage: object; recommendations: object }];
  // Turn tracking events
  turn_start: [{ turnId: string; userInput: string; metrics: CurrentTurnMetrics }];
  turn_progress: [{ metrics: CurrentTurnMetrics }];
  turn_complete: [{ turnId: string; metrics: CurrentTurnMetrics }];
  turn_aborted: [{ turnId: string; metrics: CurrentTurnMetrics }];
  // Retry events forwarded from providers
  retry_attempt: [{ attempt: number; delay: number; error: Error }];
  retry_exhausted: [{ attempts: number; lastError: Error }];
  approval_request: [
    {
      toolName: string;
      input: unknown;
      isReadOnly: boolean;
      requestId: string;
      resolve: (decision: ApprovalDecision) => void;
    },
  ];
}

export class Agent extends EventEmitter {
  private readonly _provider: AIProvider;
  private readonly _toolExecutor: ToolExecutor;
  private readonly _threadManager: ThreadManager;
  private readonly _threadId: string;
  private readonly _tools: Tool[];

  // Public access to tool executor for interfaces
  get toolExecutor(): ToolExecutor {
    return this._toolExecutor;
  }

  // Public access to thread manager for interfaces
  get threadManager(): ThreadManager {
    return this._threadManager;
  }

  // Public access to thread ID for delegation
  // IMPORTANT: This returns the CANONICAL thread ID, which remains stable across compactions
  // The canonical ID is the external identifier that clients see and should never change
  // Internally, we may switch to compacted threads, but this API maintains the stable contract
  get threadId(): string {
    return this._threadId;
  }
  private readonly _stopReasonHandler: StopReasonHandler;
  private readonly _tokenBudgetManager: TokenBudgetManager | null;
  private _state: AgentState = 'idle';
  private _isRunning = false;
  private _currentTurnMetrics: CurrentTurnMetrics | null = null;
  private _progressTimer: number | null = null;
  private _abortController: AbortController | null = null;
  private _lastStreamingTokenCount = 0; // Track last cumulative token count from streaming

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

    // Start new turn tracking
    this._startTurnTracking(content);

    // Add user input tokens to current turn
    this._addTokensToCurrentTurn('in', this._estimateTokens(content));

    if (content.trim()) {
      // Add user message to active thread (could be compacted thread after compaction)
      this._threadManager.addEvent(this._getActiveThreadId(), 'USER_MESSAGE', content);
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
  async start(): Promise<void> {
    // Load prompts when starting
    const promptConfig = await loadPromptConfig({
      tools: this._tools.map((tool) => ({ name: tool.name, description: tool.description })),
    });

    // Configure provider with loaded system prompt
    this._provider.setSystemPrompt(promptConfig.systemPrompt);

    // Record events for new conversations only
    const events = this._threadManager.getEvents(this._threadId);
    const hasConversationStarted = events.some(
      (e) => e.type === 'USER_MESSAGE' || e.type === 'AGENT_MESSAGE'
    );

    if (!hasConversationStarted) {
      this._threadManager.addEvent(this._threadId, 'SYSTEM_PROMPT', promptConfig.systemPrompt);
      this._threadManager.addEvent(
        this._threadId,
        'USER_SYSTEM_PROMPT',
        promptConfig.userInstructions
      );
    }

    this._isRunning = true;
    logger.info('AGENT: Started', {
      threadId: this._threadId,
      provider: this._provider.providerName,
    });
  }

  async stop(): Promise<void> {
    this._isRunning = false;
    this._clearProgressTimer();
    this._setState('idle');

    // Clean up provider resources
    try {
      await this._provider.cleanup();
    } catch (cleanupError) {
      logger.warn('Provider cleanup failed during stop', {
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }

    await this._threadManager.close();
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

  abort(): boolean {
    if (this._abortController && this._currentTurnMetrics) {
      this._abortController.abort();
      this._clearProgressTimer();

      // Emit abort event with current metrics
      this.emit('turn_aborted', {
        turnId: this._currentTurnMetrics.turnId,
        metrics: { ...this._currentTurnMetrics },
      });

      this._currentTurnMetrics = null;
      this._abortController = null;
      this._setState('idle');
      return true; // Successfully aborted
    }
    return false; // Nothing to abort
  }

  // State access (read-only)

  getCurrentState(): AgentState {
    return this._state;
  }

  getThreadId(): string {
    return this._threadId;
  }

  // Get the current active thread ID for INTERNAL operations
  // DESIGN EXPLANATION: This is the heart of the canonical ID mapping system
  //
  // EXTERNAL CONTRACT: agent.getThreadId() always returns the stable canonical ID
  // INTERNAL OPERATIONS: We use the current working thread (may be compacted)
  //
  // Why this works:
  // 1. External clients see stable thread IDs that never change
  // 2. Internal operations automatically use the latest compacted version
  // 3. ThreadManager maintains the mapping between canonical and working threads
  // 4. This enables seamless compaction without breaking external thread ID contracts
  //
  // Example flow:
  // - User creates thread "abc123"
  // - agent.getThreadId() returns "abc123" (canonical ID)
  // - After compaction, internal operations use "abc123_v2" (compacted thread)
  // - agent.getThreadId() STILL returns "abc123" (stable external contract)
  // - ThreadManager.getCanonicalId("abc123_v2") resolves back to "abc123"
  private _getActiveThreadId(): string {
    return this._threadManager.getCurrentThreadId() || this._threadId;
  }

  getAvailableTools(): Tool[] {
    return [...this._tools]; // Return copy to prevent mutation
  }

  get providerName(): string {
    return this._provider.providerName;
  }

  get provider(): AIProvider {
    return this._provider;
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

  // Thread message processing for agent-facing conversation
  buildThreadMessages(): ProviderMessage[] {
    // Use the current active thread (which might be a compacted thread after compaction)
    const events = this._threadManager.getEvents(this._getActiveThreadId());
    return this._buildConversationFromEvents(events);
  }

  // Private implementation methods
  private async _processConversation(): Promise<void> {
    this._abortController = new AbortController();

    try {
      // Check if compaction is needed before building conversation (simplified approach)
      if (await this._threadManager.needsCompaction(this._provider)) {
        logger.info('Thread compaction triggered', { threadId: this._threadId });
        const newThreadId = await this._threadManager.createCompactedVersion(
          'Auto-compaction',
          this._provider
        );
        // ThreadManager already switched to the new compacted thread
        logger.info('Thread compacted successfully', {
          canonicalThreadId: this._threadId, // Stable external ID
          newCompactedThreadId: newThreadId, // New compacted thread ID
          canonicalId: this._threadManager.getCanonicalId(this._threadId),
        });
      }

      // Rebuild conversation from thread events
      const conversation = this.buildThreadMessages();

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

      // Check context window before making request
      const contextWindow = this._provider.contextWindow;
      const maxOutputTokens = this._provider.maxCompletionTokens;

      // Try provider-specific token counting first, fall back to estimation
      let promptTokens: number;
      const providerCount = await this._provider.countTokens(conversation, this._tools);
      if (providerCount !== null) {
        promptTokens = providerCount;
        logger.debug('Using provider-specific token count', {
          threadId: this._threadId,
          promptTokens,
          provider: this._provider.providerName,
        });
      } else {
        promptTokens = this._estimateConversationTokens(conversation);
        logger.debug('Using estimated token count', {
          threadId: this._threadId,
          promptTokens,
        });
      }

      if (promptTokens + maxOutputTokens > contextWindow) {
        const percentage = Math.floor((promptTokens / contextWindow) * 100);

        this.emit('error', {
          error: new Error(
            `Context window exceeded: ${promptTokens} tokens (${percentage}% of ${contextWindow})`
          ),
          context: {
            phase: 'pre_request_validation',
            threadId: this._threadId,
            estimatedPromptTokens: promptTokens,
            contextWindow,
            maxOutputTokens,
          },
        });

        logger.error('Request blocked by context window limit', {
          threadId: this._threadId,
          promptTokens,
          contextWindow,
          maxOutputTokens,
          percentage,
        });

        this._setState('idle');
        return;
      } else if (promptTokens > contextWindow * 0.9) {
        // Emit warning if over 90% of context
        logger.warn('Context window nearly full', {
          threadId: this._threadId,
          promptTokens,
          contextWindow,
          percentage: Math.floor((promptTokens / contextWindow) * 100),
        });
      }

      // Set state and emit thinking start
      this._setState('thinking');
      this.emit('agent_thinking_start');

      // Get agent response with available tools
      let response: AgentResponse;

      try {
        response = await this._createResponse(
          conversation,
          this._tools,
          this._abortController?.signal
        );

        logger.debug('AGENT: Received response from provider', {
          threadId: this._threadId,
          hasContent: !!response.content,
          contentLength: response.content?.length || 0,
          toolCallCount: response.toolCalls?.length || 0,
        });
      } catch (error: unknown) {
        this._setState('idle');

        // Handle abort errors differently from regular errors
        if (error instanceof Error && error.name === 'AbortError') {
          logger.debug('AGENT: Request was aborted', {
            threadId: this._threadId,
            providerName: this._provider.providerName,
          });
          // Abort was called - don't treat as error, metrics already emitted by abort()
          return;
        }

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
        // Store raw content (with thinking blocks) for model context
        this._threadManager.addEvent(this._getActiveThreadId(), 'AGENT_MESSAGE', response.content);

        // Extract clean content for UI display and events
        const cleanedContent = response.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

        // Emit thinking complete and response complete
        this.emit('agent_thinking_complete');
        this.emit('agent_response_complete', { content: cleanedContent });
      }

      // Handle tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        await this._executeToolCalls(response.toolCalls);
        // Recurse to get next response after tool execution
        await this._processConversation();
      } else {
        // No tool calls, conversation is complete for this turn
        this._completeTurn();
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

      // Clean up provider resources on error to prevent hanging connections
      try {
        await this._provider.cleanup();
      } catch (cleanupError) {
        logger.warn('Provider cleanup failed', {
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
    } finally {
      this._abortController = null;
    }
  }

  private async _createResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    signal?: AbortSignal
  ): Promise<AgentResponse> {
    // Default to streaming if provider supports it (unless explicitly disabled)
    const useStreaming =
      this._provider.supportsStreaming && this._provider.config?.streaming !== false;

    if (useStreaming) {
      return this._createStreamingResponse(messages, tools, signal);
    } else {
      return this._createNonStreamingResponse(messages, tools, signal);
    }
  }

  private async _createStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    signal?: AbortSignal
  ): Promise<AgentResponse> {
    // Set to streaming state
    this._setState('streaming');

    // Set up provider event listeners
    const tokenListener = ({ token }: { token: string }) => {
      // Simple pass-through - emit all tokens as received
      this.emit('agent_token', { token });
    };

    const tokenUsageListener = ({
      usage,
    }: {
      usage: { promptTokens: number; completionTokens: number; totalTokens: number };
    }) => {
      // For streaming updates, we need to track only the delta
      // The completionTokens from streaming events are cumulative
      if (this._currentTurnMetrics && usage.completionTokens) {
        const deltaTokens = usage.completionTokens - this._lastStreamingTokenCount;
        if (deltaTokens > 0) {
          this._addTokensToCurrentTurn('out', deltaTokens);
          this._lastStreamingTokenCount = usage.completionTokens;
        }
      }
      this.emit('token_usage_update', { usage });
    };

    const errorListener = ({ error }: { error: Error }) => {
      this.emit('error', {
        error,
        context: { phase: 'streaming_response', threadId: this._threadId },
      });
    };

    const retryAttemptListener = ({ attempt, delay, error }: { attempt: number; delay: number; error: Error }) => {
      this.emit('retry_attempt', { attempt, delay, error });
    };

    const retryExhaustedListener = ({ attempts, lastError }: { attempts: number; lastError: Error }) => {
      this.emit('retry_exhausted', { attempts, lastError });
    };

    // Subscribe to provider events
    this._provider.on('token', tokenListener);
    this._provider.on('token_usage_update', tokenUsageListener);
    this._provider.on('error', errorListener);
    this._provider.on('retry_attempt', retryAttemptListener);
    this._provider.on('retry_exhausted', retryExhaustedListener);

    try {
      const response = await this._provider.createStreamingResponse(messages, tools, signal);

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

      // Add provider response tokens to current turn metrics
      this._addProviderResponseTokensToTurn(processedResponse);

      // Always emit token usage for UI updates
      if (processedResponse.usage) {
        this.emit('token_usage_update', { usage: processedResponse.usage });
      }

      return {
        content: processedResponse.content,
        toolCalls: processedResponse.toolCalls,
      };
    } finally {
      // Clean up event listeners
      this._provider.removeListener('token', tokenListener);
      this._provider.removeListener('token_usage_update', tokenUsageListener);
      this._provider.removeListener('error', errorListener);
      this._provider.removeListener('retry_attempt', retryAttemptListener);
      this._provider.removeListener('retry_exhausted', retryExhaustedListener);
    }
  }

  private async _createNonStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    signal?: AbortSignal
  ): Promise<AgentResponse> {
    // Set up retry event listeners for non-streaming requests
    const retryAttemptListener = ({ attempt, delay, error }: { attempt: number; delay: number; error: Error }) => {
      this.emit('retry_attempt', { attempt, delay, error });
    };

    const retryExhaustedListener = ({ attempts, lastError }: { attempts: number; lastError: Error }) => {
      this.emit('retry_exhausted', { attempts, lastError });
    };

    // Subscribe to provider retry events
    this._provider.on('retry_attempt', retryAttemptListener);
    this._provider.on('retry_exhausted', retryExhaustedListener);

    try {
      const response = await this._provider.createResponse(messages, tools, signal);

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

      // Add provider response tokens to current turn metrics
      this._addProviderResponseTokensToTurn(processedResponse);

      // Always emit token usage for UI updates
      if (processedResponse.usage) {
        this.emit('token_usage_update', { usage: processedResponse.usage });
      }

      return {
        content: processedResponse.content,
        toolCalls: processedResponse.toolCalls,
      };
    } finally {
      // Clean up retry event listeners
      this._provider.removeListener('retry_attempt', retryAttemptListener);
      this._provider.removeListener('retry_exhausted', retryExhaustedListener);
    }
  }

  private async _executeToolCalls(toolCalls: ProviderToolCall[]): Promise<void> {
    this._setState('tool_execution');

    logger.debug('AGENT: Processing tool calls', {
      threadId: this._threadId,
      toolCallCount: toolCalls.length,
      toolCalls: toolCalls.map((tc) => ({ id: tc.id, name: tc.name })),
    });

    for (const providerToolCall of toolCalls) {
      logger.debug('AGENT: Executing individual tool call', {
        threadId: this._threadId,
        toolCallId: providerToolCall.id,
        toolName: providerToolCall.name,
      });

      // Convert ProviderToolCall to ToolCall format
      const toolCall: ToolCall = {
        id: providerToolCall.id,
        name: providerToolCall.name,
        arguments: providerToolCall.input,
      };

      // Add tool call to thread
      this._threadManager.addEvent(this._getActiveThreadId(), 'TOOL_CALL', toolCall);

      // Emit tool call start event
      this.emit('tool_call_start', {
        toolName: providerToolCall.name,
        input: providerToolCall.input,
        callId: providerToolCall.id,
      });

      try {
        // Execute tool
        const result = await this._toolExecutor.executeTool(toolCall, {
          threadId: this._threadId,
        });

        const outputText = result.content[0]?.text || '';

        logger.debug('AGENT: Tool execution completed', {
          threadId: this._threadId,
          toolCallId: providerToolCall.id,
          toolName: providerToolCall.name,
          success: !result.isError,
          outputLength: outputText.length,
          hasError: result.isError,
        });

        // Emit tool call complete event
        this.emit('tool_call_complete', {
          toolName: providerToolCall.name,
          result,
          callId: providerToolCall.id,
        });

        // Add tool result to thread
        this._threadManager.addEvent(this._getActiveThreadId(), 'TOOL_RESULT', result);

        // Add tool output tokens to current turn metrics (estimated)
        this._addTokensToCurrentTurn('in', this._estimateTokens(outputText));
      } catch (error: unknown) {
        logger.error('AGENT: Tool execution error', {
          threadId: this._threadId,
          toolCallId: providerToolCall.id,
          toolName: providerToolCall.name,
          error: error instanceof Error ? error.message : String(error),
        });

        // Create a failed tool result
        const failedResult: ToolResult = {
          id: providerToolCall.id,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };

        this.emit('tool_call_complete', {
          toolName: providerToolCall.name,
          result: failedResult,
          callId: providerToolCall.id,
        });

        // Add failed tool result to thread
        this._threadManager.addEvent(this._getActiveThreadId(), 'TOOL_RESULT', failedResult);
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

  // Agent-specific conversation building (preserves thinking blocks for model context)
  private _buildConversationFromEvents(events: ThreadEvent[]): ProviderMessage[] {
    const messages: ProviderMessage[] = [];

    // Track which events have been processed to avoid duplicates
    const processedEventIndices = new Set<number>();

    for (let i = 0; i < events.length; i++) {
      if (processedEventIndices.has(i)) {
        continue;
      }

      const event = events[i];
      if (event.type === 'USER_MESSAGE') {
        messages.push({
          role: 'user',
          content: event.data as string,
        });
      } else if (event.type === 'AGENT_MESSAGE') {
        // Look ahead to see if there are immediate tool calls after this message
        const toolCallsForThisMessage: ProviderToolCall[] = [];

        // Find tool calls that should be grouped with this agent message
        let nextIndex = i + 1;
        while (nextIndex < events.length) {
          const nextEvent = events[nextIndex];

          // If we hit another AGENT_MESSAGE or USER_MESSAGE, stop looking
          if (nextEvent.type === 'AGENT_MESSAGE' || nextEvent.type === 'USER_MESSAGE') {
            break;
          }

          // If we find a TOOL_CALL, it belongs to this agent message
          if (nextEvent.type === 'TOOL_CALL') {
            const eventToolCall = nextEvent.data as ToolCall;
            toolCallsForThisMessage.push({
              id: eventToolCall.id,
              name: eventToolCall.name,
              input: eventToolCall.arguments,
            });
            processedEventIndices.add(nextIndex); // Mark as processed
          }

          nextIndex++;
        }

        // Create the assistant message with tool calls if any
        // IMPORTANT: Keep raw content (including thinking blocks) for model context
        const message: ProviderMessage = {
          role: 'assistant',
          content: event.data as string,
        };

        if (toolCallsForThisMessage.length > 0) {
          message.toolCalls = toolCallsForThisMessage;
        }

        messages.push(message);
      } else if (event.type === 'TOOL_CALL') {
        // If we reach here, it's an orphaned tool call (no preceding AGENT_MESSAGE)
        const toolCall = event.data as ToolCall;

        // Create an assistant message with just the tool call
        messages.push({
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: toolCall.id,
              name: toolCall.name,
              input: toolCall.arguments,
            },
          ],
        });
      } else if (event.type === 'TOOL_RESULT') {
        const toolResult = event.data as ToolResult;

        // Look ahead to see if there are more tool results to group together
        const toolResultsForThisMessage: ProviderToolResult[] = [];

        // Convert from ToolResult to ProviderToolResult format
        toolResultsForThisMessage.push({
          id: toolResult.id || '',
          content: toolResult.content,
          isError: toolResult.isError,
        });

        // Look for consecutive tool results
        let nextIndex = i + 1;
        while (nextIndex < events.length) {
          const nextEvent = events[nextIndex];

          // If we hit a non-TOOL_RESULT event, stop looking
          if (nextEvent.type !== 'TOOL_RESULT') {
            break;
          }

          const nextToolResult = nextEvent.data as ToolResult;
          // Convert from ToolResult to ProviderToolResult format
          toolResultsForThisMessage.push({
            id: nextToolResult.id || '',
            content: nextToolResult.content,
            isError: nextToolResult.isError,
          });

          processedEventIndices.add(nextIndex); // Mark as processed
          nextIndex++;
        }

        // Create user message with tool results
        messages.push({
          role: 'user',
          content: '', // No text content for pure tool results
          toolResults: toolResultsForThisMessage,
        });
      } else if (
        event.type === 'LOCAL_SYSTEM_MESSAGE' ||
        event.type === 'SYSTEM_PROMPT' ||
        event.type === 'USER_SYSTEM_PROMPT'
      ) {
        // Skip UI-only events - they're not sent to model
        continue;
      } else {
        throw new Error(`Unknown event type: ${event.type}`);
      }
    }

    return messages;
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

  // Turn tracking implementation
  private _startTurnTracking(userInput: string): void {
    const turnId = `turn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this._currentTurnMetrics = {
      startTime: new Date(),
      elapsedMs: 0,
      tokensIn: 0,
      tokensOut: 0,
      turnId,
    };

    // Reset streaming token count for new turn
    this._lastStreamingTokenCount = 0;

    this.emit('turn_start', { turnId, userInput, metrics: { ...this._currentTurnMetrics } });
    this._startProgressTimer();
  }

  private _startProgressTimer(): void {
    this._progressTimer = setInterval(() => {
      if (this._currentTurnMetrics) {
        try {
          const newElapsedMs = Date.now() - this._currentTurnMetrics.startTime.getTime();
          // Only emit if elapsed time has meaningfully changed (reduce unnecessary re-renders)
          if (Math.abs(newElapsedMs - this._currentTurnMetrics.elapsedMs) >= 500) {
            this._currentTurnMetrics.elapsedMs = newElapsedMs;
            this.emit('turn_progress', { metrics: { ...this._currentTurnMetrics } });
          }
        } catch (error) {
          // Defensive error handling for progress timer
          logger.debug('Progress timer error', {
            error: error instanceof Error ? error.message : String(error),
            threadId: this._threadId,
          });
        }
      }
    }, 1000) as unknown as number; // Every second
  }

  private _clearProgressTimer(): void {
    if (this._progressTimer) {
      clearInterval(this._progressTimer);
      this._progressTimer = null;
    }
  }

  private _completeTurn(): void {
    if (this._currentTurnMetrics) {
      this._clearProgressTimer();

      // Update final elapsed time
      this._currentTurnMetrics.elapsedMs =
        Date.now() - this._currentTurnMetrics.startTime.getTime();

      // Ensure elapsed time is at least 1ms for testing
      if (this._currentTurnMetrics.elapsedMs === 0) {
        this._currentTurnMetrics.elapsedMs = 1;
      }

      this.emit('turn_complete', {
        turnId: this._currentTurnMetrics.turnId,
        metrics: { ...this._currentTurnMetrics },
      });

      this._currentTurnMetrics = null;
    }
  }

  // Token tracking helper methods
  private _estimateTokens(text: string): number {
    return estimateTokens(text);
  }

  private _estimateConversationTokens(messages: ProviderMessage[]): number {
    let totalTokens = 0;

    try {
      for (const message of messages) {
        // Estimate message content tokens
        totalTokens += this._estimateTokens(message.content || '');

        // Add overhead for message structure (role, etc)
        totalTokens += 4; // Approximate overhead per message

        // Estimate tool calls if present
        if (message.toolCalls) {
          for (const toolCall of message.toolCalls) {
            try {
              totalTokens += this._estimateTokens(JSON.stringify(toolCall.input));
              totalTokens += 10; // Tool call structure overhead
            } catch {
              // Handle circular references or other JSON errors
              totalTokens += 50; // Conservative estimate for failed serialization
            }
          }
        }

        // Estimate tool results if present
        if (message.toolResults) {
          for (const result of message.toolResults) {
            try {
              const resultText = result.content.map((block) => block.text || '').join('');
              totalTokens += this._estimateTokens(resultText);
              totalTokens += 10; // Tool result structure overhead
            } catch {
              // Handle any content processing errors
              totalTokens += 50; // Conservative estimate
            }
          }
        }
      }

      // Sanity check
      if (!Number.isFinite(totalTokens) || totalTokens < 0) {
        logger.warn('Invalid token estimation, using fallback', {
          calculatedTokens: totalTokens,
          messageCount: messages.length,
        });
        return messages.length * 100; // Fallback: rough estimate per message
      }

      return totalTokens;
    } catch (error) {
      logger.error('Error estimating conversation tokens', {
        error: error instanceof Error ? error.message : String(error),
        messageCount: messages.length,
      });
      return messages.length * 100; // Fallback: rough estimate per message
    }
  }

  private _addTokensToCurrentTurn(direction: 'in' | 'out', tokens: number): void {
    if (this._currentTurnMetrics && tokens > 0 && Number.isFinite(tokens)) {
      if (direction === 'in') {
        this._currentTurnMetrics.tokensIn += tokens;
      } else {
        this._currentTurnMetrics.tokensOut += tokens;
      }

      // Emit immediate progress update on token changes
      this._currentTurnMetrics.elapsedMs =
        Date.now() - this._currentTurnMetrics.startTime.getTime();
      this.emit('turn_progress', { metrics: { ...this._currentTurnMetrics } });
    }
  }

  private _addProviderResponseTokensToTurn(response: {
    usage?: { promptTokens?: number; completionTokens?: number };
    content?: string;
  }): void {
    if (!this._currentTurnMetrics) return;

    // Use native token counts if available, otherwise estimate
    if (response.usage) {
      // Only add completion tokens to turn metrics
      // promptTokens include entire conversation context, not just current turn
      if (response.usage.completionTokens) {
        this._addTokensToCurrentTurn('out', response.usage.completionTokens);
      }
    } else {
      // Fallback to estimation when usage data is unavailable
      if (response.content) {
        const estimatedOutputTokens = this._estimateTokens(response.content);
        this._addTokensToCurrentTurn('out', estimatedOutputTokens);
      }
    }
  }
}
