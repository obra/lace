// ABOUTME: Ink-based terminal interface for interactive chat with Agent
// ABOUTME: Provides rich UI components with multi-line editing and visual feedback

import React, { useState, useEffect, useCallback, useMemo, createContext, useContext, useRef } from "react";
import { Box, Text, render, useFocusManager, useInput, measureElement } from "ink";
import { withFullScreen } from "fullscreen-ink";
import useStdoutDimensions from "../../utils/use-stdout-dimensions.js";
import ShellInput from "./components/shell-input.js";
import ToolApprovalModal from "./components/tool-approval-modal.js";
import { ConversationDisplay } from "./components/events/ConversationDisplay.js";
import StatusBar from "./components/status-bar.js";
import { Agent } from "../../agents/agent.js";
import { ApprovalCallback, ApprovalDecision } from "../../tools/approval-types.js";
import { CommandRegistry } from "../../commands/registry.js";
import { CommandExecutor } from "../../commands/executor.js";
import type { UserInterface } from "../../commands/types.js";
import { ThreadEvent } from "../../threads/types.js";
import { ThreadProcessor } from "../thread-processor.js";

// ThreadProcessor context for interface-level caching
const ThreadProcessorContext = createContext<ThreadProcessor | null>(null);

export const useThreadProcessor = (): ThreadProcessor => {
  const processor = useContext(ThreadProcessorContext);
  if (!processor) {
    throw new Error('useThreadProcessor must be used within ThreadProcessorContext.Provider');
  }
  return processor;
};

interface TerminalInterfaceProps {
  agent: Agent;
  approvalCallback?: ApprovalCallback;
}

interface Message {
  type: "user" | "assistant" | "system" | "tool" | "thinking";
  content: string;
  timestamp: Date;
}

const TerminalInterfaceComponent: React.FC<TerminalInterfaceProps> = ({
  agent,
  approvalCallback,
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
  const [currentInput, setCurrentInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [commandExecutor, setCommandExecutor] = useState<CommandExecutor | null>(null);
  const [tokenUsage, setTokenUsage] = useState<{
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  }>({});
  
  // Delegation tracking state
  const [isDelegating, setIsDelegating] = useState(false);
  
  // Tool approval modal state
  const [approvalRequest, setApprovalRequest] = useState<{
    toolName: string;
    input: unknown;
    isReadOnly: boolean;
    resolve: (decision: ApprovalDecision) => void;
  } | null>(null);
  
  // Focus management with disabled automatic cycling
  const { focus, focusNext, focusPrevious, disableFocus } = useFocusManager();
  
  // Disable automatic Tab cycling to prevent conflicts with autocomplete
  useEffect(() => {
    disableFocus();
  }, [disableFocus]);
  
  // Global keyboard shortcuts for manual focus switching  
  useInput(useCallback((input, key) => {
    if (key.escape) {
      // Escape toggles between shell input and timeline
      focusNext();
    }
    // Tab is NOT handled here - let ShellInput handle it for autocomplete
  }, [focusNext]), { isActive: !approvalRequest });

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
  const handleApprovalDecision = useCallback((decision: ApprovalDecision) => {
    if (approvalRequest) {
      approvalRequest.resolve(decision);
      setApprovalRequest(null);
      // Return focus to shell input when modal closes (for typing)
      focus('shell-input');
    }
  }, [approvalRequest, focus]);

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
      setStreamingContent("");
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

    // Handle token usage updates
    const handleTokenUsageUpdate = ({ usage }: { usage: any }) => {
      if (usage && typeof usage === 'object') {
        setTokenUsage({
          promptTokens: usage.promptTokens || usage.prompt_tokens,
          completionTokens: usage.completionTokens || usage.completion_tokens,
          totalTokens: usage.totalTokens || usage.total_tokens,
        });
      }
    };

    // Handle token budget warnings and update token usage
    const handleTokenBudgetWarning = ({ usage }: { usage: any }) => {
      if (usage && typeof usage === 'object') {
        setTokenUsage({
          promptTokens: usage.promptTokens || usage.prompt_tokens,
          completionTokens: usage.completionTokens || usage.completion_tokens,
          totalTokens: usage.totalTokens || usage.total_tokens,
        });
      }
    };

    const handleError = ({ error }: { error: Error }) => {
      const threadId = agent.threadManager.getCurrentThreadId();
      if (threadId) {
        agent.threadManager.addEvent(threadId, 'LOCAL_SYSTEM_MESSAGE', `❌ Error: ${error.message}`);
        
        if (agent.providerName === "lmstudio") {
          agent.threadManager.addEvent(threadId, 'LOCAL_SYSTEM_MESSAGE', "💡 Try using Anthropic Claude instead: node dist/cli.js --provider anthropic");
        }
        syncEvents();
      }
      setIsProcessing(false);
    };


    // Register event listeners
    agent.on("agent_token", handleToken);
    agent.on("agent_thinking_complete", handleThinkingComplete);
    agent.on("agent_response_complete", handleResponseComplete);
    agent.on("approval_request", handleApprovalRequest);
    agent.on("token_usage_update", handleTokenUsageUpdate);
    agent.on("token_budget_warning", handleTokenBudgetWarning);
    agent.on("tool_call_start", handleToolCallStart);
    agent.on("tool_call_complete", handleToolCallComplete);
    agent.on("error", handleError);

    // Cleanup function
    return () => {
      agent.off("agent_token", handleToken);
      agent.off("agent_thinking_complete", handleThinkingComplete);
      agent.off("agent_response_complete", handleResponseComplete);
      agent.off("approval_request", handleApprovalRequest);
      agent.off("token_usage_update", handleTokenUsageUpdate);
      agent.off("token_budget_warning", handleTokenBudgetWarning);
      agent.off("tool_call_start", handleToolCallStart);
      agent.off("tool_call_complete", handleToolCallComplete);
      agent.off("error", handleError);
    };
  }, [agent, addMessage, syncEvents, streamingContent]);

  // Listen to ThreadManager events for real-time delegation updates
  useEffect(() => {
    const handleThreadUpdated = ({ threadId, eventType }: { threadId: string; eventType: string }) => {
      // Sync events whenever ANY thread is updated (main or delegate)
      syncEvents();
    };

    agent.threadManager.on('thread_updated', handleThreadUpdated);
    
    return () => {
      agent.threadManager.off('thread_updated', handleThreadUpdated);
    };
  }, [agent.threadManager, syncEvents]);

  // Create UserInterface implementation
  const userInterface: UserInterface = React.useMemo(() => ({
    agent,
    
    displayMessage(message: string): void {
      addMessage({
        type: "system",
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
        type: "system",
        content: `🤖 New conversation started using ${agent.providerName} provider.`,
        timestamp: new Date(),
      });
    },
    
    exit(): void {
      process.exit(0);
    }
  }), [agent, addMessage]);

  // Handle slash commands using new command system
  const handleSlashCommand = useCallback(async (input: string) => {
    if (!commandExecutor) {
      addMessage({
        type: "system",
        content: "Commands not yet loaded...",
        timestamp: new Date(),
      });
      return;
    }
    await commandExecutor.execute(input, userInterface);
  }, [commandExecutor, userInterface, addMessage]);

  // Handle message submission
  const handleSubmit = useCallback(async (input: string) => {
    const trimmedInput = input.trim();
    
    if (!trimmedInput) return;

    // Handle slash commands
    if (trimmedInput.startsWith("/")) {
      await handleSlashCommand(trimmedInput);
      setCurrentInput("");
      return;
    }

    setCurrentInput("");
    setIsProcessing(true);

    // Send to agent (it will create the USER_MESSAGE ThreadEvent)
    try {
      await agent.sendMessage(trimmedInput);
      syncEvents(); // Ensure we have the latest events including the user message
    } catch (error) {
      addMessage({
        type: "system",
        content: `❌ Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      });
      setIsProcessing(false);
    }
  }, [agent, addMessage, handleSlashCommand, syncEvents]);

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
          type: "system",
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
      type: "system",
      content: `🤖 Lace Agent started using ${agent.providerName} provider. Type "/help" to see available commands.`,
      timestamp: new Date(),
    });
    
    agent.start();
    
    // Set initial focus to shell input (for typing)
    focus('shell-input');
  }, [agent, addMessage, syncEvents, focus]);

  // Focus approval modal when it appears
  useEffect(() => {
    if (approvalRequest) {
      // Use setTimeout to ensure the modal is rendered before focusing
      const timeoutId = setTimeout(() => {
        focus('approval-modal');
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [approvalRequest, focus]);

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
    <ThreadProcessorContext.Provider value={threadProcessor}>
      <Box flexDirection="column" height="100%">
        {/* Timeline - takes remaining space */}
        <Box flexGrow={1} ref={timelineContainerRef}>
          <ConversationDisplay 
            events={events}
            ephemeralMessages={[
              ...ephemeralMessages,
              // Add streaming content as ephemeral message
              ...(streamingContent ? [{
                type: "assistant" as const,
                content: streamingContent,
                timestamp: new Date(),
              }] : []),
              // Add processing indicator as ephemeral message
              ...(isProcessing && !streamingContent ? [{
                type: "system" as const,
                content: "💭 Thinking...",
                timestamp: new Date(),
              }] : [])
            ]}
            focusId="timeline"
            bottomSectionHeight={bottomSectionHeight}
          />
        </Box>

        {/* Tool approval modal */}
        {approvalRequest && (
          <ToolApprovalModal
            toolName={approvalRequest.toolName}
            input={approvalRequest.input}
            isReadOnly={approvalRequest.isReadOnly}
            onDecision={handleApprovalDecision}
            isVisible={true}
            focusId="approval-modal"
          />
        )}

        {/* Bottom section - status bar, input anchored to bottom */}
        <Box flexDirection="column" flexShrink={0} ref={bottomSectionRef}>
          {/* Status bar - takes natural height */}
          <StatusBar 
            providerName={agent.providerName || 'unknown'}
            modelName={(agent as any)._provider?.defaultModel || undefined}
            threadId={agent.threadManager.getCurrentThreadId() || undefined}
            tokenUsage={tokenUsage}
            isProcessing={isProcessing}
            messageCount={events.length + ephemeralMessages.length}
          />

          {/* Input area - takes natural height */}
          <Box padding={1}>
            <ShellInput
              value={currentInput}
              placeholder={approvalRequest ? "Tool approval required..." : "Type your message..."}
              onSubmit={handleSubmit}
              onChange={setCurrentInput}
              focusId="shell-input"
              autoFocus={false}
              disabled={!!approvalRequest}
            />
          </Box>

        </Box>
      </Box>
    </ThreadProcessorContext.Provider>
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
      throw new Error("Terminal interface is already running");
    }

    this.isRunning = true;

    // Handle graceful shutdown on Ctrl+C
    process.on("SIGINT", async () => {
      console.log("\n\nShutting down gracefully...");
      await this.stop();
      process.exit(0);
    });

    // Render the Ink app with fullscreen support
    withFullScreen(
      <TerminalInterfaceComponent
        agent={this.agent}
        approvalCallback={this}
      />
    ).start();

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
          }
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
