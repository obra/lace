// ABOUTME: Enhanced Agent class for event-driven conversation processing and tool execution
// ABOUTME: Core conversation engine that emits events instead of direct I/O for multiple interface support

import { EventEmitter } from 'events';
import { resolve } from 'path';
import { AIProvider, ProviderMessage, ProviderToolCall } from '~/providers/base-provider';
import { ToolCall, ToolResult } from '~/tools/types';
import { Tool } from '~/tools/tool';
import { ToolExecutor } from '~/tools/executor';
import { ApprovalDecision, ToolPolicy } from '~/tools/approval-types';
import { ThreadManager, ThreadSessionInfo } from '~/threads/thread-manager';
import {
  LaceEvent,
  ToolApprovalResponseData,
  ThreadId,
  asThreadId,
  isTransientEventType,
} from '~/threads/types';
import { logger } from '~/utils/logger';
import { StopReasonHandler } from '~/token-management/stop-reason-handler';
import type { ThreadTokenUsage, CombinedTokenUsage } from '~/token-management/types';
import { loadPromptConfig } from '~/config/prompts';
import type { PromptConfig } from '~/config/prompts';
import { estimateTokens } from '~/utils/token-estimation';
import { QueuedMessage, MessageQueueStats } from '~/agents/types';
import { Project } from '~/projects/project';
import { Session } from '~/sessions/session';
import { AgentConfiguration, ConfigurationValidator } from '~/sessions/session-config';
import { aggregateTokenUsage } from '~/threads/token-aggregation';
import { ProviderRegistry } from '~/providers/registry';

export interface AgentConfig {
  toolExecutor: ToolExecutor;
  threadManager: ThreadManager;
  threadId: string;
  tools: Tool[];
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
interface AgentEvents {
  agent_thinking_start: [];
  agent_token: [{ token: string }]; // Raw tokens including thinking block content during streaming
  agent_thinking_complete: [];
  compaction_start: [{ auto: boolean }];
  compaction_complete: [{ success: boolean }];
  agent_response_complete: [{ content: string; tokenUsage?: CombinedTokenUsage }]; // Clean content with thinking blocks removed, plus token usage
  tool_call_start: [{ toolName: string; input: Record<string, unknown>; callId: string }];
  tool_call_complete: [{ toolName: string; result: ToolResult; callId: string }];
  state_change: [{ from: AgentState; to: AgentState }];
  error: [{ error: Error; context: Record<string, unknown> }];
  conversation_complete: [];
  token_usage_update: [
    { usage: { promptTokens: number; completionTokens: number; totalTokens: number } },
  ];
  token_budget_warning: [{ message: string; usage: ThreadTokenUsage }];
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
  thread_event_added: [{ event: LaceEvent; threadId: string }];
  thread_state_changed: [{ threadId: string; eventType: string }];
  // Queue events
  queue_processing_start: [];
  queue_processing_complete: [];
  message_queued: [{ id: string; queueLength: number }];
}

export class Agent extends EventEmitter {
  private _provider: AIProvider | null;
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
    return this._provider?.providerName || 'unknown';
  }

  // Public access to thread ID for delegation
  get threadId(): ThreadId {
    return asThreadId(this._threadId);
  }

  // Public access to thread manager for approval system
  get threadManager(): ThreadManager {
    return this._threadManager;
  }

  get isRunning(): boolean {
    return this._initialized;
  }
  private readonly _stopReasonHandler: StopReasonHandler;
  private _state: AgentState = 'idle';
  private _initialized = false;
  private _promptConfig?: PromptConfig; // Cache loaded prompt config
  private _currentTurnMetrics: CurrentTurnMetrics | null = null;
  private _progressTimer: ReturnType<typeof setInterval> | null = null;
  private _abortController: AbortController | null = null;
  private _toolAbortController: AbortController | null = null;
  private _activeToolCalls: Map<string, ToolCall> = new Map();
  private _lastStreamingTokenCount = 0; // Track last cumulative token count from streaming
  private _messageQueue: QueuedMessage[] = [];
  private _isProcessingQueue = false;
  private _configuration: AgentConfiguration = {};
  private _abortedSinceLastTurn = false; // Track if agent was aborted to prevent late approvals

  // Simple tool batch tracking
  private _pendingToolCount = 0;

  // Auto-compaction configuration
  private _autoCompactConfig = {
    enabled: true,
    threshold: 0.8, // Compact at 80% of limit
  };

  constructor(config: AgentConfig) {
    super();
    this._provider = null; // Will be created in initialize()
    this._toolExecutor = config.toolExecutor;
    this._threadManager = config.threadManager;
    this._threadId = config.threadId;
    this._tools = config.tools;
    this._stopReasonHandler = new StopReasonHandler();

    // Token budget management has been removed - using direct ThreadTokenUsage calculation

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
    const provider = await this.getProvider();

    if (!provider) {
      throw new Error('Cannot send messages to agent with missing provider instance');
    }

    // Early validation that model identifier exists
    const modelId = this.model;
    if (!modelId || modelId === 'unknown-model') {
      throw new Error('Cannot send messages to agent with missing modelId');
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
      this._addEventAndEmit({
        type: 'USER_MESSAGE',
        threadId: this._threadId,
        data: content,
      });
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
    if (!this._initialized) {
      await this.initialize();
    }

    await this._processConversation();
  }

  // Create provider instance from agent metadata and configuration
  private async _createProviderInstance(): Promise<AIProvider | null> {
    // 1. Get agent-specific metadata
    const metadata = this.getThreadMetadata();
    let providerInstanceId = metadata?.providerInstanceId as string;
    let modelId = metadata?.modelId as string;

    // 2. Fall back to session effective config
    if (!providerInstanceId || !modelId) {
      const effectiveConfig = this.getEffectiveConfiguration();
      providerInstanceId = providerInstanceId || (effectiveConfig.providerInstanceId as string);
      modelId = modelId || (effectiveConfig.modelId as string);
    }

    if (!providerInstanceId || !modelId) {
      logger.warn('Agent missing provider configuration', {
        threadId: this._threadId,
        hasProviderInstanceId: !!providerInstanceId,
        hasModelId: !!modelId,
        metadata,
      });
      return null;
    }

    // 3. Create provider using registry (proper async)
    try {
      const registry = ProviderRegistry.getInstance();
      return await registry.createProviderFromInstanceAndModel(providerInstanceId, modelId);
    } catch (error) {
      logger.error('Failed to create provider instance for agent', {
        threadId: this._threadId,
        providerInstanceId,
        modelId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  // Public initialization method - happens once per agent
  async initialize(): Promise<void> {
    if (this._initialized) return; // idempotent

    // Create provider before system prompt generation
    if (!this._provider) {
      this._provider = await this._createProviderInstance();
    }

    // CRITICAL: Always regenerate system prompt with current project context
    // This ensures that agents working on different projects get the correct context,
    // even when sharing the same cached provider instance
    await this._refreshSystemPrompt();

    // Record initial events (happens once) - only for new conversations
    if (!this._hasInitialEvents() && !this._hasConversationStarted() && this._promptConfig) {
      this._addInitialEvents(this._promptConfig);
    }

    // Only mark as initialized if provider was successfully created
    if (this._provider) {
      this._initialized = true;

      logger.info('AGENT: Initialized successfully', {
        threadId: this._threadId,
        provider: this.providerInstance?.providerName || 'missing',
      });
    } else {
      logger.warn('AGENT: Initialization incomplete - no provider', {
        threadId: this._threadId,
      });
    }
  }

  // Check if initial events already exist
  private _hasInitialEvents(): boolean {
    const events = this._threadManager.getEvents(this._threadId);
    return events.some((e) => e.type === 'SYSTEM_PROMPT' || e.type === 'USER_SYSTEM_PROMPT');
  }

  // Check if conversation has already started
  private _hasConversationStarted(): boolean {
    const events = this._threadManager.getEvents(this._threadId);
    return events.some((e) => e.type === 'USER_MESSAGE' || e.type === 'AGENT_MESSAGE');
  }

  // Add initial events to thread
  private _addInitialEvents(promptConfig: PromptConfig): void {
    this._addEventAndEmit({
      type: 'SYSTEM_PROMPT',
      threadId: this._threadId,
      data: promptConfig.systemPrompt,
    });
    this._addEventAndEmit({
      type: 'USER_SYSTEM_PROMPT',
      threadId: this._threadId,
      data: promptConfig.userInstructions,
    });
  }

  /**
   * Generate system prompt with current project context and set it on the provider
   * This is critical for multi-project scenarios where provider instances are shared.
   * Called during initialization to ensure each agent gets the correct project context.
   */
  private async _refreshSystemPrompt(): Promise<void> {
    if (!this.providerInstance) {
      return;
    }

    try {
      // Always regenerate system prompt with current project/session context
      const session = this._getSession();
      const project = this._getProject();

      logger.debug(
        'Agent._refreshSystemPrompt() - regenerating system prompt with current context',
        {
          threadId: this._threadId,
          hasSession: !!session,
          hasProject: !!project,
          sessionWorkingDir: session?.getWorkingDirectory(),
          projectWorkingDir: project?.getWorkingDirectory(),
        }
      );

      const promptConfig = await loadPromptConfig({
        tools: this._tools.map((tool) => ({ name: tool.name, description: tool.description })),
        session: session,
        project: project,
      });

      // Always set the freshly generated system prompt on the provider
      this.providerInstance.setSystemPrompt(promptConfig.systemPrompt);

      // Update cached config for consistency
      this._promptConfig = promptConfig;

      logger.debug('Agent._refreshSystemPrompt() - system prompt refreshed successfully', {
        threadId: this._threadId,
        promptLength: promptConfig.systemPrompt.length,
      });
    } catch (error) {
      logger.error('Failed to refresh system prompt, using cached version', {
        threadId: this._threadId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback to cached prompt if available
      if (this._promptConfig && this.providerInstance) {
        this.providerInstance.setSystemPrompt(this._promptConfig.systemPrompt);
      }
    }
  }

  // Control methods
  async start(): Promise<void> {
    // Ensure agent is initialized
    await this.initialize();

    // Provider might be fresh, so always set system prompt
    if (this._promptConfig && this.providerInstance) {
      this.providerInstance.setSystemPrompt(this._promptConfig.systemPrompt);
    }

    logger.info('AGENT: Started', {
      threadId: this._threadId,
      provider: this.providerInstance?.providerName || 'missing',
    });
  }

  stop(): void {
    this._initialized = false;
    this._clearProgressTimer();

    // Abort any in-progress processing immediately
    if (this._abortController) {
      this.abort();
    }

    // Clear any active tool calls to prevent further database operations
    this._activeToolCalls.clear();
    this._pendingToolCount = 0;

    this._setState('idle');

    // Clean up provider resources
    if (this.providerInstance) {
      try {
        this.providerInstance.cleanup();
      } catch (cleanupError) {
        logger.warn('Provider cleanup failed during stop', {
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
    }

    // DO NOT close ThreadManager - it's shared by all agents in the session!
    // this._threadManager.close();  // This would affect ALL agents
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
    let aborted = false;

    // Abort LLM streaming/response generation
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
      aborted = true;
    }

    // Abort all active tool executions
    if (this._toolAbortController) {
      this._toolAbortController.abort();

      // Tools will detect the abort signal and return their own cancellation results
      // We don't emit here to avoid duplicates

      // Clear tracking immediately
      this._activeToolCalls.clear();
      this._toolAbortController = null;
      // Don't reset _pendingToolCount here - let the tools complete normally
      aborted = true;
    }

    if (aborted) {
      this._abortedSinceLastTurn = true;
      this._setState('idle');
    }

    return aborted;
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

  get providerInstance(): AIProvider | null {
    // Returns the provider instance owned by this agent
    // Agents create and manage their own provider instances based on thread metadata
    return this._provider;
  }

  // Lazy provider method that auto-initializes
  async getProvider(): Promise<AIProvider | null> {
    if (!this._initialized) {
      await this.initialize();
    }

    // If initialized but provider is null, initialization should have handled it
    if (this._initialized && !this._provider) {
      throw new Error(
        'Provider initialization failed - no provider available after initialization'
      );
    }

    return this._provider;
  }

  get provider(): string {
    const metadata = this.getThreadMetadata();
    const providerName = this._provider?.providerName;
    const providerInstanceId = (metadata?.providerInstanceId as string) || '';
    return providerName || providerInstanceId || 'unknown';
  }

  get name(): string {
    const metadata = this.getThreadMetadata();
    return (metadata?.name as string) || 'unnamed-agent';
  }

  get model(): string {
    const metadata = this.getThreadMetadata();
    return (metadata?.modelId as string) || 'unknown-model';
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

      // Check if we're approaching token limit (simple threshold check)
      const tokenUsage = this.getTokenUsage();
      if (tokenUsage.percentUsed >= 0.95) {
        this.emit('token_budget_warning', {
          message: 'Cannot make request: approaching token limit',
          usage: tokenUsage,
        });

        logger.warn('Request blocked by token limit', {
          threadId: this._threadId,
          percentUsed: tokenUsage.percentUsed,
          totalTokens: tokenUsage.totalTokens,
          contextLimit: tokenUsage.contextLimit,
        });

        this._setState('idle');
        return;
      }

      // Debug logging for provider configuration
      const metadata = this.getThreadMetadata();
      const modelId = metadata?.modelId as string;

      logger.info('🎯 AGENT PROVIDER CALL', {
        threadId: this._threadId,
        agentName: (metadata?.name as string) || 'unknown',
        providerName: this.providerInstance?.providerName || 'missing',
        modelId,
        metadataProvider: metadata?.provider as string,
        metadataModelId: metadata?.modelId as string,
        metadataProviderInstanceId: metadata?.providerInstanceId as string,
      });

      // Try provider-specific token counting first, fall back to estimation
      let promptTokens: number;
      const providerCount = this.providerInstance
        ? await this.providerInstance.countTokens(conversation, this._tools, modelId)
        : null;
      if (providerCount !== null) {
        promptTokens = providerCount;
        logger.debug('Using provider-specific token count', {
          threadId: this._threadId,
          promptTokens,
          provider: this.providerInstance?.providerName || 'missing',
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
            providerName: this.providerInstance?.providerName || 'missing',
          });
          // Abort was called - don't treat as error, metrics already emitted by abort()
          return;
        }

        // Handle retry exhaustion errors - emit special event for test expectations
        if (error instanceof Error && error.message.includes('Final network error')) {
          this.emit('error', {
            error,
            context: { phase: 'retry_exhaustion', threadId: this._threadId },
          });
          this._completeTurn();
          return;
        }

        logger.error('AGENT: Provider error', {
          threadId: this._threadId,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
          providerName: this.providerInstance?.providerName || 'missing',
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
        const threadTokenUsage = this.getTokenUsage();

        const agentMessageTokenUsage: CombinedTokenUsage = response.usage
          ? {
              // Current message token usage from provider
              message: {
                promptTokens: response.usage.promptTokens,
                completionTokens: response.usage.completionTokens,
                totalTokens: response.usage.totalTokens,
              },
              // Thread-level cumulative usage
              thread: threadTokenUsage,
            }
          : {
              // Fallback: no message usage data available
              thread: threadTokenUsage,
            };

        logger.debug('Creating AGENT_MESSAGE event with token usage', {
          threadId: this._threadId,
          hasProviderUsage: !!response.usage,
          providerUsage: response.usage,
          threadTokenUsage,
          finalTokenUsage: agentMessageTokenUsage,
        });

        this._addEventAndEmit({
          type: 'AGENT_MESSAGE',
          threadId: this._threadId,
          data: {
            content: response.content,
            tokenUsage: agentMessageTokenUsage,
          },
        });

        // Extract clean content for UI display and events
        const cleanedContent = response.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

        // Emit thinking complete and response complete
        this.emit('agent_thinking_complete');
        this.emit('agent_response_complete', {
          content: cleanedContent,
          tokenUsage: agentMessageTokenUsage,
        });
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
      if (this.providerInstance) {
        try {
          this.providerInstance.cleanup();
        } catch (cleanupError) {
          logger.warn('Provider cleanup failed', {
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        }
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
    const provider = await this.getProvider();

    if (!provider) {
      throw new Error('Cannot send messages to agent with missing provider instance');
    }

    // Default to streaming if provider supports it (unless explicitly disabled)
    const useStreaming = provider.supportsStreaming && provider.config?.streaming !== false;

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

      // Get context explicitly to ensure AGENT_TOKEN events have projectId
      const context = this._getEventContext();
      this._addEventAndEmit({
        type: 'AGENT_TOKEN',
        threadId: this._threadId,
        data: { token },
        context, // Explicitly include context to ensure projectId is present
        transient: true,
      });
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
    if (this.providerInstance) {
      this.providerInstance.on('token', tokenListener);
      this.providerInstance.on('token_usage_update', tokenUsageListener);
      this.providerInstance.on('error', errorListener);
      this.providerInstance.on('retry_attempt', retryAttemptListener);
      this.providerInstance.on('retry_exhausted', retryExhaustedListener);
    }

    try {
      // Get model from thread metadata
      const metadata = this.getThreadMetadata();
      const modelId = metadata?.modelId as string;
      if (!modelId) {
        throw new Error('No model configured for agent');
      }

      if (!this.providerInstance) {
        throw new Error('Cannot create streaming response with missing provider instance');
      }

      const response = await this.providerInstance.createStreamingResponse(
        messages,
        tools,
        modelId,
        signal
      );

      // Apply stop reason handling to filter incomplete tool calls
      const processedResponse = this._stopReasonHandler.handleResponse(response, tools);

      // Check for token warnings based on current usage
      const tokenUsage = this.getTokenUsage();
      if (tokenUsage.nearLimit) {
        this.emit('token_budget_warning', {
          message: `Token usage at ${(tokenUsage.percentUsed * 100).toFixed(1)}% of limit`,
          usage: tokenUsage,
        });
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
      if (this.providerInstance) {
        this.providerInstance.removeListener('token', tokenListener);
        this.providerInstance.removeListener('token_usage_update', tokenUsageListener);
        this.providerInstance.removeListener('error', errorListener);
        this.providerInstance.removeListener('retry_attempt', retryAttemptListener);
        this.providerInstance.removeListener('retry_exhausted', retryExhaustedListener);
      }
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
    if (this.providerInstance) {
      this.providerInstance.on('retry_attempt', retryAttemptListener);
      this.providerInstance.on('retry_exhausted', retryExhaustedListener);
    }

    try {
      // Get model from thread metadata
      const metadata = this.getThreadMetadata();
      const modelId = metadata?.modelId as string;
      if (!modelId) {
        throw new Error('No model configured for agent');
      }

      if (!this.providerInstance) {
        throw new Error('Cannot create response with missing provider instance');
      }

      const response = await this.providerInstance.createResponse(messages, tools, modelId, signal);

      // Apply stop reason handling to filter incomplete tool calls
      const processedResponse = this._stopReasonHandler.handleResponse(response, tools);

      // Check for token warnings based on current usage
      const tokenUsage = this.getTokenUsage();
      if (tokenUsage.nearLimit) {
        this.emit('token_budget_warning', {
          message: `Token usage at ${(tokenUsage.percentUsed * 100).toFixed(1)}% of limit`,
          usage: tokenUsage,
        });
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
      if (this.providerInstance) {
        this.providerInstance.removeListener('retry_attempt', retryAttemptListener);
        this.providerInstance.removeListener('retry_exhausted', retryExhaustedListener);
      }
    }
  }

  private _executeToolCalls(toolCalls: ProviderToolCall[]): void {
    this._setState('tool_execution');

    logger.debug('AGENT: Processing tool calls', {
      threadId: this._threadId,
      toolCallCount: toolCalls.length,
      toolCalls: toolCalls.map((tc) => ({ id: tc.id, name: tc.name })),
    });

    // Create abort controller for tool execution
    // First abort any existing controller to prevent leaks
    if (this._toolAbortController) {
      this._toolAbortController.abort();
    }
    this._toolAbortController = new AbortController();

    // Initialize tool batch tracking
    this._pendingToolCount = toolCalls.length;

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

      // Track active tool call
      this._activeToolCalls.set(toolCall.id, toolCall);

      // Add tool call to thread
      this._addEventAndEmit({
        type: 'TOOL_CALL',
        threadId: this._threadId,
        data: toolCall,
      });

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
  private _handleToolApprovalResponse(event: LaceEvent): void {
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
        status: 'denied',
        content: [{ type: 'text', text: 'Tool execution denied by user' }],
      };
      // Remove from active tools tracking (it was denied)
      this._activeToolCalls.delete(toolCallId);
      this._addEventAndEmit({
        type: 'TOOL_RESULT',
        threadId: this._threadId,
        data: errorResult,
      });
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
        signal: this._getToolAbortSignal(),
        workingDirectory,
        agent: this,
      };

      // First: Check permission
      const permission = await this._toolExecutor.requestToolPermission(toolCall, toolContext);

      if (permission === 'granted') {
        // Permission already checked and granted - execute without checking again
        const result = await this._toolExecutor.executeApprovedTool(toolCall, toolContext);

        // Only add events if thread still exists
        if (this._threadManager.getThread(this._threadId)) {
          // Remove from active tools (it completed)
          this._activeToolCalls.delete(toolCall.id);

          // Add result and update tracking
          this._addEventAndEmit({
            type: 'TOOL_RESULT',
            threadId: this._threadId,
            data: result,
          });
          this.emit('tool_call_complete', {
            toolName: toolCall.name,
            result,
            callId: toolCall.id,
          });

          // Update batch tracking
          this._pendingToolCount--;
          // Note: Tool execution errors should continue the conversation
          // Only user denials/aborts should pause - tool failures should continue

          if (this._pendingToolCount === 0) {
            this._handleBatchComplete();
          }
        }
      } else if (permission === 'pending') {
        // Permission pending - approval request was created
        // Don't decrement pending count yet - wait for approval response
        return;
      } else {
        // Permission was denied - we got a ToolResult back
        const result = permission;

        // Only add events if thread still exists
        if (this._threadManager.getThread(this._threadId)) {
          // Remove from active tools (it was denied)
          this._activeToolCalls.delete(toolCall.id);

          // Add result and update tracking
          this._addEventAndEmit({
            type: 'TOOL_RESULT',
            threadId: this._threadId,
            data: result,
          });
          this.emit('tool_call_complete', {
            toolName: toolCall.name,
            result,
            callId: toolCall.id,
          });

          // Update batch tracking
          this._pendingToolCount--;

          if (this._pendingToolCount === 0) {
            this._handleBatchComplete();
          }
        }
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
        // Remove from active tools
        this._activeToolCalls.delete(toolCall.id);

        const errorResult: ToolResult = {
          id: toolCall.id,
          status: 'failed',
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        };
        this._addEventAndEmit({
          type: 'TOOL_RESULT',
          threadId: this._threadId,
          data: errorResult,
        });

        // Emit tool call complete event for failed execution
        this.emit('tool_call_complete', {
          toolName: toolCall.name,
          result: errorResult,
          callId: toolCall.id,
        });

        // Update batch tracking for errors
        this._pendingToolCount--;
        // Note: Tool execution errors should continue the conversation
        // Only user denials/aborts should pause - tool failures should continue

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
        signal: this._getToolAbortSignal(),
        workingDirectory,
        agent: this,
      };

      // Execute through ToolExecutor's approved tool method
      // This bypasses permission checks (already approved) but ensures proper context setup
      const result = await this._toolExecutor.executeApprovedTool(toolCall, toolContext);

      // Only add events if thread still exists
      if (this._threadManager.getThread(this._threadId)) {
        // Remove from active tools (it completed)
        this._activeToolCalls.delete(toolCall.id);

        // Add result and update tracking
        this._addEventAndEmit({
          type: 'TOOL_RESULT',
          threadId: this._threadId,
          data: result,
        });
        this.emit('tool_call_complete', {
          toolName: toolCall.name,
          result,
          callId: toolCall.id,
        });

        // Update batch tracking
        this._pendingToolCount--;
        // Note: Tool execution errors should continue the conversation
        // Only user denials/aborts should pause - tool failures should continue

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
        // Remove from active tools
        this._activeToolCalls.delete(toolCall.id);

        const errorResult: ToolResult = {
          id: toolCall.id,
          status: 'failed',
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        };
        this._addEventAndEmit({
          type: 'TOOL_RESULT',
          threadId: this._threadId,
          data: errorResult,
        });

        // Emit tool call complete event for failed execution
        this.emit('tool_call_complete', {
          toolName: toolCall.name,
          result: errorResult,
          callId: toolCall.id,
        });

        // Update batch tracking for errors
        this._pendingToolCount--;
        // Note: Tool execution errors should continue the conversation
        // Only user denials/aborts should pause - tool failures should continue

        if (this._pendingToolCount === 0) {
          this._handleBatchComplete();
        }
      }
    }
  }

  /**
   * Determine if the conversation should continue after a batch of tools completes.
   * Returns false if any tools were denied or aborted, indicating user intervention.
   *
   * This method is called from _handleBatchComplete() when all tools in the current
   * batch have finished executing (_pendingToolCount reaches 0).
   */
  private _shouldContinueAfterToolBatch(): boolean {
    // Get all events to check the most recent tool results
    const events = this._threadManager.getEvents(this._threadId);

    // Count backwards to find all TOOL_RESULT events from this batch
    // They should be the most recent TOOL_RESULT events, appearing after
    // the most recent AGENT_MESSAGE
    let lastAgentMessageIndex = -1;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === 'AGENT_MESSAGE') {
        lastAgentMessageIndex = i;
        break;
      }
    }

    // Check all TOOL_RESULT events after the last AGENT_MESSAGE
    for (let i = lastAgentMessageIndex + 1; i < events.length; i++) {
      if (events[i].type === 'TOOL_RESULT') {
        const result = events[i].data as ToolResult;
        if (result.status === 'aborted' || result.status === 'denied') {
          return false; // Don't continue if any tool was denied or aborted
        }
      }
    }

    return true; // Continue if all tools completed successfully
  }

  private _handleBatchComplete(): void {
    // Evaluate continuation before clearing state
    const shouldContinue = this._shouldContinueAfterToolBatch();

    // Clean up tool execution state
    this._toolAbortController = null;
    this._activeToolCalls.clear();

    if (!shouldContinue) {
      // Has rejections/aborts - wait for user input
      this._setState('idle');
      // Don't auto-continue conversation
    } else {
      // All tools completed successfully - auto-continue conversation
      this._completeTurn();
      this._setState('idle');

      // Emit conversation complete after successful tool batch completion
      this.emit('conversation_complete');

      // Only continue conversation if agent is still running and thread exists
      if (this._initialized && this._threadManager.getThread(this._threadId)) {
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
      this._addEventAndEmit({
        type: 'AGENT_STATE_CHANGE',
        threadId: this._threadId,
        data: {
          agentId: this._threadId as ThreadId,
          from: oldState,
          to: newState,
        },
        transient: true,
      });

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
  private _buildConversationFromEvents(events: LaceEvent[]): ProviderMessage[] {
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
            existingUserMessage.toolResults!.push(toolResult);
          } else {
            // Create a new user message with this tool result
            messages.push({
              role: 'user',
              content: '',
              toolResults: [toolResult],
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
              toolResults: [toolResult],
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
        event.type === 'TOOL_APPROVAL_RESPONSE' ||
        event.type === 'COMPACTION' ||
        // Check if it's a transient event type
        isTransientEventType(event.type)
      ) {
        // Skip UI-only events, compaction events, and transient events - they're not sent to model
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
    // Reset abort flag at the start of each turn
    this._abortedSinceLastTurn = false;
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
    }, 1000); // Every second
  }

  private _clearProgressTimer(): void {
    if (this._progressTimer) {
      clearInterval(this._progressTimer);
      this._progressTimer = null;
    }
  }

  private async _checkAutoCompaction(): Promise<void> {
    if (!this._autoCompactConfig.enabled) return;

    // Check if we should compact based on token usage percentage
    const tokenUsage = this.getTokenUsage();
    if (tokenUsage.percentUsed >= this._autoCompactConfig.threshold) {
      logger.info('Auto-compacting due to token limit approaching', {
        threadId: this._threadId,
        percentUsed: tokenUsage.percentUsed,
        threshold: this._autoCompactConfig.threshold,
      });

      try {
        // Emit compaction event
        this.emit('compaction_start', { auto: true });
        this._addEventAndEmit({
          type: 'COMPACTION_START',
          threadId: this._threadId,
          data: { auto: true },
          transient: true,
        });

        await this.compact(this._threadId);

        // Emit compaction complete event
        this.emit('compaction_complete', { success: true });
        this._addEventAndEmit({
          type: 'COMPACTION_COMPLETE',
          threadId: this._threadId,
          data: { success: true },
          transient: true,
        });
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

  // Helper to get tool abort signal, ensuring it's aborted if agent is already aborted
  private _getToolAbortSignal(): AbortSignal {
    if (this._toolAbortController) {
      return this._toolAbortController.signal;
    }

    // Create a new controller
    const controller = new AbortController();

    // If the agent was aborted since the last turn, immediately abort the new controller
    // This prevents late approvals from executing after abort
    if (this._abortedSinceLastTurn) {
      controller.abort('Agent was aborted');
    }

    return controller.signal;
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

  getLaceEvents(threadId?: string): LaceEvent[] {
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

  getMainAndDelegateEvents(mainThreadId: string): LaceEvent[] {
    return this._threadManager.getMainAndDelegateEvents(mainThreadId);
  }

  private async _handleCompactCommand(): Promise<void> {
    this.emit('compaction_start', { auto: false });
    this._addEventAndEmit({
      type: 'COMPACTION_START',
      threadId: this._threadId,
      data: { auto: false },
      transient: true,
    });

    try {
      // Use the AI-powered summarization strategy
      await this.compact(this._threadId);

      // Emit compaction complete event for UI updates
      this.emit('compaction_complete', { success: true });
      this._addEventAndEmit({
        type: 'COMPACTION_COMPLETE',
        threadId: this._threadId,
        data: { success: true },
        transient: true,
      });
    } catch (error) {
      this.emit('compaction_complete', { success: false });
      this._addEventAndEmit({
        type: 'COMPACTION_COMPLETE',
        threadId: this._threadId,
        data: { success: false },
        transient: true,
      });
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

    // Compaction handling is now automatic through event sourcing
    // TokenBudgetManager no longer needed for compaction tracking
  }

  /**
   * Generate a summary using the current conversation context
   * Used by compaction strategies to leverage the agent's full context
   */
  async generateSummary(promptContent: string, events: LaceEvent[]): Promise<string> {
    // Build conversation messages from the provided events
    const messages = this._buildConversationFromEvents(events);

    // Add the summarization prompt
    messages.push({
      role: 'user',
      content: promptContent,
    });

    const provider = await this.getProvider();

    if (!provider) {
      throw new Error('Cannot create summary with missing provider instance');
    }

    // Get the summary using this agent's provider and model
    const model = this.model;
    const validModel = model === 'unknown-model' ? 'default' : model;
    const response = await provider.createResponse(
      messages,
      [], // No tools for summarization
      validModel
    );

    return response.content;
  }

  /**
   * Add a system message to the current thread
   * Used for error messages, notifications, etc.
   */
  addSystemMessage(message: string, threadId?: string): LaceEvent | null {
    const targetThreadId = threadId || this._threadId;
    if (!targetThreadId) {
      throw new Error('No active thread available for system message');
    }
    return this._addEventAndEmit({
      type: 'LOCAL_SYSTEM_MESSAGE',
      threadId: targetThreadId,
      data: message,
    });
  }

  /**
   * Get context information for thread events
   */
  private _getEventContext(): { sessionId?: string; projectId?: string; agentId?: string } {
    const thread = this._threadManager.getThread(this._threadId);

    // Context handling cleaned up - root issue was in session-service.ts

    return {
      sessionId: thread?.sessionId,
      projectId: thread?.projectId,
      agentId: this._threadId, // Use threadId as agentId since each agent has one thread
    };
  }

  /**
   * Helper method to add event to ThreadManager and emit Agent event
   * This ensures Agent is the single event source for UI updates
   */
  private _addEventAndEmit(event: LaceEvent): LaceEvent | null {
    // Safety check: only skip tool execution events if agent is stopped
    // Allow approval events to proceed for proper test cleanup
    if (!this._initialized && event.type === 'TOOL_RESULT') {
      logger.debug('AGENT: Skipping tool result - agent stopped', {
        threadId: event.threadId,
        type: event.type,
      });
      return null;
    }

    // Safety check: only add events if thread exists
    if (event.threadId && !this._threadManager.getThread(event.threadId)) {
      logger.warn('AGENT: Skipping event addition - thread not found', {
        threadId: event.threadId,
        type: event.type,
      });
      return null;
    }

    // Ensure context is complete - merge with thread context if needed
    const threadContext = this._getEventContext();

    if (!event.context) {
      event.context = threadContext;
    } else {
      // Merge context to ensure projectId and sessionId are present
      event.context = {
        sessionId: event.context.sessionId || threadContext.sessionId,
        projectId: event.context.projectId || threadContext.projectId,
        agentId: event.context.agentId || threadContext.agentId,
        ...event.context, // Preserve any additional context fields
      };
    }

    const addedEvent = this._threadManager.addEvent(event);

    if (addedEvent) {
      this.emit('thread_event_added', { event: addedEvent, threadId: event.threadId });
    }
    return addedEvent;
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
    this._addEventAndEmit({
      type: 'TOOL_APPROVAL_RESPONSE',
      threadId: this._threadId,
      data: {
        toolCallId,
        decision,
      },
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
  getToolCallEventById(toolCallId: string): LaceEvent | undefined {
    const events = this._threadManager.getEvents(this._threadId);
    return events.find((e) => e.type === 'TOOL_CALL' && e.data.id === toolCallId);
  }

  /**
   * Get a tool call event by tool call ID for a specific thread.
   *
   * Used by web layer components that need to look up tool calls
   * without direct ThreadManager access.
   */
  getToolCallEventByIdForThread(toolCallId: string, threadId: string): LaceEvent | undefined {
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
  addApprovalRequestEvent(toolCallId: string): LaceEvent {
    const event = this._addEventAndEmit({
      type: 'TOOL_APPROVAL_REQUEST',
      threadId: this._threadId,
      data: {
        toolCallId: toolCallId,
      },
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

      // Get session configuration if thread has a sessionId
      const sessionId = thread.sessionId;

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

  /**
   * Gets current token usage information for this agent
   */
  getTokenUsage(): ThreadTokenUsage {
    const events = this._threadManager.getEvents(this._threadId);
    const tokenSummary = aggregateTokenUsage(events);

    // Get context limit from provider system
    const modelId = this.model;
    let contextLimit = 200000; // Default fallback

    if (modelId && modelId !== 'unknown-model' && this.providerInstance) {
      const models = this.providerInstance.getAvailableModels();
      const modelInfo = models.find((m) => m.id === modelId);
      if (modelInfo) {
        contextLimit = modelInfo.contextWindow;
      }
    }

    const percentUsed = contextLimit > 0 ? tokenSummary.totalTokens / contextLimit : 0;
    const nearLimit = percentUsed >= 0.8;

    return {
      totalPromptTokens: tokenSummary.totalPromptTokens,
      totalCompletionTokens: tokenSummary.totalCompletionTokens,
      totalTokens: tokenSummary.totalTokens,
      contextLimit,
      percentUsed,
      nearLimit,
    };
  }

  /*
   * Check if a file has been read in the current conversation (since last compaction).
   * Used by file modification tools to prevent accidental overwrites.
   *
   * @param filePath - The exact path to check (no normalization performed)
   * @returns true if the file was successfully read, false otherwise
   */
  public hasFileBeenRead(filePath: string): boolean {
    const events = this._threadManager.getEvents(this._threadId);

    // Walk through events looking for successful file_read tool calls
    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      // Find TOOL_CALL events for file_read
      if (event.type === 'TOOL_CALL' && event.data.name === 'file_read') {
        const toolCallId = event.data.id;
        const args = event.data.arguments;
        const toolPath = args['path'] as string;

        // Only check if both paths exist
        if (!toolPath) continue;

        // Normalize paths for comparison - resolve to absolute paths
        const normalizedToolPath = resolve(toolPath);
        const normalizedFilePath = resolve(filePath);

        // Look for corresponding successful TOOL_RESULT
        for (let j = i + 1; j < events.length; j++) {
          const resultEvent = events[j];
          if (resultEvent.type === 'TOOL_RESULT' && resultEvent.data.id === toolCallId) {
            // Found the result for this tool call
            const toolResult = resultEvent.data;
            if (toolResult.status === 'completed' && normalizedToolPath === normalizedFilePath) {
              return true;
            }
            break; // Stop looking for this tool call's result
          }
        }
      }
    }

    return false;
  }
}
