// ABOUTME: Ink-based terminal interface for interactive chat with Agent
// ABOUTME: Provides rich UI components with multi-line editing and visual feedback

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  createContext,
  useContext,
  useRef,
} from 'react';
import { Box, useApp, useInput, measureElement, DOMElement } from 'ink';
import { Alert } from '@inkjs/ui';
import useStdoutDimensions from '~/utils/use-stdout-dimensions';
import ShellInput from '~/interfaces/terminal/components/shell-input';
import ToolApprovalModal from '~/interfaces/terminal/components/tool-approval-modal';
import { ConversationDisplay } from '~/interfaces/terminal/components/events/ConversationDisplay';
import { TimelineExpansionProvider } from '~/interfaces/terminal/components/events/hooks/useTimelineExpansionToggle';
import { withFullScreen } from 'fullscreen-ink';
import StatusBar from '~/interfaces/terminal/components/status-bar';
import { FocusDebugPanel } from '~/interfaces/terminal/components/FocusDebugPanel';
import { Agent, CurrentTurnMetrics } from '~/agents/agent';
import { ApprovalCallback, ApprovalDecision } from '~/tools/approval-types';
import { BudgetStatus, BudgetRecommendations } from '~/token-management/types';
import type { MessageQueueStats } from '~/agents/types';
import { CommandRegistry } from '~/commands/registry';
import { CommandExecutor } from '~/commands/executor';
import type { UserInterface } from '~/commands/types';
import { ThreadEvent } from '~/threads/types';
import { StreamingTimelineProcessor } from '~/interfaces/streaming-timeline-processor';
import { LaceFocusProvider } from '~/interfaces/terminal/focus/index';
import { useProjectContext } from '~/interfaces/terminal/hooks/use-project-context';
import { logger } from '~/utils/logger';

// StreamingTimelineProcessor context for O(1) timeline processing
const StreamingTimelineProcessorContext = createContext<StreamingTimelineProcessor | null>(null);

export const useStreamingTimelineProcessor = (): StreamingTimelineProcessor => {
  const processor = useContext(StreamingTimelineProcessorContext);
  if (!processor) {
    throw new Error(
      'useStreamingTimelineProcessor must be used within StreamingTimelineProcessorContext.Provider'
    );
  }
  return processor;
};

// Interface context for SIGINT communication
const InterfaceContext = createContext<{
  showAlert: (alert: {
    variant: 'info' | 'warning' | 'error' | 'success';
    title: string;
    children?: React.ReactNode;
  }) => void;
  clearAlert: () => void;
} | null>(null);

export const useInterface = () => {
  const context = useContext(InterfaceContext);
  if (!context) {
    throw new Error('useInterface must be used within InterfaceContext.Provider');
  }
  return context;
};

interface TerminalInterfaceProps {
  agent: Agent;
  approvalCallback?: ApprovalCallback;
  interfaceContext?: {
    showAlert: (alert: {
      variant: 'info' | 'warning' | 'error' | 'success';
      title: string;
      children?: React.ReactNode;
    }) => void;
    clearAlert: () => void;
  };
}

interface Message {
  type: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
}

// SIGINT Handler Component
const SigintHandler: React.FC<{
  agent: Agent;
  showAlert: (alertData: {
    variant: 'info' | 'warning' | 'error' | 'success';
    title: string;
    children?: React.ReactNode;
  }) => void;
}> = ({ agent, showAlert }) => {
  const [ctrlCCount, setCtrlCCount] = useState(0);
  const ctrlCTimerRef = useRef<NodeJS.Timeout | null>(null);
  const app = useApp();

  // Handle Ctrl+C through Ink's input system
  useInput(
    useCallback(
      (input, key) => {
        if (input === 'c' && key.ctrl) {
          // Try to abort current operation first
          const wasAborted = agent.abort();

          if (wasAborted) {
            showAlert({
              variant: 'warning' as const,
              title: 'Operation aborted. Progress saved.',
            });
            setCtrlCCount(0); // Reset double-ctrl-c counter
            if (ctrlCTimerRef.current) {
              clearTimeout(ctrlCTimerRef.current);
              ctrlCTimerRef.current = null;
            }
            return;
          }

          // No operation to abort - handle double Ctrl+C for exit
          setCtrlCCount((prev) => {
            const newCount = prev + 1;

            if (newCount === 1) {
              showAlert({
                variant: 'info' as const,
                title: 'Press Ctrl+C again to exit Lace.',
              });
              ctrlCTimerRef.current = setTimeout(() => {
                setCtrlCCount(0); // Reset after 2 seconds
                ctrlCTimerRef.current = null;
              }, 2000);
            } else if (newCount >= 2) {
              showAlert({
                variant: 'info' as const,
                title: 'Exiting Lace...',
              });
              if (ctrlCTimerRef.current) {
                clearTimeout(ctrlCTimerRef.current);
                ctrlCTimerRef.current = null;
              }
              // Exit after a brief delay to show the message
              setTimeout(() => app.exit(), 500);
            }

            return newCount;
          });
        }
      },
      [agent, app, showAlert, ctrlCCount]
    )
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (ctrlCTimerRef.current) {
        clearTimeout(ctrlCTimerRef.current);
      }
    };
  }, []);

  return null; // This component doesn't render anything
};

export const TerminalInterfaceComponent: React.FC<TerminalInterfaceProps> = ({
  agent,
  approvalCallback: _approvalCallback,
  interfaceContext: _interfaceContext,
}) => {
  // Create StreamingTimelineProcessor for O(1) timeline processing
  const streamingTimelineProcessor = useMemo(() => {
    const processor = new StreamingTimelineProcessor();
    // Set up callback to trigger React updates when timeline changes
    processor.setChangeCallback(() => {
      const newVersion = processor.getVersion();
      logger.debug('React timeline version update', {
        newVersion,
        timelineItemCount: processor.getTimeline().items.length,
      });
      setTimelineVersion(newVersion);
    });
    return processor;
  }, []);
  const bottomSectionRef = useRef<DOMElement | null>(null);
  const timelineContainerRef = useRef<DOMElement | null>(null);
  const [bottomSectionHeight, setBottomSectionHeight] = useState<number>(0);
  const [_timelineContainerHeight, setTimelineContainerHeight] = useState<number>(0);
  const [, _terminalHeight] = useStdoutDimensions();
  // Remove events array - StreamingTimelineProcessor manages timeline state
  // Track timeline version for React updates
  const [timelineVersion, setTimelineVersion] = useState(0);
  const [ephemeralMessages, setEphemeralMessages] = useState<Message[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [commandExecutor, setCommandExecutor] = useState<CommandExecutor | null>(null);
  // Cumulative session token tracking with context awareness
  const [cumulativeTokens, setCumulativeTokens] = useState<{
    promptTokens: number; // Current context size (latest value)
    completionTokens: number; // Total completion tokens generated
    totalTokens: number; // Actual total tokens used (not double-counted)
    contextGrowth: number; // How much the context has grown since start
    lastPromptTokens: number; // Previous turn's prompt tokens for delta calculation
  }>({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    contextGrowth: 0,
    lastPromptTokens: 0,
  });

  // Track the final token usage from provider for accurate cumulative totals
  // Use ref to avoid race conditions with rapid requests
  const lastProviderUsageRef = useRef<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null>(null);

  // Lock to prevent race conditions between token updates and turn completion
  const tokenUpdateLockRef = useRef<boolean>(false);

  // Debounce timer for token usage updates during streaming
  const tokenUpdateDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Turn tracking state
  const [isTurnActive, setIsTurnActive] = useState(false);
  const [_currentTurnId, setCurrentTurnId] = useState<string | null>(null);
  const [currentTurnMetrics, setCurrentTurnMetrics] = useState<CurrentTurnMetrics | null>(null);

  // Retry status state
  const [retryStatus, setRetryStatus] = useState<{
    isRetrying: boolean;
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    errorType: string;
    retryStartTime: number;
  } | null>(null);

  // Retry countdown timer for real-time updates
  const retryCountdownRef = useRef<NodeJS.Timeout | null>(null);

  // Alert state for SIGINT and other system messages
  const [alert, setAlert] = useState<{
    variant: 'info' | 'warning' | 'error' | 'success';
    title: string;
    children?: React.ReactNode;
  } | null>(null);

  // Delegation tracking state
  const [_isDelegating, setIsDelegating] = useState(false);

  // Focus debug panel state
  const [isFocusDebugVisible, setIsFocusDebugVisible] = useState(false);

  // Timeline layout debug panel state
  const [isTimelineLayoutDebugVisible, setIsTimelineLayoutDebugVisible] = useState(false);

  // Project context hook for double status bar
  const { context: projectContext, refreshContext } = useProjectContext();

  // Queue stats state
  const [queueStats, setQueueStats] = useState<MessageQueueStats>({
    queueLength: 0,
    highPriorityCount: 0,
  });

  // Refresh project context when processing completes (tools may have changed git status)
  useEffect(() => {
    if (!isProcessing) {
      void refreshContext();
    }
  }, [isProcessing, refreshContext]);

  // Tool approval modal state
  const [approvalRequest, setApprovalRequest] = useState<{
    toolName: string;
    input: unknown;
    isReadOnly: boolean;
    resolve: (decision: ApprovalDecision) => void;
  } | null>(null);

  // Interface context functions
  const showAlert = useCallback(
    (alertData: {
      variant: 'info' | 'warning' | 'error' | 'success';
      title: string;
      children?: React.ReactNode;
    }) => {
      setAlert(alertData);
      // Auto-clear alerts after 3 seconds
      setTimeout(() => setAlert(null), 3000);
    },
    []
  );

  const clearAlert = useCallback(() => {
    setAlert(null);
  }, []);

  // Add an ephemeral message
  const addMessage = useCallback((message: Message) => {
    setEphemeralMessages((prev) => [...prev, message]);
  }, []);

  // Initialize StreamingTimelineProcessor for session resumption (O(n), one time only)
  const initializeStreamingSession = useCallback(async () => {
    try {
      // Thread resumption already handled by app.ts, just load historical events
      const currentThreadId = agent.getCurrentThreadId();
      if (currentThreadId) {
        const historicalEvents = agent.getThreadEvents(currentThreadId);
        streamingTimelineProcessor.reset();
        streamingTimelineProcessor.loadEvents(historicalEvents);

        logger.debug('StreamingTimelineProcessor loaded historical events', {
          threadId: currentThreadId,
          eventCount: historicalEvents.length,
        });
      } else {
        logger.warn('No current thread found during session initialization');
      }
    } catch (error) {
      logger.error('Session initialization failed', { error });
      addMessage({
        type: 'system',
        content: `❌ Failed to initialize session: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      });
    }
    // Keep async for potential future async operations
    await Promise.resolve();
  }, [agent, streamingTimelineProcessor, addMessage]);

  // Initialize token counts for resumed conversations
  useEffect(() => {
    const threadId = agent.getCurrentThreadId();
    if (threadId) {
      const events = agent.getThreadEvents(threadId);

      // If we have existing events, estimate the current context size
      if (events.length > 0) {
        // Simple estimation based on event content with error handling
        let estimatedTokens = 0;
        events.forEach((event) => {
          try {
            if (typeof event.data === 'string') {
              estimatedTokens += Math.ceil(event.data.length / 4);
            } else if (event.data && typeof event.data === 'object') {
              // Handle circular references and other JSON stringify errors
              const jsonStr = JSON.stringify(event.data);
              estimatedTokens += Math.ceil(jsonStr.length / 4);
            }
          } catch (error) {
            // Skip events that can't be stringified
            logger.debug('Failed to estimate tokens for event', {
              eventType: event.type,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });

        // Initialize cumulative tokens for resumed conversation
        setCumulativeTokens((prev) => {
          // Only initialize if we haven't tracked anything yet
          if (prev.totalTokens === 0 && estimatedTokens > 0) {
            return {
              promptTokens: estimatedTokens,
              completionTokens: 0, // We don't know past completions
              totalTokens: estimatedTokens, // Conservative estimate
              contextGrowth: 0, // Reset growth tracking
              lastPromptTokens: estimatedTokens, // Set baseline for deltas
            };
          }
          return prev;
        });
      }
    }
  }, []); // Run once on mount

  // Handle tool approval modal decision
  const handleApprovalDecision = useCallback(
    (decision: ApprovalDecision) => {
      if (approvalRequest) {
        approvalRequest.resolve(decision);
        setApprovalRequest(null);
        // Focus automatically returns via LaceFocusProvider when modal closes
      }
    },
    [approvalRequest]
  );

  // Setup event handlers for Agent events
  useEffect(() => {
    // Handle streaming tokens (real-time display)
    const handleToken = ({ token }: { token: string }) => {
      setStreamingContent((prev) => prev + token);
    };

    // Handle approval requests
    const handleApprovalRequest = ({
      toolName,
      input,
      isReadOnly,
      resolve,
    }: {
      toolName: string;
      input: unknown;
      isReadOnly: boolean;
      requestId: string;
      resolve: (decision: ApprovalDecision) => void;
    }) => {
      setApprovalRequest({
        toolName,
        input,
        isReadOnly,
        resolve,
      });
    };

    // Handle agent thinking complete
    const handleThinkingComplete = () => {
      // No action needed - thinking blocks are handled via StreamingTimelineProcessor from Agent events
    };

    // Handle agent response complete
    const handleResponseComplete = ({ content: _content }: { content: string }) => {
      // Clear streaming content - the final response will be in ThreadEvents
      setStreamingContent('');
      setIsProcessing(false);

      // Clear retry status and countdown timer on successful response
      if (retryCountdownRef.current) {
        clearInterval(retryCountdownRef.current);
        retryCountdownRef.current = null;
      }
      setRetryStatus(null);

      // No need to sync events - streaming processor handles them automatically
    };

    // Handle tool execution events to show delegation boxes immediately
    const handleToolCallStart = ({ toolName: _toolName }: { toolName: string }) => {
      // No need to sync events - streaming processor handles them automatically via thread_event_added
      // Delegation boxes will appear when the TOOL_CALL event flows through
    };

    const handleToolCallComplete = ({ toolName: _toolName }: { toolName: string }) => {
      // No need to sync events - streaming processor handles them automatically via thread_event_added
    };

    // Handle delegation lifecycle events
    const _handleDelegationStart = ({ toolName }: { toolName: string }) => {
      if (toolName === 'delegate') {
        setIsDelegating(true);
        // No need to sync events - streaming processor handles them automatically
      }
    };

    const _handleDelegationEnd = ({ toolName }: { toolName: string }) => {
      if (toolName === 'delegate') {
        setIsDelegating(false);
        // No need to sync events - streaming processor handles them automatically
      }
    };

    // Handle token usage updates - track the latest for accurate cumulative totals
    const handleTokenUsageUpdate = ({
      usage,
    }: {
      usage: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    }) => {
      if (usage && typeof usage === 'object' && !tokenUpdateLockRef.current) {
        // Keep track of the most recent provider usage data
        // This includes system prompts and full context that turn metrics miss
        const newUsage = {
          promptTokens: usage.promptTokens || usage.prompt_tokens || 0,
          completionTokens: usage.completionTokens || usage.completion_tokens || 0,
          totalTokens:
            usage.totalTokens ||
            usage.total_tokens ||
            (usage.promptTokens || usage.prompt_tokens || 0) +
              (usage.completionTokens || usage.completion_tokens || 0),
        };

        // Debounce streaming updates to avoid excessive re-renders
        if (tokenUpdateDebounceRef.current) {
          clearTimeout(tokenUpdateDebounceRef.current);
        }

        // During streaming, only update immediately if we have prompt tokens (first update)
        // Otherwise debounce completion token updates
        if (newUsage.promptTokens > 0 && !lastProviderUsageRef.current?.promptTokens) {
          // First update with prompt tokens - update immediately
          lastProviderUsageRef.current = newUsage;
        } else {
          // Debounce subsequent updates (streaming completion tokens)
          tokenUpdateDebounceRef.current = setTimeout(() => {
            // Only update if we have meaningful token counts and not locked
            if (
              (newUsage.promptTokens > 0 || newUsage.totalTokens > 0) &&
              !tokenUpdateLockRef.current
            ) {
              lastProviderUsageRef.current = newUsage;
            }
            tokenUpdateDebounceRef.current = null;
          }, 200); // 200ms debounce for streaming updates
        }
      }
    };

    // Handle token budget warnings - these don't affect cumulative tracking
    const handleTokenBudgetWarning = ({
      message: _message,
      usage: _usage,
      recommendations: _recommendations,
    }: {
      message: string;
      usage: BudgetStatus;
      recommendations: BudgetRecommendations;
    }) => {
      // Token budget warnings are just for display, don't need to track them
    };

    const handleError = ({ error }: { error: Error }) => {
      const threadId = agent.getCurrentThreadId();
      if (threadId) {
        agent.addSystemMessage(`❌ Error: ${error.message}`, threadId);

        if (agent.providerName === 'lmstudio') {
          agent.addSystemMessage(
            '💡 Try using Anthropic Claude instead: node dist/cli.js --provider anthropic',
            threadId
          );
        }
        // No need to sync events - streaming processor handles them automatically via thread_event_added
      }
      setIsProcessing(false);
    };

    // Handle turn lifecycle events
    const handleTurnStart = ({
      turnId,
      metrics,
    }: {
      turnId: string;
      userInput: string;
      metrics: CurrentTurnMetrics;
    }) => {
      setIsTurnActive(true);
      setCurrentTurnId(turnId);
      setCurrentTurnMetrics(metrics);
      setIsProcessing(true);
    };

    const handleTurnProgress = ({ metrics }: { metrics: CurrentTurnMetrics }) => {
      setCurrentTurnMetrics(metrics);
    };

    const handleTurnComplete = ({
      turnId: _turnId,
      metrics,
    }: {
      turnId: string;
      metrics: CurrentTurnMetrics;
    }) => {
      setIsTurnActive(false);
      setCurrentTurnId(null);
      setCurrentTurnMetrics(null);
      setIsProcessing(false);

      // Acquire lock to prevent race conditions with ongoing token updates
      tokenUpdateLockRef.current = true;

      // Clear any pending debounced updates before processing final tokens
      if (tokenUpdateDebounceRef.current) {
        clearTimeout(tokenUpdateDebounceRef.current);
        tokenUpdateDebounceRef.current = null;
      }

      // Use provider's final token counts for accurate cumulative totals
      const providerUsage = lastProviderUsageRef.current;
      if (providerUsage) {
        setCumulativeTokens((prev) => {
          // For resumed conversations, we need to detect if this is truly the first turn
          // or if we're resuming with existing context. We check BOTH conditions:
          // - lastPromptTokens === 0: No previous prompt tokens tracked
          // - totalTokens === 0: No tokens accumulated yet
          // This ensures resumed conversations (which have totalTokens > 0 from init)
          // are not treated as first turns.
          const isFirstTurnEver = prev.lastPromptTokens === 0 && prev.totalTokens === 0;

          try {
            // Calculate the delta in prompt tokens (context growth)
            const promptDelta = providerUsage.promptTokens - prev.lastPromptTokens;
            const contextGrowth = isFirstTurnEver
              ? providerUsage.promptTokens // First turn ever includes system prompt
              : promptDelta > 0
                ? promptDelta // Normal growth
                : 0; // Handle negative deltas (shouldn't happen)

            // Validate calculations
            const newCompletionTokens = prev.completionTokens + providerUsage.completionTokens;
            const newTotalTokens =
              prev.totalTokens + contextGrowth + providerUsage.completionTokens;

            // Sanity checks
            if (
              !Number.isFinite(newCompletionTokens) ||
              !Number.isFinite(newTotalTokens) ||
              newCompletionTokens < 0 ||
              newTotalTokens < 0
            ) {
              logger.error('Invalid token calculation', {
                prev,
                providerUsage,
                contextGrowth,
                newCompletionTokens,
                newTotalTokens,
              });
              return prev; // Keep previous state on error
            }

            return {
              promptTokens: providerUsage.promptTokens, // Current context size
              completionTokens: newCompletionTokens, // Total outputs
              totalTokens: newTotalTokens, // Actual usage
              contextGrowth: prev.contextGrowth + contextGrowth, // Total context growth
              lastPromptTokens: providerUsage.promptTokens, // For next turn's delta
            };
          } catch (error) {
            logger.error('Error calculating token usage', {
              error: error instanceof Error ? error.message : String(error),
              prev,
              providerUsage,
            });
            return prev; // Keep previous state on error
          }
        });

        // Clear the provider usage after using it
        lastProviderUsageRef.current = null;
      }

      // Release lock
      tokenUpdateLockRef.current = false;

      // Show completion message with turn summary and context info
      const contextSize = providerUsage?.promptTokens || 0;
      const contextWarning = contextSize > 150000 ? ' ⚠️ Large context' : '';
      addMessage({
        type: 'system',
        content: `Turn completed in ${Math.floor(metrics.elapsedMs / 1000)}s (↑${metrics.tokensIn} ↓${metrics.tokensOut} tokens, context: ${Math.floor(contextSize / 1000)}k${contextWarning})`,
        timestamp: new Date(),
      });
    };

    const handleTurnAborted = ({
      turnId: _turnId,
      metrics,
    }: {
      turnId: string;
      metrics: CurrentTurnMetrics;
    }) => {
      setIsTurnActive(false);
      setCurrentTurnId(null);
      setCurrentTurnMetrics(null);
      setIsProcessing(false);

      // Acquire lock and clear any pending token updates
      tokenUpdateLockRef.current = true;
      if (tokenUpdateDebounceRef.current) {
        clearTimeout(tokenUpdateDebounceRef.current);
        tokenUpdateDebounceRef.current = null;
      }
      // Clear any partial provider usage data
      lastProviderUsageRef.current = null;
      // Release lock
      tokenUpdateLockRef.current = false;

      // Show abort message with partial progress
      addMessage({
        type: 'system',
        content: `⚠️ Turn aborted after ${Math.floor(metrics.elapsedMs / 1000)}s (↑${metrics.tokensIn} ↓${metrics.tokensOut} tokens)`,
        timestamp: new Date(),
      });
    };

    // Robust error classification for retry display
    const classifyRetryError = (error: Error): string => {
      // Check error codes first (most reliable)
      if ('code' in error) {
        const code = (error as unknown as { code?: string }).code;
        switch (code) {
          case 'ECONNREFUSED':
          case 'ENOTFOUND':
          case 'EHOSTUNREACH':
          case 'ECONNRESET':
            return 'connection error';
          case 'ETIMEDOUT':
            return 'timeout';
          default:
            break;
        }
      }

      // Check status codes
      if ('status' in error || 'statusCode' in error) {
        const errorWithStatus = error as unknown as { status?: number; statusCode?: number };
        const status = errorWithStatus.status || errorWithStatus.statusCode;
        if (typeof status === 'number') {
          if (status === 429) return 'rate limit';
          if (status === 401 || status === 403) return 'auth error';
          if (status >= 500 && status < 600) return 'server error';
          if (status === 408) return 'timeout';
        }
      }

      // Check error name
      if (error.name) {
        switch (error.name.toLowerCase()) {
          case 'timeouterror':
          case 'aborterror':
            return 'timeout';
          case 'networkerror':
            return 'connection error';
          default:
            break;
        }
      }

      // Fall back to message checking (least reliable)
      const message = error.message.toLowerCase();
      if (message.includes('timeout') || message.includes('timed out')) {
        return 'timeout';
      } else if (message.includes('rate limit') || message.includes('too many requests')) {
        return 'rate limit';
      } else if (
        message.includes('server error') ||
        message.includes('internal server') ||
        message.includes('service unavailable')
      ) {
        return 'server error';
      } else if (
        message.includes('unauthorized') ||
        message.includes('forbidden') ||
        message.includes('authentication')
      ) {
        return 'auth error';
      } else if (
        message.includes('connection') ||
        message.includes('network') ||
        message.includes('connect')
      ) {
        return 'connection error';
      }

      return 'network error'; // Default fallback
    };

    // Handle retry events
    const handleRetryAttempt = ({
      attempt,
      delay,
      error,
    }: {
      attempt: number;
      delay: number;
      error: Error;
    }) => {
      const errorType = classifyRetryError(error);

      const newRetryStatus = {
        isRetrying: true,
        attempt,
        maxAttempts: 10, // Default from base provider config
        delayMs: delay,
        errorType,
        retryStartTime: Date.now(),
      };

      setRetryStatus(newRetryStatus);

      // Clear any existing countdown timer
      if (retryCountdownRef.current) {
        clearInterval(retryCountdownRef.current);
      }

      // Start countdown timer for real-time updates (only if delay > 1s)
      if (delay > 1000) {
        retryCountdownRef.current = setInterval(() => {
          setRetryStatus((prev) => {
            if (!prev || !prev.isRetrying) {
              if (retryCountdownRef.current) {
                clearInterval(retryCountdownRef.current);
                retryCountdownRef.current = null;
              }
              return prev;
            }

            const elapsed = Date.now() - prev.retryStartTime;
            if (elapsed >= prev.delayMs) {
              // Countdown finished, clear timer
              if (retryCountdownRef.current) {
                clearInterval(retryCountdownRef.current);
                retryCountdownRef.current = null;
              }
              return { ...prev }; // Force re-render with updated state
            }

            return { ...prev }; // Force re-render for countdown update
          });
        }, 500); // Update every 500ms for smooth countdown
      }
    };

    const handleRetryExhausted = ({
      attempts,
      lastError,
    }: {
      attempts: number;
      lastError: Error;
    }) => {
      // Clear countdown timer
      if (retryCountdownRef.current) {
        clearInterval(retryCountdownRef.current);
        retryCountdownRef.current = null;
      }

      // Clear retry status when exhausted
      setRetryStatus(null);

      // Add system message about retry exhaustion
      addMessage({
        type: 'system',
        content: `❌ All ${attempts} retries exhausted: ${lastError.message}`,
        timestamp: new Date(),
      });
    };

    // Register event listeners
    agent.on('agent_token', handleToken);
    agent.on('agent_thinking_complete', handleThinkingComplete);
    agent.on('agent_response_complete', handleResponseComplete);
    agent.on('approval_request', handleApprovalRequest);
    agent.on('token_usage_update', handleTokenUsageUpdate);
    agent.on('token_budget_warning', handleTokenBudgetWarning);
    agent.on('tool_call_start', handleToolCallStart);
    agent.on('tool_call_complete', handleToolCallComplete);
    agent.on('error', handleError);
    // Turn tracking events
    agent.on('turn_start', handleTurnStart);
    agent.on('turn_progress', handleTurnProgress);
    agent.on('turn_complete', handleTurnComplete);
    agent.on('turn_aborted', handleTurnAborted);
    // Retry events
    agent.on('retry_attempt', handleRetryAttempt);
    agent.on('retry_exhausted', handleRetryExhausted);

    // Cleanup function
    return () => {
      agent.off('agent_token', handleToken);
      agent.off('agent_thinking_complete', handleThinkingComplete);
      agent.off('agent_response_complete', handleResponseComplete);
      agent.off('approval_request', handleApprovalRequest);
      agent.off('token_usage_update', handleTokenUsageUpdate);
      agent.off('token_budget_warning', handleTokenBudgetWarning);
      agent.off('tool_call_start', handleToolCallStart);
      agent.off('tool_call_complete', handleToolCallComplete);
      agent.off('error', handleError);
      // Turn tracking cleanup
      agent.off('turn_start', handleTurnStart);
      agent.off('turn_progress', handleTurnProgress);
      agent.off('turn_complete', handleTurnComplete);
      agent.off('turn_aborted', handleTurnAborted);
      // Retry events cleanup
      agent.off('retry_attempt', handleRetryAttempt);
      agent.off('retry_exhausted', handleRetryExhausted);

      // Clear any pending debounced updates
      if (tokenUpdateDebounceRef.current) {
        clearTimeout(tokenUpdateDebounceRef.current);
        tokenUpdateDebounceRef.current = null;
      }

      // Clear retry countdown timer
      if (retryCountdownRef.current) {
        clearInterval(retryCountdownRef.current);
        retryCountdownRef.current = null;
      }
    };
  }, [agent, addMessage, streamingContent]);

  // Listen to Agent events for pure streaming updates (O(1) per event)
  useEffect(() => {
    const handleEventAdded = ({ event, threadId }: { event: ThreadEvent; threadId: string }) => {
      const currentThreadId = agent.getCurrentThreadId();
      if (threadId === currentThreadId) {
        // Stream event directly to processor (O(1) operation)
        streamingTimelineProcessor.appendEvent(event);

        logger.debug('StreamingTimelineProcessor appended event', {
          eventType: event.type,
          eventId: event.id,
          threadId,
        });
      }
    };

    agent.on('thread_event_added', handleEventAdded);

    return () => {
      agent.off('thread_event_added', handleEventAdded);
    };
  }, [agent, streamingTimelineProcessor]);

  // Listen for queue events and update stats
  useEffect(() => {
    const updateQueueStats = () => {
      setQueueStats(agent.getQueueStats());
    };

    const handleMessageQueued = () => {
      updateQueueStats();
    };

    const handleQueueProcessingStart = () => {
      updateQueueStats();
    };

    const handleQueueProcessingComplete = () => {
      updateQueueStats();
    };

    // Initial stats
    updateQueueStats();

    // Listen for queue events
    agent.on('message_queued', handleMessageQueued);
    agent.on('queue_processing_start', handleQueueProcessingStart);
    agent.on('queue_processing_complete', handleQueueProcessingComplete);

    return () => {
      agent.off('message_queued', handleMessageQueued);
      agent.off('queue_processing_start', handleQueueProcessingStart);
      agent.off('queue_processing_complete', handleQueueProcessingComplete);
    };
  }, [agent]);

  // Get Ink app instance for proper exit handling
  const app = useApp();

  // Create UserInterface implementation
  const userInterface: UserInterface = React.useMemo(
    () => ({
      agent,

      displayMessage(message: string): void {
        addMessage({
          type: 'system',
          content: message,
          timestamp: new Date(),
        });
      },

      clearSession(): void {
        // Create new thread and agent
        const newThreadId = agent.generateThreadId();
        agent.createThread(newThreadId);
        // Reset streaming processor and ephemeral state
        streamingTimelineProcessor.reset();
        setEphemeralMessages([]);
        addMessage({
          type: 'system',
          content: `🤖 New conversation started using ${agent.providerName} provider.`,
          timestamp: new Date(),
        });
      },

      exit(): void {
        app.exit();
      },

      toggleFocusDebugPanel(): boolean {
        setIsFocusDebugVisible((prev) => !prev);
        return !isFocusDebugVisible;
      },

      toggleTimelineLayoutDebugPanel(): boolean {
        setIsTimelineLayoutDebugVisible((prev) => !prev);
        return !isTimelineLayoutDebugVisible;
      },

      getPerformanceMetrics(): string {
        return streamingTimelineProcessor.getPerformanceSummary();
      },
    }),
    [
      agent,
      app,
      addMessage,
      isFocusDebugVisible,
      isTimelineLayoutDebugVisible,
      streamingTimelineProcessor,
    ]
  );

  // Handle slash commands using new command system
  const handleSlashCommand = useCallback(
    async (input: string) => {
      if (!commandExecutor) {
        addMessage({
          type: 'system',
          content: 'Commands not yet loaded...',
          timestamp: new Date(),
        });
        return;
      }
      await commandExecutor.execute(input, userInterface);
    },
    [commandExecutor, userInterface, addMessage]
  );

  // Handle message submission
  const handleSubmit = useCallback(
    async (input: string) => {
      const trimmedInput = input.trim();

      if (!trimmedInput) return;

      // Handle tool approval - still block during approval
      if (approvalRequest) {
        addMessage({
          type: 'system',
          content: '⚠️ Tool approval required',
          timestamp: new Date(),
        });
        return;
      }

      // If agent is busy, automatically queue the message
      if (isTurnActive) {
        try {
          await agent.sendMessage(trimmedInput, { queue: true });
          addMessage({
            type: 'system',
            content: '📬 Message queued - will process when current operation completes',
            timestamp: new Date(),
          });
          setCurrentInput('');
          return;
        } catch (error) {
          addMessage({
            type: 'system',
            content: `❌ Failed to queue message: ${error instanceof Error ? error.message : String(error)}`,
            timestamp: new Date(),
          });
          return;
        }
      }

      // Handle slash commands
      if (trimmedInput.startsWith('/')) {
        await handleSlashCommand(trimmedInput);
        setCurrentInput('');
        return;
      }

      setCurrentInput('');
      setIsProcessing(true);

      // Send to agent (it will create the USER_MESSAGE ThreadEvent)
      try {
        await agent.sendMessage(trimmedInput);
        // No need to sync events - streaming processor handles them automatically via thread_event_added
      } catch (error) {
        addMessage({
          type: 'system',
          content: `❌ Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date(),
        });
        setIsProcessing(false);
      }
    },
    [agent, addMessage, handleSlashCommand, isTurnActive, approvalRequest]
  );

  // Initialize command system
  useEffect(() => {
    const initCommands = async () => {
      try {
        const registry = await CommandRegistry.createWithAutoDiscovery();
        const executor = new CommandExecutor(registry);
        setCommandExecutor(executor);
      } catch (error) {
        console.error('Terminal: Failed to initialize command system:', error);
        addMessage({
          type: 'system',
          content: `❌ Failed to initialize command system: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date(),
        });
      }
    };
    void initCommands();
  }, [addMessage]);

  // Initialize agent on mount
  useEffect(() => {
    // Initialize streaming session (loads historical events into StreamingTimelineProcessor)
    void initializeStreamingSession();

    addMessage({
      type: 'system',
      content: `🤖 Lace Agent started using ${agent.providerName} provider. Type "/help" to see available commands.`,
      timestamp: new Date(),
    });

    // Start agent asynchronously
    agent.start().catch((error: unknown) => {
      console.error('Failed to start agent:', error);
      addMessage({
        type: 'system',
        content: `❌ Failed to start agent: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      });
    });

    // Initial focus is handled by LaceFocusProvider default stack
  }, [agent, addMessage, initializeStreamingSession]);

  // Approval modal focus is handled by ModalWrapper automatically

  // Measure bottom section height for viewport calculations
  useEffect(() => {
    if (bottomSectionRef.current) {
      const { height } = measureElement(bottomSectionRef.current);
      setBottomSectionHeight(height);
    }
    if (timelineContainerRef.current) {
      const { height } = measureElement(timelineContainerRef.current);
      setTimelineContainerHeight(height);
    }
  }, [ephemeralMessages.length, currentInput]); // Re-measure when ephemeral content or input changes

  return (
    <LaceFocusProvider>
      <StreamingTimelineProcessorContext.Provider value={streamingTimelineProcessor}>
        <InterfaceContext.Provider value={{ showAlert, clearAlert }}>
          {/* SIGINT Handler */}
          <SigintHandler agent={agent} showAlert={showAlert} />

          <Box flexDirection="column" height="100%">
            {/* Alert overlay */}
            {alert && (
              <Box position="absolute" paddingTop={1} paddingLeft={1} paddingRight={1}>
                <Alert variant={alert.variant} title={alert.title}>
                  {alert.children}
                </Alert>
              </Box>
            )}

            {/* Timeline - takes remaining space */}
            <Box flexGrow={1} ref={timelineContainerRef}>
              {/* 
              TimelineExpansionProvider creates an isolated expansion event system for this conversation.
              - Timeline-level controls (keyboard shortcuts) can emit expand/collapse events
              - Only the currently selected timeline item will respond to these events
              - Each conversation has its own provider, so multiple conversations don't interfere
              - See hooks/useTimelineExpansionToggle.tsx for architecture details
            */}
              <TimelineExpansionProvider>
                <ConversationDisplay
                  ephemeralMessages={[
                    ...ephemeralMessages,
                    // Add streaming content as ephemeral message
                    ...(streamingContent
                      ? [
                          {
                            type: 'assistant' as const,
                            content: streamingContent,
                            timestamp: new Date(),
                          },
                        ]
                      : []),
                    // Add processing indicator as ephemeral message
                    ...(isProcessing && !streamingContent
                      ? [
                          {
                            type: 'system' as const,
                            content: '💭 Thinking...',
                            timestamp: new Date(),
                          },
                        ]
                      : []),
                  ]}
                  bottomSectionHeight={bottomSectionHeight}
                  isTimelineLayoutDebugVisible={isTimelineLayoutDebugVisible}
                  timelineVersion={timelineVersion}
                />
              </TimelineExpansionProvider>
            </Box>

            {/* Bottom section - debug panel, status bar, input anchored to bottom */}
            <Box flexDirection="column" flexShrink={0} ref={bottomSectionRef}>
              {/* Focus debug panel - takes natural height, only shown when enabled */}
              {isFocusDebugVisible && <FocusDebugPanel />}

              {/* Status bar - takes natural height */}
              <StatusBar
                providerName={agent.providerName || 'unknown'}
                modelName={agent.provider?.modelName || undefined}
                threadId={agent.getCurrentThreadId() || undefined}
                cumulativeTokens={cumulativeTokens}
                isProcessing={isProcessing}
                messageCount={
                  streamingTimelineProcessor.getTimeline().metadata.eventCount +
                  ephemeralMessages.length
                }
                isTurnActive={isTurnActive}
                turnMetrics={currentTurnMetrics}
                projectContext={projectContext}
                contextWindow={agent.provider?.contextWindow}
                retryStatus={retryStatus}
                queueStats={queueStats}
              />

              {/* Input area or modal - takes natural height */}
              <Box>
                {approvalRequest ? (
                  <ToolApprovalModal
                    toolName={approvalRequest.toolName}
                    input={approvalRequest.input}
                    isReadOnly={approvalRequest.isReadOnly}
                    onDecision={handleApprovalDecision}
                    isVisible={true}
                  />
                ) : (
                  <ShellInput
                    value={currentInput}
                    placeholder={
                      isTurnActive && currentTurnMetrics
                        ? (() => {
                            const elapsedSeconds = Math.floor(currentTurnMetrics.elapsedMs / 1000);
                            const duration =
                              elapsedSeconds >= 60
                                ? `${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`
                                : `${elapsedSeconds}s`;
                            return `Processing... ⏱️ ${duration} | Press Ctrl+C to abort`;
                          })()
                        : 'Type your message...'
                    }
                    onSubmit={(value) => void handleSubmit(value)}
                    onChange={setCurrentInput}
                    autoFocus={false}
                    disabled={false} // Allow typing during processing, submission is controlled in handleSubmit
                  />
                )}
              </Box>
            </Box>
          </Box>
        </InterfaceContext.Provider>
      </StreamingTimelineProcessorContext.Provider>
    </LaceFocusProvider>
  );
};

// Export the main terminal interface class
export class TerminalInterface implements ApprovalCallback {
  private agent: Agent;
  private isRunning = false;
  private pendingApprovalRequests = new Map<string, (decision: ApprovalDecision) => void>();
  private inkInstance?: ReturnType<typeof withFullScreen>;

  constructor(agent: Agent) {
    this.agent = agent;
  }

  async startInteractive(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Terminal interface is already running');
    }

    this.isRunning = true;

    // Render the Ink app with custom Ctrl+C handling
    this.inkInstance = withFullScreen(
      <TerminalInterfaceComponent agent={this.agent} approvalCallback={this} />,
      {
        exitOnCtrlC: false, // Disable Ink's default Ctrl+C exit behavior
      }
    );

    await this.inkInstance.start();
    await this.inkInstance.waitUntilExit();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.agent?.stop();

    // Properly unmount the Ink app
    if (this.inkInstance) {
      this.inkInstance.instance.unmount();
    }

    // Keep async for potential future async cleanup operations
    await Promise.resolve();
  }

  async requestApproval(toolName: string, input: unknown): Promise<ApprovalDecision> {
    // Get tool information for risk assessment
    const tool = this.agent.toolExecutor.getTool(toolName);
    const isReadOnly = tool?.annotations?.readOnlyHint === true;

    // Create a promise that will be resolved by the UI
    return new Promise<ApprovalDecision>((resolve) => {
      // Store the resolver with a unique key
      const requestId = `${toolName}-${Date.now()}`;
      this.pendingApprovalRequests.set(requestId, resolve);

      // Emit an event that the UI component can listen to
      // Since we need React state updates, we'll use a different approach
      // For now, let's use a more direct method by updating the component state

      // This is a bit of a hack - we'll improve this architecture later
      // For now, use a global event emitter pattern
      process.nextTick(() => {
        this.agent.emit('approval_request', {
          toolName,
          input,
          isReadOnly,
          requestId,
          resolve: (decision: ApprovalDecision) => {
            this.pendingApprovalRequests.delete(requestId);
            resolve(decision);
          },
        });
      });
    });
  }

  private formatInputParameters(input: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(input)) {
      const formattedValue = this.formatParameterValue(value);
      console.warn(`  ${key}: ${formattedValue}`);
    }
  }

  private formatParameterValue(value: unknown): string {
    if (typeof value === 'string') {
      if (value.length > 200) {
        return `"${value.substring(0, 200)}...[truncated]"`;
      }
      return `"${value}"`;
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        return '[]';
      }
      const items = value.slice(0, 3).map((item) => this.formatParameterValue(item));
      const suffix = value.length > 3 ? `, ...${value.length - 3} more` : '';
      return `[${items.join(', ')}${suffix}]`;
    } else if (typeof value === 'object' && value !== null) {
      const entries = Object.entries(value).slice(0, 3);
      const formatted = entries.map(([k, v]) => `${k}: ${this.formatParameterValue(v)}`);
      const suffix = Object.keys(value).length > 3 ? ', ...' : '';
      return `{ ${formatted.join(', ')}${suffix} }`;
    } else {
      return String(value);
    }
  }
}
