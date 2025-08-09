// ABOUTME: Enhanced Agent class for event-driven conversation processing and tool execution
// ABOUTME: Core conversation engine that emits events instead of direct I/O for multiple interface support

import { EventEmitter } from 'events';
import { AIProvider, ProviderMessage, ProviderToolCall } from '~/providers/base-provider';
import { ToolCall, ToolResult } from '~/tools/types';
import { Tool } from '~/tools/tool';
import { ToolExecutor } from '~/tools/executor';
import { ApprovalDecision, ToolPolicy } from '~/tools/approval-types';
import { ThreadManager, ThreadSessionInfo } from '~/threads/thread-manager';
import {
  ThreadEvent,
  ThreadEventType,
  ToolApprovalResponseData,
  ToolApprovalRequestData,
  ThreadId,
  asThreadId,
  AgentMessageData,
} from '~/threads/types';
import { logger } from '~/utils/logger';
import { StopReasonHandler } from '~/token-management/stop-reason-handler';
import { TokenBudgetManager } from '~/token-management/token-budget-manager';
import { TokenBudgetConfig, BudgetStatus, BudgetRecommendations } from '~/token-management/types';
import { loadPromptConfig } from '~/config/prompts';
import { estimateTokens } from '~/utils/token-estimation';
import { QueuedMessage, MessageQueueStats } from '~/agents/types';
import { Project } from '~/projects/project';
import { Session } from '~/sessions/session';
import { AgentConfiguration, ConfigurationValidator } from '~/sessions/session-config';
import type { CompactionData } from '~/threads/compaction/types';

export interface AgentConfig {
  provider: AIProvider;
  toolExecutor: ToolExecutor;
  threadManager: ThreadManager;
  threadId: string;
  tools: Tool[];
  tokenBudget?: TokenBudgetConfig;
  metadata?: {
    name: string;
    modelId: string;
    providerInstanceId: string;
  };
}

interface AgentMessageResult {
  content: string;
  toolCalls: ProviderToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export type AgentState = 'idle' | 'thinking' | 'tool_execution' | 'streaming';

export interface AgentInfo {
  threadId: ThreadId;
  name: string;
  providerInstanceId: string;
  modelId: string;
  status: AgentState;
}

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
  compaction_start: [{ auto: boolean }];
  compaction_complete: [{ success: boolean }];
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
  get threadId(): ThreadId {
    return asThreadId(this._threadId);
  }

  // Public access to token budget manager for testing
  get tokenBudgetManager(): TokenBudgetManager | null {
    return this._tokenBudgetManager;
  }

  // Public access to thread manager for approval system
  get threadManager(): ThreadManager {
    return this._threadManager;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }
  private readonly _stopReasonHandler: StopReasonHandler;
  private _tokenBudgetManager: TokenBudgetManager | null;
  private _state: AgentState = 'idle';
  private _isRunning = false;
  private _currentTurnMetrics: CurrentTurnMetrics | null = null;
  private _progressTimer: number | null = null;
  private _abortController: AbortController | null = null;
  private _lastStreamingTokenCount = 0; // Track last cumulative token count from streaming
  private _messageQueue: QueuedMessage[] = [];
  private _isProcessingQueue = false;
  private _configuration: AgentConfiguration = {};

  // Simple tool batch tracking
  private _pendingToolCount = 0;
  private _hasRejectionsInBatch = false;

  // Auto-compaction configuration
  private _autoCompactConfig = {
    enabled: true,
    threshold: 0.8, // Compact at 80% of limit
    cooldownMs: 60000, // Don't compact again for 1 minute
    lastCompactionTime: 0,
  };

  constructor(config: AgentConfig) {
    super();
    this._provider = config.provider;
    this._toolExecutor = config.toolExecutor;
    this._threadManager = config.threadManager;
    this._threadId = config.threadId;
    this._tools = config.tools;
    this._stopReasonHandler = new StopReasonHandler();

    // Initialize token budget manager based on config or auto-detect from model
    if (config.tokenBudget) {
      // Use provided token budget config
      this._tokenBudgetManager = new TokenBudgetManager(config.tokenBudget);
    } else {
      // Will be initialized lazily when we know the model
      this._tokenBudgetManager = null;
    }

    // Set metadata if provided
    if (config.metadata) {
      this.updateThreadMetadata(config.metadata);
    }

    // Listen for tool approval responses
    this.on('thread_event_added', ({ event }) => {
      if (event && event.type === 'TOOL_APPROVAL_RESPONSE') {
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

    // Check for slash commands
    if (content.startsWith('/compact')) {
      await this._handleCompactCommand();
      return;
    }

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

    // Initialize token budget if not already done
    this._initializeTokenBudget();

    logger.info('AGENT: Started', {
      threadId: this._threadId,
      provider: this._provider.providerName,
    });
  }

  stop(): void {
    this._isRunning = false;
    this._clearProgressTimer();

    // Abort any in-progress processing
    if (this._abortController) {
      this.abort();
    }

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
    // Always use the provider that was passed to the constructor
    // The Session class is responsible for creating agents with the correct provider
    // based on their metadata when reconstructing from persistence
    return this._provider;
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
    return (metadata?.modelId as string) || 'unknown-model';
  }

  /**
   * Initialize token budget manager based on the model's context window
   */
  private _initializeTokenBudget(): void {
    // Skip if already initialized or explicitly disabled
    if (this._tokenBudgetManager) return;

    const modelId = this.model;
    if (!modelId || modelId === 'unknown-model') {
      logger.debug('Cannot initialize token budget: model not specified');
      return;
    }

    // Get model info from provider
    const models = this._provider.getAvailableModels();
    const modelInfo = models.find((m) => m.id === modelId);

    if (!modelInfo) {
      logger.debug('Cannot initialize token budget: model info not found', { modelId });
      return;
    }

    // Create token budget config based on model's context window
    const tokenBudget = {
      maxTokens: modelInfo.contextWindow,
      reserveTokens: Math.min(2000, Math.floor(modelInfo.contextWindow * 0.05)), // Reserve 5% or 2000 tokens
      warningThreshold: 0.8, // Warn at 80% usage
    };

    logger.info('Initializing token budget from model info', {
      modelId,
      contextWindow: modelInfo.contextWindow,
      maxTokens: tokenBudget.maxTokens,
      reserveTokens: tokenBudget.reserveTokens,
    });

    this._tokenBudgetManager = new TokenBudgetManager(tokenBudget);
  }

  get status(): AgentState {
    return this._state;
  }

  getInfo(): AgentInfo {
    const metadata = this.getThreadMetadata();
    return {
      threadId: asThreadId(this._threadId),
      name: this.name,
      providerInstanceId: (metadata?.providerInstanceId as string) || 'unknown',
      modelId: (metadata?.modelId as string) || 'unknown',
      status: this.status,
    };
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

      // Debug logging for provider configuration
      const metadata = this.getThreadMetadata();
      const modelId = metadata?.modelId as string;

      logger.info('🎯 AGENT PROVIDER CALL', {
        threadId: this._threadId,
        agentName: (metadata?.name as string) || 'unknown',
        providerName: this.providerInstance.providerName,
        modelId,
        metadataProvider: metadata?.provider as string,
        metadataModelId: metadata?.modelId as string,
        metadataProviderInstanceId: metadata?.providerInstanceId as string,
      });

      // Try provider-specific token counting first, fall back to estimation
      let promptTokens: number;
      const providerCount = await this.providerInstance.countTokens(
        conversation,
        this._tools,
        modelId
      );
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

      // Note: Context window checks are now handled by the provider
      // Since context windows are model-specific, the provider will handle
      // any context window issues when it actually makes the request
      logger.debug('Token count for request', {
        threadId: this._threadId,
        promptTokens,
        model: modelId,
      });

      // Set state and emit thinking start
      this._setState('thinking');
      this.emit('agent_thinking_start');

      // Get agent response with available tools
      let response: AgentMessageResult;

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
        // Store raw content (with thinking blocks) for model context with token usage
        this._addEventAndEmit(this._threadId, 'AGENT_MESSAGE', {
          content: response.content,
          tokenUsage: response.usage
            ? {
                promptTokens: response.usage.promptTokens,
                completionTokens: response.usage.completionTokens,
                totalTokens: response.usage.totalTokens,
              }
            : undefined,
        });

        // Extract clean content for UI display and events
        const cleanedContent = response.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

        // Emit thinking complete and response complete
        this.emit('agent_thinking_complete');
        this.emit('agent_response_complete', { content: cleanedContent });
      }

      // Check if auto-compaction is needed after processing response
      await this._checkAutoCompaction();

      // Handle tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        this._executeToolCalls(response.toolCalls);
        // Tools will execute asynchronously and auto-continue or wait for user input
        // Turn tracking and state management handled by tool batch completion
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
  ): Promise<AgentMessageResult> {
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
  ): Promise<AgentMessageResult> {
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
      // Don't re-emit AbortErrors from streaming - they're already handled by main catch block
      if (error.name !== 'AbortError') {
        this.emit('error', {
          error,
          context: { phase: 'streaming_response', threadId: this._threadId },
        });
      }
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
      // Get model from thread metadata
      const metadata = this.getThreadMetadata();
      const modelId = metadata?.modelId as string;
      if (!modelId) {
        throw new Error('No model configured for agent');
      }

      const response = await this.providerInstance.createStreamingResponse(
        messages,
        tools,
        modelId,
        signal
      );

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
        usage: processedResponse.usage,
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
  ): Promise<AgentMessageResult> {
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
      // Get model from thread metadata
      const metadata = this.getThreadMetadata();
      const modelId = metadata?.modelId as string;
      if (!modelId) {
        throw new Error('No model configured for agent');
      }

      const response = await this.providerInstance.createResponse(messages, tools, modelId, signal);

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
        usage: processedResponse.usage,
      };
    } finally {
      // Clean up retry event listeners
      this.providerInstance.removeListener('retry_attempt', retryAttemptListener);
      this.providerInstance.removeListener('retry_exhausted', retryExhaustedListener);
    }
  }

  private _executeToolCalls(toolCalls: ProviderToolCall[]): void {
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

    // Agent stays in tool_execution state until all tools complete
    // _handleBatchComplete() will set state to idle when _pendingToolCount reaches 0
  }

  /**
   * Handle TOOL_APPROVAL_RESPONSE events by executing the approved tool
   */
  private _handleToolApprovalResponse(event: ThreadEvent): void {
    if (event.type !== 'TOOL_APPROVAL_RESPONSE') return;

    const responseData = event.data;
    const { toolCallId, decision } = responseData;

    // Defense-in-depth: Check if tool has already been executed (duplicate prevention)
    const events = this._threadManager.getEvents(this._threadId);
    const existingResult = events.find((e) => e.type === 'TOOL_RESULT' && e.data.id === toolCallId);

    if (existingResult) {
      logger.warn('AGENT: Prevented duplicate tool execution', {
        threadId: this._threadId,
        toolCallId,
        reason: 'TOOL_RESULT already exists',
      });
      return; // Early exit - don't execute again
    }

    // Find the corresponding TOOL_CALL event
    const toolCallEvent = events.find((e) => e.type === 'TOOL_CALL' && e.data.id === toolCallId);

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
      this._hasRejectionsInBatch = true;
    } else if (decision === ApprovalDecision.ALLOW_SESSION) {
      // Update session tool policy for session-wide approval
      void this._updateSessionToolPolicy(toolCall.name, 'allow');

      // Execute the approved tool
      void this._executeApprovedTool(toolCall);
      return; // Early return to avoid double decrementing
    } else {
      // allow_once - just execute the tool
      void this._executeApprovedTool(toolCall);
      return; // Early return to avoid double decrementing
    }

    // Handle denied tool completion
    this._pendingToolCount--;
    if (this._pendingToolCount === 0) {
      this._handleBatchComplete();
    }
  }

  /**
   * Execute a single tool call without blocking
   */
  private async _executeSingleTool(toolCall: ToolCall): Promise<void> {
    try {
      const workingDirectory = this._getWorkingDirectory();

      // Get session for security policy enforcement
      const session = await this.getFullSession();
      if (!session) {
        throw new Error(
          `Tool execution denied: no session context available for thread ${this._threadId}`
        );
      }

      const toolContext = {
        threadId: asThreadId(this._threadId),
        parentThreadId: asThreadId(this._getParentThreadId()),
        workingDirectory,
        session, // REQUIRED for security policy enforcement
      };

      // First: Check permission
      const permission = await this._toolExecutor.requestToolPermission(toolCall, toolContext);

      if (permission === 'granted') {
        // Execute immediately if allowed
        const result = await this._toolExecutor.executeTool(toolCall, toolContext);

        // Only add events if thread still exists
        if (this._threadManager.getThread(this._threadId)) {
          // Add result and update tracking
          this._addEventAndEmit(this._threadId, 'TOOL_RESULT', result);
          this.emit('tool_call_complete', {
            toolName: toolCall.name,
            result,
            callId: toolCall.id,
          });

          // Update batch tracking
          this._pendingToolCount--;
          // Note: Tool execution errors should NOT set _hasRejectionsInBatch
          // Only user denials should pause conversation - tool failures should continue

          if (this._pendingToolCount === 0) {
            this._handleBatchComplete();
          }
        }
      } else {
        // Permission pending - approval request was created
        // Don't decrement pending count yet - wait for approval response
        return;
      }
    } catch (error: unknown) {
      // Handle permission/execution errors
      logger.error('AGENT: Tool execution failed', {
        threadId: this._threadId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        error: error instanceof Error ? error.message : String(error),
      });

      // Only handle error if thread still exists
      if (this._threadManager.getThread(this._threadId)) {
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

        // Update batch tracking for errors
        this._pendingToolCount--;
        // Note: Tool execution errors should NOT set _hasRejectionsInBatch
        // Only user denials should pause conversation - tool failures should continue

        if (this._pendingToolCount === 0) {
          this._handleBatchComplete();
        }
      }
    }
  }

  private async _executeApprovedTool(toolCall: ToolCall): Promise<void> {
    try {
      const workingDirectory = this._getWorkingDirectory();

      // Get session for security policy enforcement
      const session = await this.getFullSession();
      if (!session) {
        throw new Error(
          `Tool execution denied: no session context available for thread ${this._threadId}`
        );
      }

      const toolContext = {
        threadId: asThreadId(this._threadId),
        parentThreadId: asThreadId(this._getParentThreadId()),
        workingDirectory,
        session, // REQUIRED for security policy enforcement
      };

      // Find the tool and execute directly (permission already granted via approval)
      const tool = this._toolExecutor.getTool(toolCall.name);
      if (!tool) {
        throw new Error(`Tool '${toolCall.name}' not found`);
      }

      const result = await tool.execute(toolCall.arguments, toolContext);

      // Ensure the result has the call ID if it wasn't set by the tool
      if (!result.id && toolCall.id) {
        result.id = toolCall.id;
      }

      // Only add events if thread still exists
      if (this._threadManager.getThread(this._threadId)) {
        // Add result and update tracking
        this._addEventAndEmit(this._threadId, 'TOOL_RESULT', result);
        this.emit('tool_call_complete', {
          toolName: toolCall.name,
          result,
          callId: toolCall.id,
        });

        // Update batch tracking
        this._pendingToolCount--;
        // Note: Tool execution errors should NOT set _hasRejectionsInBatch
        // Only user denials should pause conversation - tool failures should continue

        if (this._pendingToolCount === 0) {
          this._handleBatchComplete();
        }
      }
    } catch (error: unknown) {
      // Handle execution errors
      logger.error('AGENT: Approved tool execution failed', {
        threadId: this._threadId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        error: error instanceof Error ? error.message : String(error),
      });

      // Only handle error if thread still exists
      if (this._threadManager.getThread(this._threadId)) {
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

        // Update batch tracking for errors
        this._pendingToolCount--;
        // Note: Tool execution errors should NOT set _hasRejectionsInBatch
        // Only user denials should pause conversation - tool failures should continue

        if (this._pendingToolCount === 0) {
          this._handleBatchComplete();
        }
      }
    }
  }

  private _handleBatchComplete(): void {
    if (this._hasRejectionsInBatch) {
      // Has rejections - wait for user input
      this._setState('idle');
      // Don't auto-continue conversation
    } else {
      // All approved - auto-continue conversation
      this._completeTurn();
      this._setState('idle');

      // Emit conversation complete after successful tool batch completion
      this.emit('conversation_complete');

      // Only continue conversation if agent is still running and thread exists
      if (this._isRunning && this._threadManager.getThread(this._threadId)) {
        void this._processConversation();
      }
    }

    // Conversation completion handled by event emission, not promises
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
          content: event.data,
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
            const eventToolCall = nextEvent.data;
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
          content: event.data.content,
        };

        if (toolCallsForThisMessage.length > 0) {
          message.toolCalls = toolCallsForThisMessage;
        }

        messages.push(message);
      } else if (event.type === 'TOOL_CALL') {
        // If we reach here, it's an orphaned tool call (no preceding AGENT_MESSAGE)
        const toolCall = event.data;

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
        const toolResult = event.data;

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
            (e) => e.type === 'TOOL_CALL' && e.data.id === toolResult.id
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

  private async _checkAutoCompaction(): Promise<void> {
    if (!this._autoCompactConfig.enabled) return;

    // Check cooldown
    const now = Date.now();
    if (now - this._autoCompactConfig.lastCompactionTime < this._autoCompactConfig.cooldownMs) {
      return;
    }

    // Check if we should compact based on token budget
    if (this._tokenBudgetManager) {
      const recommendations = this._tokenBudgetManager.getRecommendations();
      if (recommendations.shouldPrune) {
        logger.info('Auto-compacting due to token limit approaching', {
          threadId: this._threadId,
        });

        try {
          // Emit compaction event
          this.emit('compaction_start', { auto: true });

          await this.compact(this._threadId);
          this._autoCompactConfig.lastCompactionTime = now;

          // Reset token budget after compaction
          this._tokenBudgetManager.reset();

          // Emit compaction complete event
          this.emit('compaction_complete', { success: true });
        } catch (error) {
          logger.error('Auto-compaction failed', {
            threadId: this._threadId,
            error: error instanceof Error ? error.message : String(error),
          });
          // Emit thinking complete even on failure
          this.emit('agent_thinking_complete');
          // Don't throw - continue conversation even if compaction fails
        }
      }
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

  generateThreadId(): ThreadId {
    return asThreadId(this._threadManager.generateThreadId());
  }

  createThread(threadId: string): void {
    this._threadManager.createThread(threadId);
  }

  updateThreadMetadata(metadata: Record<string, unknown>): void {
    const thread = this._threadManager.getThread(this._threadId);
    if (thread) {
      // Initialize metadata if it doesn't exist
      thread.metadata = { ...(thread.metadata || {}), ...metadata };
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

  private async _handleCompactCommand(): Promise<void> {
    this.emit('compaction_start', { auto: false });

    try {
      // Use the AI-powered summarization strategy
      await this.compact(this._threadId);

      // Add a system message about compaction
      this._threadManager.addEvent(
        this._threadId,
        'LOCAL_SYSTEM_MESSAGE',
        '✅ Conversation compacted successfully'
      );

      this.emit('compaction_complete', { success: true });
    } catch (error) {
      this.emit('compaction_complete', { success: false });
      this.emit('error', {
        error: error instanceof Error ? error : new Error('Compaction failed'),
        context: { operation: 'compact', threadId: this._threadId },
      });
    }
  }

  async compact(threadId: string): Promise<void> {
    // Use the AI-powered summarization strategy for better compaction
    await this._threadManager.compact(threadId, 'summarize', {
      agent: this,
    });
  }

  /**
   * Generate a summary using the current conversation context
   * Used by compaction strategies to leverage the agent's full context
   */
  async generateSummary(promptContent: string, events: ThreadEvent[]): Promise<string> {
    // Build conversation messages from the provided events
    const messages = this._buildConversationFromEvents(events);

    // Add the summarization prompt
    messages.push({
      role: 'user',
      content: promptContent,
    });

    // Get the summary using this agent's provider and model
    const response = await this._provider.createResponse(
      messages,
      [], // No tools for summarization
      this.model || 'default'
    );

    return response.content;
  }

  /**
   * Add a system message to the current thread
   * Used for error messages, notifications, etc.
   */
  addSystemMessage(message: string, threadId?: string): ThreadEvent | null {
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
    data:
      | string
      | AgentMessageData
      | ToolCall
      | ToolResult
      | CompactionData
      | ToolApprovalRequestData
      | ToolApprovalResponseData
  ): ThreadEvent | null {
    // Safety check: only add events if thread exists
    if (!this._threadManager.getThread(threadId)) {
      logger.warn('AGENT: Skipping event addition - thread not found', {
        threadId,
        type,
      });
      return null;
    }

    const event = this._threadManager.addEvent(threadId, type as ThreadEventType, data);
    if (event) {
      this.emit('thread_event_added', { event, threadId });
    }
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

  /**
   * Handle approval response from web API, maintaining architectural boundaries.
   *
   * The web layer should only communicate with the Agent interface, not directly
   * access ThreadManager. This method encapsulates approval response logic with
   * proper error handling for race conditions.
   */
  handleApprovalResponse(toolCallId: string, decision: ApprovalDecision): void {
    // Create approval response event with atomic database transaction
    // The persistence layer handles duplicate detection idempotently
    this._addEventAndEmit(this._threadId, 'TOOL_APPROVAL_RESPONSE', {
      toolCallId,
      decision,
    });
  }

  /**
   * Get pending tool approvals for this agent's thread.
   *
   * Returns tool calls that have approval requests but no responses yet.
   * The web layer should use this instead of directly accessing ThreadManager.
   */
  getPendingApprovals(): Array<{
    toolCallId: string;
    toolCall: unknown;
    requestedAt: Date;
  }> {
    return this._threadManager.getPendingApprovals(this._threadId);
  }

  /**
   * Get a tool call event by its ID.
   *
   * This provides controlled access to thread events for the web layer
   * without exposing ThreadManager directly.
   */
  getToolCallEventById(toolCallId: string): ThreadEvent | undefined {
    const events = this._threadManager.getEvents(this._threadId);
    return events.find((e) => e.type === 'TOOL_CALL' && e.data.id === toolCallId);
  }

  /**
   * Get a tool call event by tool call ID for a specific thread.
   *
   * Used by web layer components that need to look up tool calls
   * without direct ThreadManager access.
   */
  getToolCallEventByIdForThread(toolCallId: string, threadId: string): ThreadEvent | undefined {
    const events = this._threadManager.getEvents(threadId);
    return events.find((e) => e.type === 'TOOL_CALL' && e.data.id === toolCallId);
  }

  /**
   * Check if an approval request already exists for the given tool call ID.
   */
  checkExistingApprovalRequest(toolCallId: string): boolean {
    const events = this._threadManager.getEvents(this._threadId);
    return events.some(
      (e) => e.type === 'TOOL_APPROVAL_REQUEST' && e.data.toolCallId === toolCallId
    );
  }

  /**
   * Check for existing approval response for the given tool call ID.
   */
  checkExistingApprovalResponse(toolCallId: string): ApprovalDecision | null {
    const events = this._threadManager.getEvents(this._threadId);
    const responseEvent = events.find(
      (e) => e.type === 'TOOL_APPROVAL_RESPONSE' && e.data.toolCallId === toolCallId
    );
    return responseEvent ? (responseEvent.data as ToolApprovalResponseData).decision : null;
  }

  /**
   * Add an approval request event for the given tool call ID.
   * Used by EventApprovalCallback to create approval requests.
   */
  addApprovalRequestEvent(toolCallId: string): ThreadEvent {
    const event = this._addEventAndEmit(this._threadId, 'TOOL_APPROVAL_REQUEST', {
      toolCallId: toolCallId,
    });

    if (!event) {
      throw new Error(`Failed to create TOOL_APPROVAL_REQUEST event for toolCallId: ${toolCallId}`);
    }

    return event;
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

  async getFullSession(): Promise<Session | undefined> {
    try {
      const thread = this._threadManager.getThread(this._threadId);
      if (!thread?.sessionId) {
        return undefined;
      }

      return (await Session.getById(asThreadId(thread.sessionId))) || undefined;
    } catch (error) {
      logger.error('Agent.getFullSession() - error getting session', {
        threadId: this._threadId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
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

  /**
   * Update session tool policy for session-wide approvals
   */
  private async _updateSessionToolPolicy(toolName: string, policy: ToolPolicy): Promise<void> {
    try {
      const session = await this.getFullSession();
      if (session) {
        const currentConfig = session.getEffectiveConfiguration();
        const updatedToolPolicies = {
          ...currentConfig.toolPolicies,
          [toolName]: policy,
        };

        session.updateConfiguration({ toolPolicies: updatedToolPolicies });

        logger.debug('Session tool policy updated', {
          threadId: this._threadId,
          toolName,
          policy,
        });
      }
    } catch (error) {
      logger.error('Failed to update session tool policy', {
        threadId: this._threadId,
        toolName,
        policy,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
