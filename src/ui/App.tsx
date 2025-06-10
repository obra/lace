// ABOUTME: Main Ink application component for Lace terminal UI
// ABOUTME: Implements full-window layout with ConversationView, StatusBar, and InputBar

import React, { useState, useEffect, useRef } from "react";
import { Box, useStdout, useStdin } from "ink";
import { createCompletionManager } from "./completion/index.js";
import { CommandManager } from "./commands/CommandManager";
import { getAllCommands } from "./commands/registry";
// Remove fullscreen-ink import from here - will be used in lace-ui.ts instead
import ConversationView from "./components/ConversationView";
import StatusBar from "./components/StatusBar";
import ShellInput from "./components/ShellInput";
import ToolApprovalModal from "./components/ToolApprovalModal";
import { useInput, useFocus, useFocusManager } from "ink";

type ConversationMessage =
  | { type: "user"; content: string }
  | { type: "assistant"; content: string }
  | { type: "loading"; content: string }
  | { type: "streaming"; content: string; isStreaming: boolean }
  | {
      type: "agent_activity";
      summary: string;
      content: string[];
      folded: boolean;
    };

interface AppProps {
  laceUI?: any; // LaceUI instance passed from parent
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

const AppInner: React.FC<AppProps> = ({ laceUI }) => {
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
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
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

  // Update completion manager history when conversation changes
  useEffect(() => {
    const userMessages = conversation
      .filter((msg) => msg.type === "user")
      .map((msg) => msg.content)
      .slice(-10);
    completionManager.updateHistory(userMessages);
  }, [conversation, completionManager]);

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
          setConversation((prev) => {
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

  const filteredConversation = filterMessages(conversation);
  const searchResults = isSearchMode
    ? findSearchResults(conversation, searchTerm)
    : [];
  const totalMessages = filteredConversation.length;

  const submitMessage = async (inputValue?: string) => {
    const userInput = (inputValue || inputText).trim();
    if (userInput && !isLoading && !isStreaming) {
      // Add user message
      setConversation((prev) => [
        ...prev,
        { type: "user" as const, content: userInput },
      ]);
      setInputText("");

      // Check if it's a command
      if (commandManager.isCommand(userInput)) {
        try {
          const commandContext = {
            laceUI,
            agent: laceUI?.primaryAgent,
            setConversation,
            addMessage: (msg: ConversationMessage) =>
              setConversation((prev) => [...prev, msg]),
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
            setConversation((prev) => [
              ...prev,
              {
                type: "assistant" as const,
                content,
              },
            ]);
          } else if (result.message) {
            setConversation((prev) => [
              ...prev,
              {
                type: "assistant" as const,
                content: result.message,
              },
            ]);
          }
        } catch (error) {
          setConversation((prev) => [
            ...prev,
            {
              type: "assistant" as const,
              content: `Command error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ]);
        }
        return;
      }

      // Not a command - handle as regular message
      if (!laceUI) {
        setConversation((prev) => [
          ...prev,
          {
            type: "assistant" as const,
            content: "Error: LaceUI not available",
          },
        ]);
        return;
      }

      // Start loading state
      setIsLoading(true);
      setConversation((prev) => [
        ...prev,
        { type: "loading" as const, content: "Assistant is thinking..." },
      ]);

      try {
        // Clear streaming content
        streamingRef.current.content = "";

        // Start streaming after a brief delay
        setTimeout(() => {
          setIsLoading(false);
          setIsStreaming(true);

          // Remove loading message and start streaming
          setConversation((prev) => {
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
          setConversation((prev) => {
            const withoutLoadingOrStreaming = prev.filter(
              (msg) => msg.type !== "loading" && msg.type !== "streaming",
            );
            return [
              ...withoutLoadingOrStreaming,
              {
                type: "assistant" as const,
                content: `Error: ${response.error}`,
              },
            ];
          });
        } else {
          // Streaming complete - convert to assistant message and add agent activities
          setIsStreaming(false);

          setConversation((prev) => {
            const updated = [...prev];
            const lastIndex = updated.length - 1;
            const lastMessage = updated[lastIndex];

            // Replace streaming message with final assistant response
            if (lastMessage && lastMessage.type === "streaming") {
              updated[lastIndex] = {
                type: "assistant" as const,
                content: response.content || streamingRef.current.content,
              };
            }

            // Add agent activities if present
            if (
              response.agentActivities &&
              response.agentActivities.length > 0
            ) {
              updated.push({
                type: "agent_activity" as const,
                summary: `Agent Activity - ${response.agentActivities.length} items`,
                content: response.agentActivities,
                folded: true,
              });
            }

            return updated;
          });

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
        setConversation((prev) => {
          const withoutLoadingOrStreaming = prev.filter(
            (msg) => msg.type !== "loading" && msg.type !== "streaming",
          );
          return [
            ...withoutLoadingOrStreaming,
            {
              type: "assistant" as const,
              content: `Error: ${error.message}`,
            },
          ];
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
          setConversation((prev) => {
            const withoutLoadingOrStreaming = prev.filter(
              (msg) => msg.type !== "loading" && msg.type !== "streaming",
            );
            return [
              ...withoutLoadingOrStreaming,
              {
                type: "assistant" as const,
                content: "Operation cancelled by user (Ctrl+C)",
              },
            ];
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

    // Global Escape handler for aborting processing (but not navigation)
    if (key.escape && (isLoading || isStreaming) && laceUI) {
      const aborted = laceUI.handleAbort();
      if (aborted) {
        // Update UI state to reflect abortion
        setIsLoading(false);
        setIsStreaming(false);
        setConversation((prev) => {
          const withoutLoadingOrStreaming = prev.filter(
            (msg) => msg.type !== "loading" && msg.type !== "streaming",
          );
          return [
            ...withoutLoadingOrStreaming,
            {
              type: "assistant" as const,
              content: "Operation cancelled by user (Esc)",
            },
          ];
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
          setConversation((prev) =>
            prev.map((msg, index) =>
              index === conversation.indexOf(currentMessage) &&
              msg.type === "agent_activity"
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

  return (
    <Box flexDirection="column" flexGrow={1}>
      <ConversationView
        scrollPosition={scrollPosition}
        isNavigationMode={isNavigationMode}
        messages={filteredConversation}
        searchTerm={filterMode === "search" || isSearchMode ? searchTerm : ""}
        searchResults={searchResults}
      />
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
        history={conversation
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
