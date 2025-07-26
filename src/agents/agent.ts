// ABOUTME: Enhanced Agent class for event-driven conversation processing and tool execution
// ABOUTME: Core conversation engine that emits events instead of direct I/O for multiple interface support

import { EventEmitter } from 'events';
import { AIProvider, ProviderMessage, ProviderToolCall } from '~/providers/base-provider';
import { ToolCall, ToolResult } from '~/tools/types';
import { Tool } from '~/tools/tool';
import { ToolExecutor } from '~/tools/executor';
import { ApprovalDecision } from '~/tools/approval-types';
import { ThreadManager, ThreadSessionInfo } from '~/threads/thread-manager';
import { ThreadEvent, EventType, ToolApprovalResponseData, asThreadId } from '~/threads/types';
import { logger } from '~/utils/logger';
import { StopReasonHandler } from '~/token-management/stop-reason-handler';
import { TokenBudgetManager } from '~/token-management/token-budget-manager';
import { TokenBudgetConfig, BudgetStatus, BudgetRecommendations } from '~/token-management/types';
import { loadPromptConfig } from '~/config/prompts';
import { estimateTokens } from '~/utils/token-estimation';
import { QueuedMessage, MessageQueueStats } from '~/agents/types';
import { ProviderRegistry } from '~/providers/registry';
import { Project } from '~/projects/project';
import { Session } from '~/sessions/session';
import { AgentConfiguration, ConfigurationValidator } from '~/sessions/session-config';

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
  retryMetrics?: {
    totalAttempts: number; // Total retry attempts made (0 if no retries)
    totalDelayMs: number; // Total time spent waiting for retries
    lastError?: string; // Last error that caused retry, if any
    successful: boolean; // Whether the operation ultimately succeeded
  };
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
  error: [{ error: Error; context: Record<string, unknown> }];
  conversation_complete: [];
  token_usage_update: [
    { usage: { promptTokens: number; completionTokens: number; totalTokens: number } },
  ];
  token_budget_warning: [
    { message: string; usage: BudgetStatus; recommendations: BudgetRecommendations },
  ];
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
  // Thread events proxied from ThreadManager
  thread_event_added: [{ event: ThreadEvent; threadId: string }];
  thread_state_changed: [{ threadId: string; eventType: string }];
  // Queue events
  queue_processing_start: [];
  queue_processing_complete: [];
  message_queued: [{ id: string; queueLength: number }];
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

  // Public access to provider name for interfaces
  get providerName(): string {
    return this._provider.providerName;
  }

  // Public access to thread ID for delegation
  get threadId(): string {
    return this._threadId;
  }

  // Public access to thread manager for approval system
  get threadManager(): ThreadManager {
    return this._threadManager;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }
  private readonly _stopReasonHandler: StopReasonHandler;
  private readonly _tokenBudgetManager: TokenBudgetManager | null;
  private _state: AgentState = 'idle';
  private _isRunning = false;
  private _currentTurnMetrics: CurrentTurnMetrics | null = null;
  private _progressTimer: number | null = null;
  private _abortController: AbortController | null = null;
  private _lastStreamingTokenCount = 0; // Track last cumulative token count from streaming
  private _messageQueue: QueuedMessage[] = [];
  private _isProcessingQueue = false;
  private _configuration: AgentConfiguration = {};
  private _cachedProviderInstance: AIProvider | null = null;
  private _cachedProviderKey: string | null = null;

  // Simple tool batch tracking
  private _pendingToolCount = 0;
  private _hasRejectionsInBatch = false;

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

    // Listen for tool approval responses
    this.on('thread_event_added', ({ event }) => {
      if (event.type === 'TOOL_APPROVAL_RESPONSE') {
        this._handleToolApprovalResponse(event);
      }
    });

    // Events are emitted through _addEventAndEmit() helper method
  }

  // Core conversation methods
  async sendMessage(
    content: string,
    options?: {
      queue?: boolean;
      metadata?: QueuedMessage['metadata'];
    }
  ): Promise<void> {
    if (!this._isRunning) {
      await this.start();
    }

    if (this._state === 'idle') {
      // Process immediately
      return this._processMessage(content);
    }

    if (options?.queue) {
      // Queue for later
      const id = this.queueMessage(content, 'user', options.metadata);
      this.emit('message_queued', { id, queueLength: this._messageQueue.length });
      return;
    }

    // Current behavior - throw error
    throw new Error(`Agent is ${this._state}, cannot accept messages`);
  }

  private async _processMessage(content: string): Promise<void> {
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
      // Add user message to active thread
      this._addEventAndEmit(this._threadId, 'USER_MESSAGE', content);
    }

    try {
      await this._processConversation();
    } catch (error) {
      // Ensure turn is completed even if _processConversation throws
      // (this handles the case where error occurs before _processConversation's catch block)
      if (this._currentTurnMetrics) {
        this._completeTurn();
      }
      throw error; // Re-throw to maintain API contract
    }
  }

  async continueConversation(): Promise<void> {
    if (!this._isRunning) {
      await this.start();
    }

    await this._processConversation();
  }

  // Control methods
  async start(): Promise<void> {
    // Load prompts when starting
    const session = this._getSession();
    const project = this._getProject();

    logger.debug('Agent.start() - loading prompt config with session/project context', {
      threadId: this._threadId,
      hasSession: !!session,
      hasProject: !!project,
      sessionWorkingDir: session?.getWorkingDirectory(),
      projectWorkingDir: project?.getWorkingDirectory(),
    });

    const promptConfig = await loadPromptConfig({
      tools: this._tools.map((tool) => ({ name: tool.name, description: tool.description })),
      session: session,
      project: project,
    });

    // Configure provider with loaded system prompt
    this.providerInstance.setSystemPrompt(promptConfig.systemPrompt);

    // Record events for new conversations only - check for existing prompts too
    const events = this._threadManager.getEvents(this._threadId);
    const hasConversationStarted = events.some(
      (e) => e.type === 'USER_MESSAGE' || e.type === 'AGENT_MESSAGE'
    );
    const hasSystemPrompts = events.some(
      (e) => e.type === 'SYSTEM_PROMPT' || e.type === 'USER_SYSTEM_PROMPT'
    );

    if (!hasConversationStarted && !hasSystemPrompts) {
      this._addEventAndEmit(this._threadId, 'SYSTEM_PROMPT', promptConfig.systemPrompt);
      this._addEventAndEmit(this._threadId, 'USER_SYSTEM_PROMPT', promptConfig.userInstructions);
    }

    this._isRunning = true;
    logger.info('AGENT: Started', {
      threadId: this._threadId,
      provider: this._provider.providerName,
    });
  }

  stop(): void {
    this._isRunning = false;
    this._clearProgressTimer();
    this._setState('idle');

    // Clean up provider resources
    try {
      this._provider.cleanup();
    } catch (cleanupError) {
      logger.warn('Provider cleanup failed during stop', {
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }

    this._threadManager.close();
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

  getAvailableTools(): Tool[] {
    return [...this._tools]; // Return copy to prevent mutation
  }

  get providerInstance(): AIProvider {
    const metadata = this.getThreadMetadata();
    const targetProvider = (metadata?.provider as string) || this._provider.providerName;
    const targetModel = (metadata?.model as string) || this._provider.modelName;

    // Create cache key based on provider and model
    const cacheKey = `${targetProvider}:${targetModel}`;

    // Create cache key based on provider and model

    // If current metadata matches the constructor provider, return it
    if (
      targetProvider === this._provider.providerName &&
      targetModel === this._provider.modelName
    ) {
      // Using constructor provider - no need to create new instance
      return this._provider;
    }

    // Check if we have a cached provider for this configuration
    if (this._cachedProviderKey === cacheKey && this._cachedProviderInstance) {
      return this._cachedProviderInstance;
    }

    // Clean up old cached provider if it exists
    if (this._cachedProviderInstance && this._cachedProviderKey !== cacheKey) {
      this._cachedProviderInstance.cleanup();
    }

    // Create new provider instance and cache it
    // Creating new provider instance from metadata
    const registry = ProviderRegistry.createWithAutoDiscovery();
    const newProvider = registry.createProvider(targetProvider, { model: targetModel });

    // Cache the new provider
    this._cachedProviderInstance = newProvider;
    this._cachedProviderKey = cacheKey;

    // Provider instance created and cached
    return newProvider;
  }

  get provider(): string {
    const metadata = this.getThreadMetadata();
    return (metadata?.provider as string) || this._provider.providerName;
  }

  get name(): string {
    const metadata = this.getThreadMetadata();
    return (metadata?.name as string) || 'unnamed-agent';
  }

  get model(): string {
    const metadata = this.getThreadMetadata();
    return (metadata?.model as string) || this._provider.modelName || 'unknown-model';
  }

  get status(): string {
    return this._state;
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
    // Use the current active thread
    const activeThreadId = this._threadId;
    // Building conversation messages from thread events

    const events = this._threadManager.getEvents(activeThreadId);
    const messages = this._buildConversationFromEvents(events);
    return messages;
  }

  // Private implementation methods
  private async _processConversation(): Promise<void> {
    this._abortController = new AbortController();

    try {
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
      const contextWindow = this.providerInstance.contextWindow;
      const maxOutputTokens = this.providerInstance.maxCompletionTokens;

      // Try provider-specific token counting first, fall back to estimation
      let promptTokens: number;
      const providerCount = await this.providerInstance.countTokens(conversation, this._tools);
      if (providerCount !== null) {
        promptTokens = providerCount;
        logger.debug('Using provider-specific token count', {
          threadId: this._threadId,
          promptTokens,
          provider: this.providerInstance.providerName,
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
            providerName: this.providerInstance.providerName,
          });
          // Abort was called - don't treat as error, metrics already emitted by abort()
          return;
        }

        logger.error('AGENT: Provider error', {
          threadId: this._threadId,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
          providerName: this.providerInstance.providerName,
        });

        this.emit('error', {
          error: error instanceof Error ? error : new Error(String(error)),
          context: { phase: 'provider_response', threadId: this._threadId },
        });

        // Complete turn tracking even when provider error occurs
        this._completeTurn();
        return;
      }

      // Process agent response
      if (response.content) {
        // Store raw content (with thinking blocks) for model context
        this._addEventAndEmit(this._threadId, 'AGENT_MESSAGE', response.content);

        // Extract clean content for UI display and events
        const cleanedContent = response.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

        // Emit thinking complete and response complete
        this.emit('agent_thinking_complete');
        this.emit('agent_response_complete', { content: cleanedContent });
      }

      // Handle tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        this._executeToolCalls(response.toolCalls); // No await
        // NO RECURSIVE CALL - tools will auto-continue or wait for user input
        // DON'T complete turn yet - wait for all tools to finish
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

      // Complete turn tracking even when error occurs
      this._completeTurn();

      // Clean up provider resources on error to prevent hanging connections
      try {
        this._provider.cleanup();
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
      this.providerInstance.supportsStreaming && this.providerInstance.config?.streaming !== false;

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

    const retryAttemptListener = ({
      attempt,
      delay,
      error,
    }: {
      attempt: number;
      delay: number;
      error: Error;
    }) => {
      // Track retry metrics for the current turn
      if (this._currentTurnMetrics?.retryMetrics) {
        this._currentTurnMetrics.retryMetrics.totalAttempts = attempt;
        this._currentTurnMetrics.retryMetrics.totalDelayMs += delay;
        this._currentTurnMetrics.retryMetrics.lastError = error.message;
      }
      this.emit('retry_attempt', { attempt, delay, error });
    };

    const retryExhaustedListener = ({
      attempts,
      lastError,
    }: {
      attempts: number;
      lastError: Error;
    }) => {
      // Mark retry as failed when exhausted
      if (this._currentTurnMetrics?.retryMetrics) {
        this._currentTurnMetrics.retryMetrics.totalAttempts = attempts;
        this._currentTurnMetrics.retryMetrics.successful = false;
        this._currentTurnMetrics.retryMetrics.lastError = lastError.message;
      }
      this.emit('retry_exhausted', { attempts, lastError });
    };

    // Subscribe to provider events
    this.providerInstance.on('token', tokenListener);
    this.providerInstance.on('token_usage_update', tokenUsageListener);
    this.providerInstance.on('error', errorListener);
    this.providerInstance.on('retry_attempt', retryAttemptListener);
    this.providerInstance.on('retry_exhausted', retryExhaustedListener);

    try {
      const response = await this.providerInstance.createStreamingResponse(messages, tools, signal);

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
      this.providerInstance.removeListener('token', tokenListener);
      this.providerInstance.removeListener('token_usage_update', tokenUsageListener);
      this.providerInstance.removeListener('error', errorListener);
      this.providerInstance.removeListener('retry_attempt', retryAttemptListener);
      this.providerInstance.removeListener('retry_exhausted', retryExhaustedListener);
    }
  }

  private async _createNonStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    signal?: AbortSignal
  ): Promise<AgentResponse> {
    // Set up retry event listeners for non-streaming requests
    const retryAttemptListener = ({
      attempt,
      delay,
      error,
    }: {
      attempt: number;
      delay: number;
      error: Error;
    }) => {
      // Track retry metrics for the current turn
      if (this._currentTurnMetrics?.retryMetrics) {
        this._currentTurnMetrics.retryMetrics.totalAttempts = attempt;
        this._currentTurnMetrics.retryMetrics.totalDelayMs += delay;
        this._currentTurnMetrics.retryMetrics.lastError = error.message;
      }
      this.emit('retry_attempt', { attempt, delay, error });
    };

    const retryExhaustedListener = ({
      attempts,
      lastError,
    }: {
      attempts: number;
      lastError: Error;
    }) => {
      // Mark retry as failed when exhausted
      if (this._currentTurnMetrics?.retryMetrics) {
        this._currentTurnMetrics.retryMetrics.totalAttempts = attempts;
        this._currentTurnMetrics.retryMetrics.successful = false;
        this._currentTurnMetrics.retryMetrics.lastError = lastError.message;
      }
      this.emit('retry_exhausted', { attempts, lastError });
    };

    // Subscribe to provider retry events
    this.providerInstance.on('retry_attempt', retryAttemptListener);
    this.providerInstance.on('retry_exhausted', retryExhaustedListener);

    try {
      const response = await this.providerInstance.createResponse(messages, tools, signal);

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
      this.providerInstance.removeListener('retry_attempt', retryAttemptListener);
      this.providerInstance.removeListener('retry_exhausted', retryExhaustedListener);
    }
  }

  private _executeToolCalls(toolCalls: ProviderToolCall[]): void {
    // No longer async - doesn't block
    this._setState('tool_execution');

    logger.debug('AGENT: Processing tool calls', {
      threadId: this._threadId,
      toolCallCount: toolCalls.length,
      toolCalls: toolCalls.map((tc) => ({ id: tc.id, name: tc.name })),
    });

    // Initialize tool batch tracking
    this._pendingToolCount = toolCalls.length;
    this._hasRejectionsInBatch = false;

    for (const providerToolCall of toolCalls) {
      logger.debug('AGENT: Creating tool call event', {
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
      this._addEventAndEmit(this._threadId, 'TOOL_CALL', toolCall);

      // Emit tool call start event for UI
      this.emit('tool_call_start', {
        toolName: providerToolCall.name,
        input: providerToolCall.input,
        callId: providerToolCall.id,
      });

      // Attempt tool execution immediately
      // This will trigger approval flow and create approval requests
      void this._executeSingleTool(toolCall);
    }

    // Agent goes idle immediately - no waiting
    this._setState('idle');
  }

  /**
   * Handle TOOL_APPROVAL_RESPONSE events by executing the approved tool
   */
  private _handleToolApprovalResponse(event: ThreadEvent): void {
    if (event.type !== 'TOOL_APPROVAL_RESPONSE') return;

    const responseData = event.data as ToolApprovalResponseData;
    const { toolCallId, decision } = responseData;

    // Find the corresponding TOOL_CALL event
    const events = this._threadManager.getEvents(this._threadId);
    const toolCallEvent = events.find(
      (e) => e.type === 'TOOL_CALL' && (e.data as ToolCall).id === toolCallId
    );

    if (!toolCallEvent) {
      logger.error('AGENT: No TOOL_CALL event found for approval response', {
        threadId: this._threadId,
        toolCallId,
      });
      return;
    }

    const toolCall = toolCallEvent.data as ToolCall;

    if (decision === ApprovalDecision.DENY) {
      // Create error result for denied tool
      const errorResult: ToolResult = {
        id: toolCallId,
        isError: true,
        content: [{ type: 'text', text: 'Tool execution denied by user' }],
      };
      this._addEventAndEmit(this._threadId, 'TOOL_RESULT', errorResult);

      // Track rejection
      this._hasRejectionsInBatch = true;
    } else {
      // Execute the approved tool
      void this._executeSingleTool(toolCall);
    }

    // Check if all tools are complete
    this._pendingToolCount--;
    if (this._pendingToolCount === 0) {
      // All tools complete - decide what to do next
      if (this._hasRejectionsInBatch) {
        // Has rejections - wait for user input
        this._setState('idle');
        // Don't auto-continue conversation
      } else {
        // All approved - auto-continue conversation
        this._completeTurn();
        this._setState('idle');
        void this._processConversation();
      }
    }
  }

  /**
   * Execute a single tool call without blocking
   */
  private async _executeSingleTool(toolCall: ToolCall): Promise<void> {
    try {
      const workingDirectory = this._getWorkingDirectory();
      const toolContext = {
        threadId: asThreadId(this._threadId),
        parentThreadId: asThreadId(this._getParentThreadId()),
        workingDirectory,
      };

      // Execute tool - this will handle its own approval if needed
      const result = await this._toolExecutor.executeTool(toolCall, toolContext);

      // Only add TOOL_RESULT if not pending
      if (!result.isPending) {
        this._addEventAndEmit(this._threadId, 'TOOL_RESULT', result);

        // Emit tool call complete event
        this.emit('tool_call_complete', {
          toolName: toolCall.name,
          result,
          callId: toolCall.id,
        });
      }
      // If pending, the approval system will handle execution later
    } catch (error: unknown) {
      logger.error('AGENT: Tool execution failed', {
        threadId: this._threadId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        error: error instanceof Error ? error.message : String(error),
      });

      const errorResult: ToolResult = {
        id: toolCall.id,
        isError: true,
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
      };
      this._addEventAndEmit(this._threadId, 'TOOL_RESULT', errorResult);

      // Emit tool call complete event for failed execution
      this.emit('tool_call_complete', {
        toolName: toolCall.name,
        result: errorResult,
        callId: toolCall.id,
      });
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

      // Process queue when returning to idle
      if (newState === 'idle' && !this._isProcessingQueue) {
        this.processQueuedMessages().catch((error) => {
          logger.error('AGENT: Failed to process queue on state change', {
            threadId: this._threadId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
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

        // Find the most recent assistant message with tool calls that contains this tool result ID
        let targetAssistantMessage: ProviderMessage | undefined;
        let targetAssistantIndex = -1;

        for (let j = messages.length - 1; j >= 0; j--) {
          const msg = messages[j];
          if (
            msg.role === 'assistant' &&
            msg.toolCalls &&
            msg.toolCalls.some((tc) => tc.id === toolResult.id)
          ) {
            targetAssistantMessage = msg;
            targetAssistantIndex = j;
            break;
          }
        }

        if (targetAssistantMessage) {
          // Find if there's already a user message with tool results after this assistant message
          let existingUserMessage: ProviderMessage | undefined;
          for (let j = targetAssistantIndex + 1; j < messages.length; j++) {
            const msg = messages[j];
            if (msg.role === 'user' && msg.toolResults && msg.toolResults.length > 0) {
              existingUserMessage = msg;
              break;
            }
          }

          if (existingUserMessage) {
            // Add this tool result to the existing user message
            existingUserMessage.toolResults!.push({
              id: toolResult.id || '',
              content: toolResult.content,
              isError: toolResult.isError,
            });
          } else {
            // Create a new user message with this tool result
            messages.push({
              role: 'user',
              content: '',
              toolResults: [
                {
                  id: toolResult.id || '',
                  content: toolResult.content,
                  isError: toolResult.isError,
                },
              ],
            });
          }
        } else {
          // This tool result doesn't correspond to any assistant message with tool calls
          // Try to find the corresponding TOOL_CALL event to create a synthetic assistant message
          const correspondingToolCallEvent = events.find(
            (e) => e.type === 'TOOL_CALL' && (e.data as ToolCall).id === toolResult.id
          );

          if (correspondingToolCallEvent) {
            // Create a synthetic assistant message with the missing tool call
            const toolCallData = correspondingToolCallEvent.data as ToolCall;
            const syntheticAssistantMessage: ProviderMessage = {
              role: 'assistant',
              content: '', // No text content for synthetic message
              toolCalls: [
                {
                  id: toolCallData.id,
                  name: toolCallData.name,
                  input: toolCallData.arguments,
                },
              ],
            };

            messages.push(syntheticAssistantMessage);

            // Now create the user message with the tool result
            messages.push({
              role: 'user',
              content: '',
              toolResults: [
                {
                  id: toolResult.id || '',
                  content: toolResult.content,
                  isError: toolResult.isError,
                },
              ],
            });
          } else {
            // Truly orphaned tool result - no corresponding tool call found
            // Skip this tool result to prevent API errors - it represents corrupted data
            // This is a graceful degradation that maintains conversation flow
            continue;
          }
        }
      } else if (
        event.type === 'LOCAL_SYSTEM_MESSAGE' ||
        event.type === 'SYSTEM_PROMPT' ||
        event.type === 'USER_SYSTEM_PROMPT' ||
        event.type === 'TOOL_APPROVAL_REQUEST' ||
        event.type === 'TOOL_APPROVAL_RESPONSE'
      ) {
        // Skip UI-only events - they're not sent to model
        continue;
      } else {
        throw new Error(`Unknown event type: ${(event as { type: string }).type}`);
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
      retryMetrics: {
        totalAttempts: 0,
        totalDelayMs: 0,
        successful: true, // Assume success until proven otherwise
      },
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

  // Helper to extract parent thread ID
  private _getParentThreadId(): string {
    // Extract parent thread ID by removing hierarchical suffix
    const dotIndex = this._threadId.indexOf('.');
    return dotIndex > 0 ? this._threadId.substring(0, dotIndex) : this._threadId;
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

  /**
   * Replay all historical events from current thread for session resumption
   * Used during --continue and session resumption
   */
  replaySessionEvents(): void {
    const events = this._threadManager.getEvents(this._threadId);

    logger.debug('Agent: Replaying session events', {
      threadId: this._threadId,
      eventCount: events.length,
    });

    // Emit each historical event for UI rebuilding
    for (const event of events) {
      this.emit('thread_event_added', { event, threadId: event.threadId });
    }

    logger.debug('Agent: Session replay complete', {
      threadId: this._threadId,
      eventsReplayed: events.length,
    });
  }

  // Thread management API - proxies to ThreadManager

  getThreadEvents(threadId?: string): ThreadEvent[] {
    const targetThreadId = threadId || this._threadId;
    return this._threadManager.getEvents(targetThreadId);
  }

  generateThreadId(): string {
    return this._threadManager.generateThreadId();
  }

  createThread(threadId: string): void {
    this._threadManager.createThread(threadId);
  }

  updateThreadMetadata(metadata: Record<string, unknown>): void {
    const thread = this._threadManager.getThread(this._threadId);
    if (thread) {
      thread.metadata = { ...thread.metadata, ...metadata };
      // Update timestamp
      thread.updatedAt = new Date();
      // Save through ThreadManager
      this._threadManager.saveThread(thread);
    }
  }

  getThreadMetadata(): Record<string, unknown> | undefined {
    const thread = this._threadManager.getThread(this._threadId);
    return thread?.metadata;
  }

  getThreadCreatedAt(): Date | undefined {
    const thread = this._threadManager.getThread(this._threadId);
    return thread?.createdAt;
  }

  resumeOrCreateThread(threadId?: string): ThreadSessionInfo {
    const result = this._threadManager.resumeOrCreate(threadId);

    // If resuming existing thread, replay events for UI
    if (result.isResumed) {
      this.replaySessionEvents();
    }

    return result;
  }

  getLatestThreadId(): string | null {
    return this._threadManager.getLatestThreadId();
  }

  getMainAndDelegateEvents(mainThreadId: string): ThreadEvent[] {
    return this._threadManager.getMainAndDelegateEvents(mainThreadId);
  }

  async compact(threadId: string): Promise<void> {
    // TODO: Use a configurable strategy once registry is set up
    await this._threadManager.compact(threadId, 'trim-tool-results');
  }

  createDelegateAgent(
    toolExecutor: ToolExecutor,
    provider?: AIProvider,
    tokenBudget?: TokenBudgetConfig
  ): Agent {
    // Use this agent's thread ID as parent (not ThreadManager's current thread)
    const parentThreadId = this._threadId;
    if (!parentThreadId) {
      throw new Error('No active thread for delegation');
    }

    // Create delegate thread
    const delegateThread = this._threadManager.createDelegateThreadFor(parentThreadId);
    const delegateThreadId = delegateThread.id;

    // Create new Agent instance for the delegate thread
    const delegateAgent = new Agent({
      provider: provider || this._provider, // Use provided provider or fallback to parent's provider
      toolExecutor,
      threadManager: this._threadManager,
      threadId: delegateThreadId,
      tools: toolExecutor.getAllTools(),
      tokenBudget,
    });

    return delegateAgent;
  }

  /**
   * Add a system message to the current thread
   * Used for error messages, notifications, etc.
   */
  addSystemMessage(message: string, threadId?: string): ThreadEvent {
    const targetThreadId = threadId || this._threadId;
    if (!targetThreadId) {
      throw new Error('No active thread available for system message');
    }
    return this._addEventAndEmit(targetThreadId, 'LOCAL_SYSTEM_MESSAGE', message);
  }

  /**
   * Helper method to add event to ThreadManager and emit Agent event
   * This ensures Agent is the single event source for UI updates
   */
  private _addEventAndEmit(
    threadId: string,
    type: string,
    data: string | ToolCall | ToolResult
  ): ThreadEvent {
    const event = this._threadManager.addEvent(threadId, type as EventType, data);
    this.emit('thread_event_added', { event, threadId });
    return event;
  }

  // Message queue methods
  queueMessage(
    content: string,
    type: QueuedMessage['type'] = 'user',
    metadata?: QueuedMessage['metadata']
  ): string {
    const id = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const message: QueuedMessage = {
      id,
      type,
      content,
      timestamp: new Date(),
      metadata,
    };

    // High priority messages go to the front
    if (metadata?.priority === 'high') {
      this._messageQueue.unshift(message);
    } else {
      this._messageQueue.push(message);
    }

    return id;
  }

  getQueueStats(): MessageQueueStats {
    const queueLength = this._messageQueue.length;
    const highPriorityCount = this._messageQueue.filter(
      (msg) => msg.metadata?.priority === 'high'
    ).length;

    let oldestMessageAge: number | undefined;
    if (queueLength > 0) {
      const oldestMessage = this._messageQueue[this._messageQueue.length - 1];
      oldestMessageAge = Math.max(0, Date.now() - oldestMessage.timestamp.getTime());
    }

    return {
      queueLength,
      oldestMessageAge,
      highPriorityCount,
    };
  }

  getQueueContents(): readonly QueuedMessage[] {
    return [...this._messageQueue];
  }

  clearQueue(filter?: (msg: QueuedMessage) => boolean): number {
    if (!filter) {
      const clearedCount = this._messageQueue.length;
      this._messageQueue = [];
      return clearedCount;
    }

    const originalLength = this._messageQueue.length;
    this._messageQueue = this._messageQueue.filter((msg) => !filter(msg));
    return originalLength - this._messageQueue.length;
  }

  async processQueuedMessages(): Promise<void> {
    if (this._isProcessingQueue || this._messageQueue.length === 0) {
      return;
    }

    this._isProcessingQueue = true;
    this.emit('queue_processing_start');

    try {
      while (this._messageQueue.length > 0) {
        const message = this._messageQueue.shift()!;

        try {
          await this._processMessage(message.content);
        } catch (error) {
          logger.warn('AGENT: Failed to process queued message', {
            messageId: message.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      this._isProcessingQueue = false;
      this.emit('queue_processing_complete');
    }
  }

  private _getWorkingDirectory(): string | undefined {
    logger.debug('Agent._getWorkingDirectory() called', {
      threadId: this._threadId,
      agentState: this.getCurrentState(),
    });

    try {
      // Get the current thread to find its session and project
      const thread = this._threadManager.getThread(this._threadId);
      logger.debug('Agent._getWorkingDirectory() - got thread', {
        threadId: this._threadId,
        hasThread: !!thread,
        threadSessionId: thread?.sessionId,
        threadProjectId: thread?.projectId,
        threadMetadata: thread?.metadata,
      });

      if (!thread) {
        logger.warn('Agent._getWorkingDirectory() - no thread found, returning undefined', {
          threadId: this._threadId,
        });
        return undefined;
      }

      // If thread has a sessionId, get the session to find the project
      if (thread.sessionId) {
        logger.debug('Agent._getWorkingDirectory() - thread has sessionId, looking up session', {
          threadId: this._threadId,
          sessionId: thread.sessionId,
        });

        const session = Session.getSession(thread.sessionId);
        logger.debug('Agent._getWorkingDirectory() - got session from sessionId', {
          threadId: this._threadId,
          sessionId: thread.sessionId,
          hasSession: !!session,
          sessionProjectId: session?.projectId,
        });

        if (session?.projectId) {
          logger.debug('Agent._getWorkingDirectory() - session has projectId, looking up project', {
            threadId: this._threadId,
            sessionId: thread.sessionId,
            projectId: session.projectId,
          });

          const project = Project.getById(session.projectId);
          const workingDir = project?.getWorkingDirectory();
          logger.debug(
            'Agent._getWorkingDirectory() - got project and working directory from session path',
            {
              threadId: this._threadId,
              sessionId: thread.sessionId,
              projectId: session.projectId,
              hasProject: !!project,
              workingDirectory: workingDir,
              processCwd: process.cwd(),
            }
          );

          return workingDir;
        }
      }

      // If thread has a direct projectId, use that
      if (thread.projectId) {
        logger.debug(
          'Agent._getWorkingDirectory() - thread has direct projectId, looking up project',
          {
            threadId: this._threadId,
            projectId: thread.projectId,
          }
        );

        const project = Project.getById(thread.projectId);
        const workingDir = project?.getWorkingDirectory();
        logger.debug(
          'Agent._getWorkingDirectory() - got project and working directory from direct thread path',
          {
            threadId: this._threadId,
            projectId: thread.projectId,
            hasProject: !!project,
            workingDirectory: workingDir,
            processCwd: process.cwd(),
          }
        );

        return workingDir;
      }

      // Fallback to current working directory
      logger.debug(
        'Agent._getWorkingDirectory() - no session or project found, falling back to process.cwd()',
        {
          threadId: this._threadId,
          processCwd: process.cwd(),
        }
      );
      return process.cwd();
    } catch (error) {
      logger.warn('Failed to get working directory from session/project', {
        threadId: this._threadId,
        error: error instanceof Error ? error.message : String(error),
        processCwd: process.cwd(),
      });
      return process.cwd();
    }
  }

  private _getSession(): { getWorkingDirectory(): string } | undefined {
    try {
      const thread = this._threadManager.getThread(this._threadId);
      if (!thread?.sessionId) {
        return undefined;
      }

      const sessionData = Session.getSession(thread.sessionId);
      if (!sessionData) {
        return undefined;
      }

      // Create a session-like object with getWorkingDirectory method
      return {
        getWorkingDirectory: () => {
          if (sessionData.configuration?.workingDirectory) {
            return sessionData.configuration.workingDirectory as string;
          }

          if (sessionData.projectId) {
            const project = Project.getById(sessionData.projectId);
            if (project) {
              return project.getWorkingDirectory();
            }
          }

          return process.cwd();
        },
      };
    } catch (error) {
      logger.debug('Failed to get session for prompt generation', {
        threadId: this._threadId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private _getProject(): { getWorkingDirectory(): string } | undefined {
    try {
      const thread = this._threadManager.getThread(this._threadId);

      // First try to get project through session
      if (thread?.sessionId) {
        const sessionData = Session.getSession(thread.sessionId);
        if (sessionData?.projectId) {
          const project = Project.getById(sessionData.projectId);
          return project || undefined;
        }
      }

      // Then try direct project association
      if (thread?.projectId) {
        const project = Project.getById(thread.projectId);
        return project || undefined;
      }

      return undefined;
    } catch (error) {
      logger.debug('Failed to get project for prompt generation', {
        threadId: this._threadId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  // ===============================
  // Configuration management methods
  // ===============================

  /**
   * Get agent-specific configuration
   */
  getConfiguration(): AgentConfiguration {
    return { ...this._configuration };
  }

  /**
   * Get effective configuration (merged with session and project)
   */
  getEffectiveConfiguration(): AgentConfiguration {
    try {
      // Get thread to find session and project
      const thread = this._threadManager.getThread(this._threadId);
      if (!thread) return { ...this._configuration };

      let sessionConfig: AgentConfiguration = {};
      let projectConfig: AgentConfiguration = {};

      // Get session configuration if thread has a sessionId or parentSessionId
      let sessionId = thread.sessionId;
      if (!sessionId) {
        // Check thread metadata for parentSessionId (for delegate agents)
        const metadata = this._threadManager.getThread(this._threadId)?.metadata;
        if (metadata && metadata.parentSessionId) {
          sessionId = metadata.parentSessionId as string;
        }
      }

      if (sessionId) {
        const sessionData = Session.getSession(sessionId);
        if (sessionData) {
          sessionConfig = (sessionData.configuration as AgentConfiguration) || {};

          // Get project configuration if session has a projectId
          if (sessionData.projectId) {
            const project = Project.getById(sessionData.projectId);
            if (project) {
              projectConfig = (project.getConfiguration() as AgentConfiguration) || {};
            }
          }
        }
      }

      // If thread has a direct projectId, use that
      if (thread.projectId) {
        const project = Project.getById(thread.projectId);
        if (project) {
          projectConfig = (project.getConfiguration() as AgentConfiguration) || {};
        }
      }

      // Merge configurations: project < session < agent
      const merged = { ...projectConfig, ...sessionConfig, ...this._configuration };

      // Special handling for nested objects
      if (
        projectConfig.toolPolicies ||
        sessionConfig.toolPolicies ||
        this._configuration.toolPolicies
      ) {
        merged.toolPolicies = {
          ...projectConfig.toolPolicies,
          ...sessionConfig.toolPolicies,
          ...this._configuration.toolPolicies,
        };
      }

      if (
        projectConfig.environmentVariables ||
        sessionConfig.environmentVariables ||
        this._configuration.environmentVariables
      ) {
        merged.environmentVariables = {
          ...projectConfig.environmentVariables,
          ...sessionConfig.environmentVariables,
          ...this._configuration.environmentVariables,
        };
      }

      return merged;
    } catch (error) {
      logger.warn('Failed to get effective configuration', {
        threadId: this._threadId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { ...this._configuration };
    }
  }

  /**
   * Update agent configuration
   */
  updateConfiguration(updates: Partial<AgentConfiguration>): void {
    // Validate configuration
    const validatedConfig = ConfigurationValidator.validateAgentConfiguration(updates);

    // Merge with existing configuration
    this._configuration = { ...this._configuration, ...validatedConfig };

    // Special handling for nested objects
    if (updates.toolPolicies) {
      this._configuration.toolPolicies = {
        ...this._configuration.toolPolicies,
        ...updates.toolPolicies,
      };
    }

    if (updates.environmentVariables) {
      this._configuration.environmentVariables = {
        ...this._configuration.environmentVariables,
        ...updates.environmentVariables,
      };
    }

    logger.debug('Agent configuration updated', {
      threadId: this._threadId,
      updates: Object.keys(updates),
    });
  }
}
