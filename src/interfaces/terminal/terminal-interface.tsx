// ABOUTME: Ink-based terminal interface for interactive chat with Agent
// ABOUTME: Provides rich UI components with multi-line editing and visual feedback

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, render } from "ink";
import ShellInput from "./components/shell-input.js";
import { Agent } from "../../agents/agent.js";
import { ThreadManager } from "../../threads/thread-manager.js";
import { ToolExecutor } from "../../tools/executor.js";
import { ApprovalCallback, ApprovalDecision } from "../../tools/approval-types.js";
import { handleGracefulShutdown } from "../../threads/session.js";

interface Message {
  type: "user" | "assistant" | "system" | "tool" | "thinking";
  content: string;
  timestamp: Date;
}

interface TerminalInterfaceProps {
  agent: Agent;
  threadManager: ThreadManager;
  toolExecutor?: ToolExecutor;
}

const TerminalInterfaceComponent: React.FC<TerminalInterfaceProps> = ({
  agent,
  threadManager,
  toolExecutor,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentInput, setCurrentInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");

  // Add a message to the conversation
  const addMessage = useCallback((message: Message) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  // Setup event handlers for Agent events
  useEffect(() => {
    // Handle streaming tokens (real-time display)
    const handleToken = ({ token }: { token: string }) => {
      setStreamingContent((prev) => prev + token);
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
    agent.on("error", handleError);

    // Cleanup function
    return () => {
      agent.off("agent_token", handleToken);
      agent.off("agent_thinking_complete", handleThinkingComplete);
      agent.off("agent_response_complete", handleResponseComplete);
      agent.off("tool_call_start", handleToolStart);
      agent.off("tool_call_complete", handleToolComplete);
      agent.off("error", handleError);
    };
  }, [agent, addMessage, streamingContent]);

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
  }, [agent, addMessage]);

  // Handle slash commands
  const handleSlashCommand = useCallback(async (input: string) => {
    const command = input.toLowerCase().trim();

    switch (command) {
      case "/compact": {
        const threadId = threadManager.getCurrentThreadId();
        if (!threadId) {
          addMessage({
            type: "system",
            content: "❌ No active thread to compact",
            timestamp: new Date(),
          });
          return;
        }

        threadManager.compact(threadId);

        // Get the system message that was added
        const events = threadManager.getEvents(threadId);
        const systemMessage = events.find(
          (e) =>
            e.type === "LOCAL_SYSTEM_MESSAGE" &&
            typeof e.data === "string" &&
            e.data.includes("Compacted")
        );

        addMessage({
          type: "system",
          content: systemMessage ? systemMessage.data as string : "✅ Thread compaction completed",
          timestamp: new Date(),
        });
        break;
      }

      case "/help": {
        addMessage({
          type: "system",
          content: `Available commands:
  /compact  - Compress tool results to save tokens
  /help     - Show this help message
  /exit     - Exit the application`,
          timestamp: new Date(),
        });
        break;
      }

      case "/exit": {
        process.exit(0);
        break;
      }

      default: {
        addMessage({
          type: "system",
          content: `❌ Unknown command: ${command}\nType /help for available commands`,
          timestamp: new Date(),
        });
        break;
      }
    }
  }, [threadManager, addMessage]);

  // Initialize agent on mount
  useEffect(() => {
    addMessage({
      type: "system",
      content: `🤖 Lace Agent started using ${agent.providerName} provider. Type "/exit" to quit.`,
      timestamp: new Date(),
    });
    
    agent.start();
  }, [agent, addMessage]);

  return (
    <Box flexDirection="column" height="100%">
      {/* Message history */}
      <Box flexDirection="column" flexGrow={1} paddingBottom={1}>
        {messages.map((message, index) => (
          <Box key={index} marginBottom={1}>
            <Text color={
              message.type === "user" ? "cyan" :
              message.type === "assistant" ? "white" :
              message.type === "thinking" ? "dim" :
              message.type === "tool" ? "yellow" :
              "gray"
            }>
              {message.type === "thinking" && <Text italic>{message.content}</Text>}
              {message.type !== "thinking" && message.content}
            </Text>
          </Box>
        ))}
        
        {/* Show streaming content */}
        {streamingContent && (
          <Box marginBottom={1}>
            <Text color="white">{streamingContent}<Text inverse> </Text></Text>
          </Box>
        )}
        
        {/* Show processing indicator */}
        {isProcessing && !streamingContent && (
          <Box marginBottom={1}>
            <Text color="dim">Thinking...</Text>
          </Box>
        )}
      </Box>

      {/* Input area */}
      <Box borderStyle="single" borderColor="cyan" padding={1}>
        <ShellInput
          value={currentInput}
          placeholder="Type your message..."
          onSubmit={handleSubmit}
          onChange={setCurrentInput}
          autoFocus={true}
        />
      </Box>
    </Box>
  );
};

// Export the main terminal interface class
export class TerminalInterface implements ApprovalCallback {
  private agent: Agent;
  private threadManager: ThreadManager;
  private toolExecutor?: ToolExecutor;
  private isRunning = false;

  constructor(agent: Agent, threadManager: ThreadManager, toolExecutor?: ToolExecutor) {
    this.agent = agent;
    this.threadManager = threadManager;
    this.toolExecutor = toolExecutor;
  }

  async handleSinglePrompt(prompt: string): Promise<void> {
    console.log(`🤖 Lace Agent using ${this.agent.providerName} provider.\n`);

    // Start agent and process the prompt
    this.agent.start();
    await this.agent.sendMessage(prompt);

    // Save and exit
    await handleGracefulShutdown(this.threadManager);
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
        threadManager={this.threadManager}
        toolExecutor={this.toolExecutor}
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

    if (this.agent) {
      this.agent.stop();
    }

    await handleGracefulShutdown(this.threadManager);
  }

  async requestApproval(toolName: string, input: unknown): Promise<ApprovalDecision> {
    // For now, implement basic console approval (we'll enhance this in Phase 2)
    // TODO: Replace with visual ToolApprovalModal in Phase 2
    
    // Display tool information
    console.log('\n🛡️  Tool approval request');
    console.log('═'.repeat(40));

    // Show tool name and safety indicator
    const tool = this.toolExecutor?.getTool(toolName);
    const isReadOnly = tool?.annotations?.readOnlyHint === true;
    const safetyIndicator = isReadOnly ? '✅ read-only' : '⚠️  destructive';

    console.log(`Tool: ${toolName} (${safetyIndicator})`);

    // Format and display input parameters
    if (input && typeof input === 'object' && input !== null) {
      console.log('\nParameters:');
      this.formatInputParameters(input as Record<string, unknown>);
    } else if (input) {
      console.log(`\nInput: ${JSON.stringify(input)}`);
    }

    // For now, auto-approve read-only tools and deny destructive ones
    // TODO: Replace with interactive modal in Phase 2
    if (isReadOnly) {
      console.log('\n✅ Auto-approved (read-only tool)');
      return ApprovalDecision.ALLOW_ONCE;
    } else {
      console.log('\n⚠️  Destructive tool - approval needed');
      console.log('(Visual approval modal coming in Phase 2)');
      return ApprovalDecision.DENY;
    }
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