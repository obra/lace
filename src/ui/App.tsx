// ABOUTME: Main Ink application component for Lace terminal UI
// ABOUTME: Implements full-window layout with ConversationView, StatusBar

import React, { useState, useEffect, useRef } from "react";
import { Box, useStdout, useStdin } from "ink";
import { createCompletionManager } from "./completion/index.js";
import { CommandManager } from "./commands/CommandManager";
import { getAllCommands } from "./commands/registry";
// Remove fullscreen-ink import from here - will be used in lace-ui.ts instead
import ConversationView from "./components/ConversationView";
import DetailedLogView, { DetailedLogEntry } from "./components/DetailedLogView";
import StatusBar from "./components/StatusBar";
import ShellInput from "./components/ShellInput";
import ToolApprovalModal from "./components/ToolApprovalModal";
import { useInput, useFocus, useFocusManager } from "ink";
import { Conversation } from "../conversation/conversation.js";
import { Message } from "../conversation/message.js";

interface ToolCall {
  id?: string;
  name: string;
  input: any;
}

interface UsageData {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

interface TimingData {
  durationMs?: number;
}

type ConversationMessage =
  | { type: "user"; content: string }
  | { type: "assistant"; content: string; tool_calls?: ToolCall[]; usage?: UsageData }
  | { type: "loading"; content: string }
  | { type: "streaming"; content: string; isStreaming: boolean; usage?: UsageData }
  | {
      type: "agent_activity";
      summary: string;
      content: string[];
      folded: boolean;
      timing?: TimingData;
    };

// DetailedLogEntry imported from DetailedLogView component

interface AppProps {
  laceUI?: any; // LaceUI instance passed from parent
  conversation?: Conversation; // Current conversation from lace-ui
}


function extractLogEntries(conversation: ConversationMessage[]): DetailedLogEntry[] {
  const entries: DetailedLogEntry[] = [];
  let entryIndex = 0;

  conversation.forEach((message, messageIndex) => {
    const baseTimestamp = new Date().toISOString();
    
    // Add the main message entry
    let content: string;
    if (message.type === "agent_activity") {
      content = `${message.summary}\n${message.content.join('\n')}`;
    } else {
      content = message.content as string;
    }
    
    // Extract usage and timing data based on message type
    let usage: DetailedLogEntry['usage'] = undefined;
    let timing: DetailedLogEntry['timing'] = undefined;

    if (message.type === "assistant" && message.usage) {
      usage = {
        inputTokens: message.usage.inputTokens,
        outputTokens: message.usage.outputTokens,
        totalTokens: message.usage.totalTokens,
      };
    } else if (message.type === "streaming" && message.usage) {
      usage = {
        inputTokens: message.usage.inputTokens,
        outputTokens: message.usage.outputTokens,
        totalTokens: message.usage.totalTokens,
      };
    } else if (message.type === "agent_activity" && message.timing) {
      timing = {
        durationMs: message.timing.durationMs,
      };
    }

    entries.push({
      id: `log-${entryIndex++}-${baseTimestamp}`,
      timestamp: baseTimestamp,
      type: message.type as string,
      content,
      usage,
      timing,
    });

    // If this is an assistant message with tool calls, add separate tool call entries
    if (message.type === "assistant" && message.tool_calls && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      message.tool_calls.forEach((toolCall, toolIndex) => {
        // Add tool call entry with mock timing data for demonstration
        const toolCallTimestamp = new Date(Date.parse(baseTimestamp) + toolIndex + 1).toISOString();
        
        // Mock timing data based on tool type (in real implementation, this would come from activity logger)
        const mockDuration = toolCall.name === "file" ? 50 + Math.random() * 100 : 
                           toolCall.name === "shell" ? 200 + Math.random() * 800 :
                           toolCall.name === "javascript" ? 100 + Math.random() * 500 :
                           75 + Math.random() * 150;
        
        entries.push({
          id: `log-${entryIndex++}-${toolCallTimestamp}`,
          timestamp: toolCallTimestamp,
          type: "tool_call",
          content: `Tool: ${toolCall.name}\nInput: ${JSON.stringify(toolCall.input, null, 2)}`,
          timing: {
            durationMs: Math.round(mockDuration),
          },
        });

        // For now, we don't have tool results in the conversation history
        // Tool results would need to be extracted from the agent response or activity logger
        // This is a placeholder for when tool results are available in conversation data
        // TODO: Extract tool results when they become available in conversation data
      });
    }
  });

  return entries;
}

function formatModalContent(type: string, data: any): string {
  switch (type) {
    case "status":
      return formatStatusModal(data);
    case "activity":
      return formatActivityModal(data);
    case "tools":
      return formatToolsModal(data);
    case "memory":
      return formatMemoryModal(data);
    case "approval":
      return formatApprovalModal(data);
    case "help":
      return formatHelpModal(data);
    default:
      return `${type} information:\n${JSON.stringify(data, null, 2)}`;
  }
}

function formatStatusModal(data: any): string {
  const { agentInfo, contextUsage, pricingInfo } = data;

  let content = "🤖 Agent Status:\n";
  content += `  Role: ${agentInfo.role}\n`;
  content += `  Model: ${agentInfo.model}\n`;
  content += `  Provider: ${agentInfo.provider}\n`;
  content += `  Generation: ${agentInfo.generation}\n`;

  if (contextUsage) {
    content += "\n📊 Context Window Usage:\n";
    content += `  Used: ${contextUsage.used.toLocaleString()} tokens\n`;
    content += `  Total: ${contextUsage.total.toLocaleString()} tokens\n`;
    content += `  Usage: ${contextUsage.percentage.toFixed(1)}%\n`;
    content += `  Remaining: ${contextUsage.remaining.toLocaleString()} tokens\n`;

    if (contextUsage.approachingHandoff) {
      content += "  ⚠️ Context approaching handoff threshold!\n";
    }
  }

  if (pricingInfo) {
    content += "\n💰 Model Pricing:\n";
    content += `  Input: $${pricingInfo.inputPricePerMillion.toFixed(2)} per million tokens\n`;
    content += `  Output: $${pricingInfo.outputPricePerMillion.toFixed(2)} per million tokens\n`;

    if (pricingInfo.currentContextCost !== null) {
      content += `  Current context cost: ~$${pricingInfo.currentContextCost.toFixed(4)}\n`;
    }
  }

  return content;
}

function formatActivityModal(data: any): string {
  const { activities } = data;

  if (!activities || activities.length === 0) {
    return "📝 No recent activity found.";
  }

  let content = `📝 Activity Log (${activities.length} events):\n\n`;

  activities.forEach((activity: any, index: number) => {
    const timestamp = new Date(activity.timestamp).toLocaleString();
    content += `${index + 1}. [${timestamp}] ${activity.event_type}\n`;

    if (activity.data) {
      try {
        const eventData =
          typeof activity.data === "string"
            ? JSON.parse(activity.data)
            : activity.data;
        if (eventData.input) {
          content += `   Input: ${eventData.input.substring(0, 100)}${eventData.input.length > 100 ? "..." : ""}\n`;
        }
        if (eventData.content) {
          content += `   Content: ${eventData.content.substring(0, 100)}${eventData.content.length > 100 ? "..." : ""}\n`;
        }
      } catch {
        // Ignore parsing errors
      }
    }
    content += "\n";
  });

  return content;
}

function formatToolsModal(data: any): string {
  const { tools } = data;

  if (!tools || tools.length === 0) {
    return "🛠️ No tools available.";
  }

  let content = `🛠️ Available Tools (${tools.length}):\n\n`;

  tools.forEach((tool: any, index: number) => {
    content += `${index + 1}. ${tool.name}\n`;
    content += `   ${tool.description}\n\n`;
  });

  return content;
}

function formatMemoryModal(data: any): string {
  const { history } = data;

  if (!history || history.length === 0) {
    return "🧠 No conversation history found.";
  }

  let content = `🧠 Conversation History (${history.length} messages):\n\n`;

  history.forEach((msg: any, index: number) => {
    const timestamp = msg.timestamp
      ? new Date(msg.timestamp).toLocaleString()
      : "Unknown time";
    content += `${index + 1}. [${timestamp}] ${msg.role}: ${msg.content.substring(0, 150)}${msg.content.length > 150 ? "..." : ""}\n\n`;
  });

  return content;
}

function formatApprovalModal(data: any): string {
  let content = "🔒 Tool Approval Settings:\n\n";

  content += `Interactive Mode: ${data.interactiveMode ? "Enabled" : "Disabled"}\n`;

  if (data.autoApproveList && data.autoApproveList.length > 0) {
    content += `\n✅ Auto-approve List:\n`;
    data.autoApproveList.forEach((tool: string) => {
      content += `  - ${tool}\n`;
    });
  } else {
    content += "\n✅ Auto-approve List: Empty\n";
  }

  if (data.denyList && data.denyList.length > 0) {
    content += `\n🚫 Deny List:\n`;
    data.denyList.forEach((tool: string) => {
      content += `  - ${tool}\n`;
    });
  } else {
    content += "\n🚫 Deny List: Empty\n";
  }

  return content;
}

function formatHelpModal(data: any): string {
  return data.helpText || "Help information not available.";
}

const AppInner: React.FC<AppProps> = ({ laceUI, conversation }) => {
  const { stdout } = useStdout();
  const { isRawModeSupported, setRawMode } = useStdin();
  const { focus } = useFocusManager();
  const [isNavigationMode, setIsNavigationMode] = useState(false);
  const [scrollPosition, setScrollPosition] = useState(0);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [filterMode, setFilterMode] = useState<
    "all" | "conversation" | "search"
  >("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchResultIndex, setSearchResultIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'conversation' | 'log'>('conversation');
  const [uiElements, setUIElements] = useState<ConversationMessage[]>([]); // All messages are now UI elements
  const [tokenUsage, setTokenUsage] = useState({ used: 0, total: 200000 });
  const [modelName, setModelName] = useState("claude-3-5-sonnet");
  const [commandManager] = useState(() => {
    const cm = new CommandManager();
    cm.registerAll(getAllCommands());
    return cm;
  });
  const [completionManager] = useState(() =>
    createCompletionManager({
      cwd: process.cwd(),
      history: [],
      commandManager,
    }),
  );
  const streamingRef = useRef<{ content: string }>({ content: "" });
  const [ctrlCCount, setCtrlCCount] = useState(0);
  const ctrlCTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [toolApprovalRequest, setToolApprovalRequest] = useState<{
    toolCall: any;
    riskLevel: "low" | "medium" | "high";
    context?: any;
    resolve: (result: any) => void;
  } | null>(null);

  // Helper function to add UI message (all messages are now UI elements)
  const addUIMessage = (message: ConversationMessage) => {
    setUIElements((prev) => [...prev, message]);
  };

  // Load existing messages from conversation when app starts
  useEffect(() => {
    const loadExistingMessages = async () => {
      if (conversation) {
        const msgs = await conversation.getMessages();
        // Convert existing messages to UI elements
        const uiMessages = msgs.map(msg => {
          if (msg.role === 'user') {
            return { type: 'user' as const, content: msg.content };
          } else if (msg.role === 'tool') {
            return { type: 'assistant' as const, content: msg.content }; // Tool executions display as assistant messages
          } else {
            return { 
              type: 'assistant' as const, 
              content: msg.content,
              ...(msg.toolCalls && { tool_calls: msg.toolCalls })
            };
          }
        });
        setUIElements(uiMessages);
      }
    };
    loadExistingMessages();
  }, [conversation]);

  // Update completion manager history when UI elements change
  useEffect(() => {
    const userMessages = uiElements
      .filter((msg) => msg.type === "user")
      .map((msg) => msg.content)
      .slice(-10);
    completionManager.updateHistory(userMessages);
  }, [uiElements, completionManager]);

  // Setup raw mode to handle Ctrl+C properly
  useEffect(() => {
    if (isRawModeSupported) {
      setRawMode(true);
      return () => {
        setRawMode(false);
      };
    }
  }, [isRawModeSupported, setRawMode]);

  // Setup streaming callback and tool approval for laceUI
  useEffect(() => {
    if (laceUI) {
      const uiCallback = (
        toolCall: any,
        riskLevel: "low" | "medium" | "high",
        context?: any,
      ) => {
        return new Promise((resolve) => {
          setToolApprovalRequest({ toolCall, riskLevel, context, resolve });
        });
      };

      laceUI.uiRef = {
        handleStreamingToken: (token: string) => {
          streamingRef.current.content += token;

          // Update the streaming message with new content
          setUIElements((prev) => {
            const updated = [...prev];
            const lastMessage = updated[updated.length - 1];
            if (lastMessage && lastMessage.type === "streaming") {
              updated[updated.length - 1] = {
                ...lastMessage,
                content: streamingRef.current.content,
              };
            }
            return updated;
          });
        },
        requestToolApproval: uiCallback,
      };

      // Set the UI callback on the tool approval manager
      laceUI.setToolApprovalUICallback(uiCallback);

      // Give laceUI access to the command manager
      laceUI.commandManager = commandManager;
    }
  }, [laceUI, commandManager]);

  // Display messages are now just the UI elements (which include user/assistant messages)
  const getDisplayMessages = (): ConversationMessage[] => {
    return uiElements;
  };

  const filterMessages = (messages: ConversationMessage[]) => {
    switch (filterMode) {
      case "conversation":
        return messages.filter(
          (msg) => msg.type === "user" || msg.type === "assistant",
        );
      case "search":
        if (!searchTerm.trim()) return messages;
        return messages.filter((msg) => {
          const content =
            msg.type === "agent_activity"
              ? msg.summary + " " + msg.content.join(" ")
              : msg.content;
          return content.toLowerCase().includes(searchTerm.toLowerCase());
        });
      case "all":
      default:
        return messages;
    }
  };

  const findSearchResults = (messages: ConversationMessage[], term: string) => {
    if (!term.trim()) return [];
    const results: { messageIndex: number; message: ConversationMessage }[] =
      [];

    messages.forEach((msg, index) => {
      const content =
        msg.type === "agent_activity"
          ? msg.summary + " " + msg.content.join(" ")
          : msg.content;

      if (content.toLowerCase().includes(term.toLowerCase())) {
        results.push({ messageIndex: index, message: msg });
      }
    });

    return results;
  };

  const displayMessages = getDisplayMessages();
  const filteredConversation = filterMessages(displayMessages);
  const searchResults = isSearchMode
    ? findSearchResults(displayMessages, searchTerm)
    : [];
  const totalMessages = filteredConversation.length;

  const submitMessage = async (inputValue?: string) => {
    const userInput = (inputValue || inputText).trim();
    if (userInput && !isLoading && !isStreaming) {
      setInputText("");

      // Check if it's a command
      if (commandManager.isCommand(userInput)) {
        try {
          const commandContext = {
            laceUI,
            agent: laceUI?.primaryAgent,
            addUIMessage,
          };

          const result = await commandManager.execute(
            userInput,
            commandContext,
          );

          if (result.shouldExit) {
            process.exit(0);
            return;
          }

          if (result.shouldShowModal) {
            const content = formatModalContent(
              result.shouldShowModal.type,
              result.shouldShowModal.data,
            );
            addUIMessage({
              type: "assistant" as const,
              content,
            });
          } else if (result.message) {
            addUIMessage({
              type: "assistant" as const,
              content: result.message,
            });
          }
        } catch (error) {
          addUIMessage({
            type: "assistant" as const,
            content: `Command error: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
        return;
      }

      // Not a command - handle as regular message
      if (!laceUI) {
        addUIMessage({
          type: "assistant" as const,
          content: "Error: LaceUI not available",
        });
        return;
      }

      // Add user message to UI immediately
      addUIMessage({ type: "user" as const, content: userInput });
      
      // Start loading state
      setIsLoading(true);
      addUIMessage({ type: "loading" as const, content: "Assistant is thinking..." });

      try {
        // Clear streaming content
        streamingRef.current.content = "";

        // Start streaming after a brief delay
        setTimeout(() => {
          setIsLoading(false);
          setIsStreaming(true);

          // Remove loading message and start streaming
          setUIElements((prev) => {
            const withoutLoading = prev.slice(0, -1);
            return [
              ...withoutLoading,
              { type: "streaming" as const, content: "", isStreaming: true },
            ];
          });
        }, 500);

        // Get real agent response
        const response = await laceUI.handleMessage(userInput);

        if (response.error) {
          // Handle error
          setIsLoading(false);
          setIsStreaming(false);
          // Clear UI elements and show error
          setUIElements([]);
          addUIMessage({
            type: "assistant" as const,
            content: `Error: ${response.error}`,
          });
        } else {
          // Streaming complete - the agent has saved all messages to conversation
          setIsStreaming(false);
          
          // Clear UI elements and reload messages from conversation 
          setUIElements([]);
          
          // Reload all messages including new assistant messages and tool executions
          const msgs = await conversation.getMessages();
          const uiMessages = msgs.map(msg => {
            if (msg.role === 'user') {
              return { type: 'user' as const, content: msg.content };
            } else if (msg.role === 'tool') {
              return { type: 'assistant' as const, content: msg.content };
            } else {
              return { 
                type: 'assistant' as const, 
                content: msg.content,
                ...(msg.toolCalls && { tool_calls: msg.toolCalls })
              };
            }
          });
          setUIElements(uiMessages);

          // Add agent activities as UI elements if present
          if (response.agentActivities && response.agentActivities.length > 0) {
            addUIMessage({
              type: "agent_activity" as const,
              summary: `Agent Activity - ${response.agentActivities.length} items`,
              content: response.agentActivities,
              folded: true,
            });
          }

          // Update token usage if available
          if (response.usage) {
            setTokenUsage({
              used:
                response.usage.total_tokens || response.usage.totalTokens || 0,
              total: 200000, // Default context window
            });
          }
        }
      } catch (error) {
        setIsLoading(false);
        setIsStreaming(false);
        // Clear UI elements and show error
        setUIElements([]);
        addUIMessage({
          type: "assistant" as const,
          content: `Error: ${error.message}`,
        });
      }
    }
  };

  const handleToolApproval = (modifiedCall?: any, comment?: string) => {
    if (toolApprovalRequest) {
      const result = {
        approved: true,
        reason: comment ? "User approved with comment" : "User approved",
        modifiedCall: modifiedCall || toolApprovalRequest.toolCall,
        postExecutionComment: comment,
      };
      toolApprovalRequest.resolve(result);
      setToolApprovalRequest(null);
      // Return focus to text editor
      focus("text-editor");
    }
  };

  const handleToolDeny = (reason?: string) => {
    if (toolApprovalRequest) {
      const result = {
        approved: false,
        reason: reason || "User denied",
        modifiedCall: null,
      };
      toolApprovalRequest.resolve(result);
      setToolApprovalRequest(null);
      // Return focus to text editor
      focus("text-editor");
    }
  };

  const handleToolStop = () => {
    if (toolApprovalRequest) {
      const result = {
        approved: false,
        reason: "User requested stop",
        modifiedCall: null,
        shouldStop: true,
      };
      toolApprovalRequest.resolve(result);
      setToolApprovalRequest(null);
      // Return focus to text editor
      focus("text-editor");
    }
  };

  // Global input handlers using regular useInput hook
  useInput((input, key) => {
    // Handle Ctrl+C with proper logic
    if (key.ctrl && input === "c") {
      // If processing, abort and reset counter
      if ((isLoading || isStreaming) && laceUI) {
        const aborted = laceUI.handleAbort();
        if (aborted) {
          setIsLoading(false);
          setIsStreaming(false);
          // Clear UI elements and show cancellation message
          setUIElements([]);
          addUIMessage({
            type: "assistant" as const,
            content: "Operation cancelled by user (Ctrl+C)",
          });
          setCtrlCCount(0);
          if (ctrlCTimeoutRef.current) {
            clearTimeout(ctrlCTimeoutRef.current);
          }
          return;
        }
      }

      // Handle exit logic
      setCtrlCCount((prev) => prev + 1);

      if (ctrlCCount === 0) {
        console.log("\nPress Ctrl+C again to exit...");
        if (ctrlCTimeoutRef.current) {
          clearTimeout(ctrlCTimeoutRef.current);
        }
        ctrlCTimeoutRef.current = setTimeout(() => {
          setCtrlCCount(0);
        }, 2000);
      } else {
        process.exit(0);
      }
      return;
    }

    // Global Ctrl+L handler for toggling view mode
    if (key.ctrl && input === "l") {
      setViewMode((prev) => prev === 'conversation' ? 'log' : 'conversation');
      return;
    }

    // Global Escape handler for aborting processing (but not navigation)
    if (key.escape && (isLoading || isStreaming) && laceUI) {
      const aborted = laceUI.handleAbort();
      if (aborted) {
        // Update UI state to reflect abortion
        setIsLoading(false);
        setIsStreaming(false);
        // Clear UI elements and show cancellation message
        setUIElements([]);
        addUIMessage({
          type: "assistant" as const,
          content: "Operation cancelled by user (Esc)",
        });
        return;
      }
    }

    // Navigation mode handlers (only when navigation is active)
    if (isNavigationMode && !toolApprovalRequest) {
      if (key.escape || input === "q") {
        // Exit navigation mode
        setIsNavigationMode(false);
        setScrollPosition(0);
        focus("text-editor");
      } else if (input === "j" || key.downArrow) {
        // Scroll down
        setScrollPosition((prev) => Math.min(prev + 1, totalMessages - 1));
      } else if (input === "k" || key.upArrow) {
        // Scroll up
        setScrollPosition((prev) => Math.max(prev - 1, 0));
      } else if (input === " ") {
        // Toggle fold state
        const currentMessage = filteredConversation[scrollPosition];
        if (currentMessage && currentMessage.type === "agent_activity") {
          setUIElements((prev) =>
            prev.map((msg) =>
              msg === currentMessage && msg.type === "agent_activity"
                ? { ...msg, folded: !msg.folded }
                : msg,
            ),
          );
        }
      } else if (input === "c") {
        // Conversation filter mode
        setFilterMode("conversation");
        setScrollPosition(0);
      } else if (input === "a") {
        // Show all mode
        setFilterMode("all");
        setScrollPosition(0);
      } else if (input === "/") {
        // Enter search mode
        setIsSearchMode(true);
        setSearchTerm("");
        setIsNavigationMode(false);
        focus("search-input");
      } else if (
        input === "n" &&
        filterMode === "search" &&
        searchResults.length > 0
      ) {
        // Next search result
        setSearchResultIndex((prev) => (prev + 1) % searchResults.length);
        const nextResult =
          searchResults[(searchResultIndex + 1) % searchResults.length];
        setScrollPosition(nextResult.messageIndex);
      } else if (
        input === "N" &&
        filterMode === "search" &&
        searchResults.length > 0
      ) {
        // Previous search result
        setSearchResultIndex(
          (prev) => (prev - 1 + searchResults.length) % searchResults.length,
        );
        const prevResult =
          searchResults[
            (searchResultIndex - 1 + searchResults.length) %
              searchResults.length
          ];
        setScrollPosition(prevResult.messageIndex);
      }
      return; // Navigation mode consumes all input
    }
  });

  // Handle mode transitions with proper focus coordination
  useEffect(() => {
    if (toolApprovalRequest) {
      // Tool approval has highest priority
      focus("tool-approval");
    } else if (isSearchMode) {
      focus("search-input");
    } else {
      focus("text-editor");
    }
  }, [isSearchMode, toolApprovalRequest, focus]);

  // Extract real log entries from display messages
  const logEntries = extractLogEntries(getDisplayMessages());

  return (
    <Box flexDirection="column" flexGrow={1}>
      {viewMode === 'conversation' ? (
        <ConversationView
          scrollPosition={scrollPosition}
          isNavigationMode={isNavigationMode}
          messages={filteredConversation}
          searchTerm={filterMode === "search" || isSearchMode ? searchTerm : ""}
          searchResults={searchResults}
        />
      ) : (
        <DetailedLogView
          scrollPosition={scrollPosition}
          isNavigationMode={isNavigationMode}
          entries={logEntries}
        />
      )}
      <StatusBar
        isNavigationMode={isNavigationMode}
        scrollPosition={scrollPosition}
        totalMessages={totalMessages}
        isLoading={isLoading}
        isStreaming={isStreaming}
        filterMode={filterMode}
        searchTerm={searchTerm}
        isSearchMode={isSearchMode}
        searchResults={searchResults}
        searchResultIndex={searchResultIndex}
        tokenUsage={tokenUsage}
        modelName={modelName}
        terminalWidth={stdout.columns || 100}
        viewMode={viewMode}
      />
      <ShellInput
        value={isSearchMode ? searchTerm : inputText}
        placeholder={isSearchMode ? "Search..." : "Type your message..."}
        focusId={isSearchMode ? "search-input" : "text-editor"}
        autoFocus={!isSearchMode}
        onSubmit={
          isSearchMode
            ? (searchValue) => {
                if (searchValue.trim()) {
                  setFilterMode("search");
                  setIsSearchMode(false);
                  setIsNavigationMode(true);
                  setScrollPosition(0);
                }
              }
            : submitMessage
        }
        onChange={isSearchMode ? setSearchTerm : setInputText}
        history={uiElements
          .filter((msg) => msg.type === "user")
          .map((msg) => msg.content)
          .slice(-10)}
        showDebug={false}
        completionManager={completionManager}
      />

      {/* Tool Approval Modal */}
      {toolApprovalRequest && (
        <Box position="absolute" marginTop={2}>
          <ToolApprovalModal
            toolCall={toolApprovalRequest.toolCall}
            riskLevel={toolApprovalRequest.riskLevel}
            context={toolApprovalRequest.context}
            onApprove={handleToolApproval}
            onDeny={handleToolDeny}
            onStop={handleToolStop}
          />
        </Box>
      )}
    </Box>
  );
};

// Main App component using Ink's built-in focus management
const App: React.FC<AppProps> = (props) => {
  return <AppInner {...props} />;
};

export default App;
