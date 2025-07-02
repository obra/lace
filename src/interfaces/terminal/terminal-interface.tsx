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
import { Box, Text, render, useFocusManager, useInput, measureElement } from 'ink';
import { Alert } from '@inkjs/ui';
import useStdoutDimensions from '../../utils/use-stdout-dimensions.js';
import ShellInput from './components/shell-input.js';
import ToolApprovalModal from './components/tool-approval-modal.js';
import { ConversationDisplay } from './components/events/ConversationDisplay.js';
import { TimelineExpansionProvider } from './components/events/hooks/useTimelineExpansionToggle.js';
import { withFullScreen } from 'fullscreen-ink';
import StatusBar from './components/status-bar.js';
import { FocusDebugPanel } from './components/FocusDebugPanel.js';
import { Agent, CurrentTurnMetrics } from '../../agents/agent.js';
import { ApprovalCallback, ApprovalDecision } from '../../tools/approval-types.js';
import { CommandRegistry } from '../../commands/registry.js';
import { CommandExecutor } from '../../commands/executor.js';
import type { UserInterface } from '../../commands/types.js';
import { ThreadEvent } from '../../threads/types.js';
import { ThreadProcessor } from '../thread-processor.js';
import { ThreadManager } from '../../threads/thread-manager.js';
import { LaceFocusProvider } from './focus/index.js';

// ThreadProcessor context for interface-level caching
const ThreadProcessorContext = createContext<ThreadProcessor | null>(null);

export const useThreadProcessor = (): ThreadProcessor => {
  const processor = useContext(ThreadProcessorContext);
  if (!processor) {
    throw new Error('useThreadProcessor must be used within ThreadProcessorContext.Provider');
  }
  return processor;
};

// ThreadManager context for direct thread data access
const ThreadManagerContext = createContext<ThreadManager | null>(null);

export const useThreadManager = (): ThreadManager => {
  const manager = useContext(ThreadManagerContext);
  if (!manager) {
    throw new Error('useThreadManager must be used within ThreadManagerContext.Provider');
  }
  return manager;
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
  interfaceContext?: { showAlert: (alert: any) => void; clearAlert: () => void };
}

interface Message {
  type: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
}

// SIGINT Handler Component
const SigintHandler: React.FC<{ agent: Agent; showAlert: (alert: any) => void }> = ({
  agent,
  showAlert,
}) => {
  const [ctrlCCount, setCtrlCCount] = useState(0);
  const ctrlCTimerRef = useRef<NodeJS.Timeout | null>(null);

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
              setTimeout(() => process.exit(0), 500);
            }

            return newCount;
          });
        }
      },
      [agent, showAlert, ctrlCCount]
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
  approvalCallback,
  interfaceContext,
}) => {
  // Create one ThreadProcessor instance per interface
  const threadProcessor = useMemo(() => new ThreadProcessor(), []);
  const bottomSectionRef = useRef<any>(null);
  const timelineContainerRef = useRef<any>(null);
  const [bottomSectionHeight, setBottomSectionHeight] = useState<number>(0);
  const [timelineContainerHeight, setTimelineContainerHeight] = useState<number>(0);
  const [, terminalHeight] = useStdoutDimensions();
  const [events, setEvents] = useState<ThreadEvent[]>([]);
  const [ephemeralMessages, setEphemeralMessages] = useState<Message[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [commandExecutor, setCommandExecutor] = useState<CommandExecutor | null>(null);
  // Cumulative session token tracking
  const [cumulativeTokens, setCumulativeTokens] = useState<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }>({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });

  // Track the final token usage from provider for accurate cumulative totals
  // Use ref to avoid race conditions with rapid requests
  const lastProviderUsageRef = useRef<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null>(null);

  // Turn tracking state
  const [isTurnActive, setIsTurnActive] = useState(false);
  const [currentTurnId, setCurrentTurnId] = useState<string | null>(null);
  const [currentTurnMetrics, setCurrentTurnMetrics] = useState<CurrentTurnMetrics | null>(null);

  // Alert state for SIGINT and other system messages
  const [alert, setAlert] = useState<{
    variant: 'info' | 'warning' | 'error' | 'success';
    title: string;
    children?: React.ReactNode;
  } | null>(null);

  // Delegation tracking state
  const [isDelegating, setIsDelegating] = useState(false);

  // Focus debug panel state
  const [isFocusDebugVisible, setIsFocusDebugVisible] = useState(false);

  // Timeline layout debug panel state
  const [isTimelineLayoutDebugVisible, setIsTimelineLayoutDebugVisible] = useState(false);

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


  // Sync events from agent's thread (including delegate threads)
  const syncEvents = useCallback(() => {
    const threadId = agent.threadManager.getCurrentThreadId();
    if (threadId) {
      const threadEvents = agent.threadManager.getMainAndDelegateEvents(threadId);
      setEvents([...threadEvents]);
    }
  }, [agent]);

  // Add an ephemeral message
  const addMessage = useCallback((message: Message) => {
    setEphemeralMessages((prev) => [...prev, message]);
  }, []);

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
    const handleApprovalRequest = ({ toolName, input, isReadOnly, resolve }: any) => {
      setApprovalRequest({
        toolName,
        input,
        isReadOnly,
        resolve,
      });
    };

    // Handle agent thinking complete
    const handleThinkingComplete = () => {
      // No action needed - thinking blocks are handled via ThreadProcessor from ThreadEvents
    };

    // Handle agent response complete
    const handleResponseComplete = ({ content }: { content: string }) => {
      // Clear streaming content - the final response will be in ThreadEvents
      setStreamingContent('');
      setIsProcessing(false);
      syncEvents();
    };

    // Handle tool execution events to show delegation boxes immediately
    const handleToolCallStart = ({ toolName }: { toolName: string }) => {
      // Sync events when delegation tool starts to show delegation box immediately
      if (toolName === 'delegate') {
        syncEvents();
      }
    };

    const handleToolCallComplete = ({ toolName }: { toolName: string }) => {
      // Sync events after any tool completes (including during delegation)
      syncEvents();
    };

    // Handle delegation lifecycle events
    const handleDelegationStart = ({ toolName }: { toolName: string }) => {
      if (toolName === 'delegate') {
        setIsDelegating(true);
        syncEvents();
      }
    };

    const handleDelegationEnd = ({ toolName }: { toolName: string }) => {
      if (toolName === 'delegate') {
        setIsDelegating(false);
        syncEvents();
      }
    };

    // Handle token usage updates - track the latest for accurate cumulative totals
    const handleTokenUsageUpdate = ({ usage }: { usage: any }) => {
      if (usage && typeof usage === 'object') {
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

        // Only update if we have meaningful token counts (avoid progressive estimates)
        if (newUsage.promptTokens > 0 || newUsage.totalTokens > 0) {
          lastProviderUsageRef.current = newUsage;
        }
      }
    };

    // Handle token budget warnings - these don't affect cumulative tracking
    const handleTokenBudgetWarning = ({ usage }: { usage: any }) => {
      // Token budget warnings are just for display, don't need to track them
    };

    const handleError = ({ error }: { error: Error }) => {
      const threadId = agent.threadManager.getCurrentThreadId();
      if (threadId) {
        agent.threadManager.addEvent(
          threadId,
          'LOCAL_SYSTEM_MESSAGE',
          `❌ Error: ${error.message}`
        );

        if (agent.providerName === 'lmstudio') {
          agent.threadManager.addEvent(
            threadId,
            'LOCAL_SYSTEM_MESSAGE',
            '💡 Try using Anthropic Claude instead: node dist/cli.js --provider anthropic'
          );
        }
        syncEvents();
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
      turnId,
      metrics,
    }: {
      turnId: string;
      metrics: CurrentTurnMetrics;
    }) => {
      setIsTurnActive(false);
      setCurrentTurnId(null);
      setCurrentTurnMetrics(null);
      setIsProcessing(false);

      // Use provider's final token counts for accurate cumulative totals (includes system prompts, context, etc.)
      const providerUsage = lastProviderUsageRef.current;
      if (providerUsage) {
        setCumulativeTokens((prev) => ({
          // Provider promptTokens includes entire conversation context, so accumulate completions only
          promptTokens: providerUsage.promptTokens, // This is the total input context
          completionTokens: prev.completionTokens + providerUsage.completionTokens, // Accumulate outputs
          totalTokens:
            providerUsage.promptTokens + (prev.completionTokens + providerUsage.completionTokens),
        }));

        // Clear the provider usage after using it
        lastProviderUsageRef.current = null;
      }

      // Show completion message with turn summary (still use turn metrics for per-turn display)
      addMessage({
        type: 'system',
        content: `Turn completed in ${Math.floor(metrics.elapsedMs / 1000)}s (↑${metrics.tokensIn} ↓${metrics.tokensOut} tokens)`,
        timestamp: new Date(),
      });
    };

    const handleTurnAborted = ({
      turnId,
      metrics,
    }: {
      turnId: string;
      metrics: CurrentTurnMetrics;
    }) => {
      setIsTurnActive(false);
      setCurrentTurnId(null);
      setCurrentTurnMetrics(null);
      setIsProcessing(false);

      // Show abort message with partial progress
      addMessage({
        type: 'system',
        content: `⚠️ Turn aborted after ${Math.floor(metrics.elapsedMs / 1000)}s (↑${metrics.tokensIn} ↓${metrics.tokensOut} tokens)`,
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
    };
  }, [agent, addMessage, syncEvents, streamingContent]);

  // Listen to ThreadManager events for real-time delegation updates
  useEffect(() => {
    const handleThreadUpdated = ({
      threadId,
      eventType,
    }: {
      threadId: string;
      eventType: string;
    }) => {
      // Sync events whenever ANY thread is updated (main or delegate)
      syncEvents();
    };

    agent.threadManager.on('thread_updated', handleThreadUpdated);

    return () => {
      agent.threadManager.off('thread_updated', handleThreadUpdated);
    };
  }, [agent.threadManager, syncEvents]);

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
        const newThreadId = agent.threadManager.generateThreadId();
        agent.threadManager.createThread(newThreadId);
        // Reset React state
        setEvents([]);
        setEphemeralMessages([]);
        addMessage({
          type: 'system',
          content: `🤖 New conversation started using ${agent.providerName} provider.`,
          timestamp: new Date(),
        });
      },

      exit(): void {
        process.exit(0);
      },

      toggleFocusDebugPanel(): boolean {
        setIsFocusDebugVisible(prev => !prev);
        return !isFocusDebugVisible;
      },

      toggleTimelineLayoutDebugPanel(): boolean {
        setIsTimelineLayoutDebugVisible(prev => !prev);
        return !isTimelineLayoutDebugVisible;
      },
    }),
    [agent, addMessage, isFocusDebugVisible, isTimelineLayoutDebugVisible]
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

      // Prevent submission during processing (but allow typing)
      if (isTurnActive || approvalRequest) {
        addMessage({
          type: 'system',
          content: isTurnActive
            ? '⚠️ Please wait for current operation to complete'
            : '⚠️ Tool approval required',
          timestamp: new Date(),
        });
        return;
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
        syncEvents(); // Ensure we have the latest events including the user message
      } catch (error) {
        addMessage({
          type: 'system',
          content: `❌ Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date(),
        });
        setIsProcessing(false);
      }
    },
    [agent, addMessage, handleSlashCommand, syncEvents, isTurnActive, approvalRequest]
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
    initCommands();
  }, [addMessage]);

  // Initialize agent on mount
  useEffect(() => {
    // Sync existing events from the thread
    syncEvents();

    addMessage({
      type: 'system',
      content: `🤖 Lace Agent started using ${agent.providerName} provider. Type "/help" to see available commands.`,
      timestamp: new Date(),
    });

    // Start agent asynchronously
    agent.start().catch((error) => {
      console.error('Failed to start agent:', error);
      addMessage({
        type: 'system',
        content: `❌ Failed to start agent: ${error.message}`,
        timestamp: new Date(),
      });
    });

    // Initial focus is handled by LaceFocusProvider default stack
  }, [agent, addMessage, syncEvents]);

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
  }, [events.length, ephemeralMessages.length, currentInput]); // Re-measure when content or input changes

  return (
    <LaceFocusProvider>
      <ThreadProcessorContext.Provider value={threadProcessor}>
        <ThreadManagerContext.Provider value={agent.threadManager}>
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
              events={events}
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
              modelName={(agent as any)._provider?.defaultModel || undefined}
              threadId={agent.threadManager.getCurrentThreadId() || undefined}
              cumulativeTokens={cumulativeTokens}
              isProcessing={isProcessing}
              messageCount={events.length + ephemeralMessages.length}
              isTurnActive={isTurnActive}
              turnMetrics={currentTurnMetrics}
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
                  onSubmit={handleSubmit}
                  onChange={setCurrentInput}
                  autoFocus={false}
                  disabled={false} // Allow typing during processing, submission is controlled in handleSubmit
                />
              )}
            </Box>
          </Box>
        </Box>
          </InterfaceContext.Provider>
        </ThreadManagerContext.Provider>
      </ThreadProcessorContext.Provider>
    </LaceFocusProvider>
  );
};

// Export the main terminal interface class
export class TerminalInterface implements ApprovalCallback {
  private agent: Agent;
  private isRunning = false;
  private pendingApprovalRequests = new Map<string, (decision: ApprovalDecision) => void>();

  constructor(agent: Agent) {
    this.agent = agent;
  }

  async startInteractive(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Terminal interface is already running');
    }

    this.isRunning = true;

    // Render the Ink app with custom Ctrl+C handling
    withFullScreen(<TerminalInterfaceComponent agent={this.agent} approvalCallback={this} />, {
      exitOnCtrlC: false, // Disable Ink's default Ctrl+C exit behavior
    }).start();

    // Keep the process running
    await new Promise<void>((resolve) => {
      // The interface will exit via process.exit() or SIGINT
    });
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    await this.agent?.stop();
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
      console.log(`  ${key}: ${formattedValue}`);
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
