// ABOUTME: Ink-based terminal interface for interactive chat with Agent
// ABOUTME: Provides rich UI components with multi-line editing and visual feedback

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, render } from "ink";
import ShellInput from "./components/shell-input.js";
import ToolApprovalModal from "./components/tool-approval-modal.js";
import MessageDisplay from "./components/message-display.js";
import StatusBar from "./components/status-bar.js";
import { Agent } from "../../agents/agent.js";
import { ApprovalCallback, ApprovalDecision } from "../../tools/approval-types.js";
import { CommandRegistry } from "../../commands/registry.js";
import { CommandExecutor } from "../../commands/executor.js";
import type { UserInterface } from "../../commands/types.js";

interface Message {
  type: "user" | "assistant" | "system" | "tool" | "thinking";
  content: string;
  timestamp: Date;
}

interface TerminalInterfaceProps {
  agent: Agent;
  approvalCallback?: ApprovalCallback;
}

const TerminalInterfaceComponent: React.FC<TerminalInterfaceProps> = ({
  agent,
  approvalCallback,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
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

  // Add a message to the conversation
  const addMessage = useCallback((message: Message) => {
    setMessages((prev) => [...prev, message]);
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

    // Handle agent thinking
    const handleThinkingComplete = ({ content }: { content: string }) => {
      // Extract think blocks and show them
      const thinkMatches = content.match(/<think>[\s\S]*?<\/think>/g);
      if (thinkMatches) {
        thinkMatches.forEach((thinkBlock) => {
          const thinkContent = thinkBlock.replace(/<\/?think>/g, "").trim();
          if (thinkContent) {
            addMessage({
              type: "thinking",
              content: thinkContent,
              timestamp: new Date(),
            });
          }
        });
      }
    };

    // Handle agent response complete
    const handleResponseComplete = ({ content }: { content: string }) => {
      if (agent.getCurrentState() === "streaming") {
        // For streaming, use the accumulated streaming content
        if (streamingContent.trim()) {
          addMessage({
            type: "assistant",
            content: streamingContent,
            timestamp: new Date(),
          });
        }
        setStreamingContent("");
      } else {
        // For non-streaming, use the complete content
        if (content && content.length > 0) {
          addMessage({
            type: "assistant",
            content: content,
            timestamp: new Date(),
          });
        }
      }
      setIsProcessing(false);
    };

    // Handle tool execution
    const handleToolStart = ({ toolName, input }: { toolName: string; input: unknown }) => {
      const inputDisplay =
        JSON.stringify(input).length > 100
          ? JSON.stringify(input).substring(0, 100) + "..."
          : JSON.stringify(input);

      addMessage({
        type: "tool",
        content: `🔧 Running: ${toolName} with ${inputDisplay}`,
        timestamp: new Date(),
      });
    };

    const handleToolComplete = ({ result }: { result: any }) => {
      const outputText = result.content[0]?.text || "";
      
      if (!result.isError) {
        const outputLength = outputText.length;
        if (outputLength > 500) {
          const truncated = outputText.substring(0, 500);
          addMessage({
            type: "tool",
            content: `✅ Tool completed (${outputLength} chars):\n${truncated}...`,
            timestamp: new Date(),
          });
        } else {
          addMessage({
            type: "tool",
            content: `✅ Tool completed:\n${outputText}`,
            timestamp: new Date(),
          });
        }
      } else {
        const errorText = result.content[0]?.text || "Unknown error";
        addMessage({
          type: "tool",
          content: `❌ Tool failed: ${errorText}`,
          timestamp: new Date(),
        });
      }
    };

    // Handle errors
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
      addMessage({
        type: "system",
        content: `❌ Error: ${error.message}`,
        timestamp: new Date(),
      });

      // Suggest alternatives based on the provider
      if (agent.providerName === "lmstudio") {
        addMessage({
          type: "system",
          content: "💡 Try using Anthropic Claude instead: node dist/cli.js --provider anthropic",
          timestamp: new Date(),
        });
      }
      setIsProcessing(false);
    };

    // Register event listeners
    agent.on("agent_token", handleToken);
    agent.on("agent_thinking_complete", handleThinkingComplete);
    agent.on("agent_response_complete", handleResponseComplete);
    agent.on("tool_call_start", handleToolStart);
    agent.on("tool_call_complete", handleToolComplete);
    agent.on("approval_request", handleApprovalRequest);
    agent.on("token_budget_warning", handleTokenBudgetWarning);
    agent.on("error", handleError);

    // Cleanup function
    return () => {
      agent.off("agent_token", handleToken);
      agent.off("agent_thinking_complete", handleThinkingComplete);
      agent.off("agent_response_complete", handleResponseComplete);
      agent.off("tool_call_start", handleToolStart);
      agent.off("tool_call_complete", handleToolComplete);
      agent.off("approval_request", handleApprovalRequest);
      agent.off("token_budget_warning", handleTokenBudgetWarning);
      agent.off("error", handleError);
    };
  }, [agent, addMessage, streamingContent]);

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
      setMessages([]);
      addMessage({
        type: "system",
        content: `🤖 New conversation started using ${agent.providerName} provider.`,
        timestamp: new Date(),
      });
    },
    
    exit(): void {
      process.exit(0);
    }
  }), [agent, addMessage, setMessages]);

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

    // Add user message
    addMessage({
      type: "user",
      content: trimmedInput,
      timestamp: new Date(),
    });

    setCurrentInput("");
    setIsProcessing(true);

    // Send to agent
    try {
      await agent.sendMessage(trimmedInput);
    } catch (error) {
      addMessage({
        type: "system",
        content: `❌ Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      });
      setIsProcessing(false);
    }
  }, [agent, addMessage, handleSlashCommand]);

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
    addMessage({
      type: "system",
      content: `🤖 Lace Agent started using ${agent.providerName} provider. Type "/help" to see available commands.`,
      timestamp: new Date(),
    });
    
    agent.start();
  }, [agent, addMessage]);

  return (
    <Box flexDirection="column" height="100%">
      {/* Message history */}
      <Box flexDirection="column" flexGrow={1} paddingY={1}>
        {messages.map((message, index) => (
          <MessageDisplay 
            key={index} 
            message={message}
          />
        ))}
        
        {/* Show streaming content with new MessageDisplay */}
        {streamingContent && (
          <MessageDisplay 
            message={{
              type: "assistant",
              content: streamingContent,
              timestamp: new Date(),
            }}
            isStreaming={true}
            showCursor={true}
          />
        )}
        
        {/* Show processing indicator */}
        {isProcessing && !streamingContent && (
          <Box marginBottom={1}>
            <Text color="dim">💭 Thinking...</Text>
          </Box>
        )}
      </Box>

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
        messageCount={messages.length}
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