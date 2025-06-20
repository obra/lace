// ABOUTME: Ink-based terminal interface for interactive chat with Agent
// ABOUTME: Provides rich UI components with multi-line editing and visual feedback

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, render } from "ink";
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
  
  // Tool approval modal state
  const [approvalRequest, setApprovalRequest] = useState<{
    toolName: string;
    input: unknown;
    isReadOnly: boolean;
    resolve: (decision: ApprovalDecision) => void;
  } | null>(null);

  // Sync events from agent's thread
  const syncEvents = useCallback(() => {
    const threadId = agent.threadManager.getCurrentThreadId();
    if (threadId) {
      const threadEvents = agent.threadManager.getEvents(threadId);
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
    }
  }, [approvalRequest]);

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
      // Thinking indicator can be hidden - thinking content is handled via THINKING ThreadEvents
    };

    // Handle agent response complete
    const handleResponseComplete = ({ content }: { content: string }) => {
      // Clear streaming content - the final response will be in ThreadEvents
      setStreamingContent("");
      setIsProcessing(false);
      syncEvents();
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
    agent.on("error", handleError);

    // Cleanup function
    return () => {
      agent.off("agent_token", handleToken);
      agent.off("agent_thinking_complete", handleThinkingComplete);
      agent.off("agent_response_complete", handleResponseComplete);
      agent.off("approval_request", handleApprovalRequest);
      agent.off("token_usage_update", handleTokenUsageUpdate);
      agent.off("token_budget_warning", handleTokenBudgetWarning);
      agent.off("error", handleError);
    };
  }, [agent, addMessage, syncEvents, streamingContent]);

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
  }, [agent, addMessage, syncEvents]);

  return (
    <Box flexDirection="column" height="100%">
      {/* Conversation display with merged events and messages */}
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
      />

      {/* Tool approval modal */}
      {approvalRequest && (
        <ToolApprovalModal
          toolName={approvalRequest.toolName}
          input={approvalRequest.input}
          isReadOnly={approvalRequest.isReadOnly}
          onDecision={handleApprovalDecision}
          isVisible={true}
        />
      )}

      {/* Status bar - right above input */}
      <StatusBar 
        providerName={agent.providerName || 'unknown'}
        modelName={(agent as any)._provider?.defaultModel || undefined}
        threadId={agent.threadManager.getCurrentThreadId() || undefined}
        tokenUsage={tokenUsage}
        isProcessing={isProcessing}
        messageCount={events.length + ephemeralMessages.length}
      />

      {/* Input area - disabled when modal is open */}
      <Box padding={1}>
        <ShellInput
          value={currentInput}
          placeholder={approvalRequest ? "Tool approval required..." : "Type your message..."}
          onSubmit={handleSubmit}
          onChange={setCurrentInput}
          autoFocus={!approvalRequest}
          disabled={!!approvalRequest}
        />
      </Box>
    </Box>
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

    // Render the Ink app
    const { unmount } = render(
      <TerminalInterfaceComponent
        agent={this.agent}
        approvalCallback={this}
      />
    );

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