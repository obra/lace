// ABOUTME: Simplified main Ink application component using component composition
// ABOUTME: Coordinates between specialized components for clean separation of concerns

import React, { useState, useEffect, useRef } from "react";
import { Box, useStdout, useFocusManager } from "ink";
import { createCompletionManager } from "./completion/index.js";
import { CommandManager } from "./commands/CommandManager";
import { getAllCommands } from "./commands/registry";
import { Conversation } from "../conversation/conversation.js";

// Layout Components
import AppLayout from "./components/layout/AppLayout";
import MainContent from "./components/layout/MainContent";

// Message Components
import MessageContainer, { useMessages } from "./components/messages/MessageContainer";
import StreamingMessage from "./components/messages/StreamingMessage";

// Input Components
import GlobalKeyHandler from "./components/input/GlobalKeyHandler";
import NavigationInput from "./components/input/NavigationInput";

// Modal Components
import StatusBar from "./components/StatusBar";
import ToolApprovalModal from "./components/ToolApprovalModal";

// Hooks
import useAppMode from "./hooks/useAppMode";
import useViewState from "./hooks/useViewState";

interface AppProps {
  laceUI?: any; // LaceUI instance passed from parent
  conversation?: Conversation; // Current conversation from lace-ui
}

const App: React.FC<AppProps> = ({ laceUI, conversation }) => {
  const { stdout } = useStdout();
  const { focus } = useFocusManager();
  
  // Use custom hooks for state management
  const appMode = useAppMode();
  const viewState = useViewState();
  
  // Simplified processing state
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolApprovalRequest, setToolApprovalRequest] = useState(null);
  
  // Input and completion management
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const commandManagerRef = useRef<CommandManager | null>(null);
  const completionManagerRef = useRef<any>(null);
  
  // Initialize command manager once
  if (!commandManagerRef.current) {
    const manager = new CommandManager();
    manager.registerAll(getAllCommands());
    commandManagerRef.current = manager;
  }
  
  // Initialize completion manager with command manager
  if (!completionManagerRef.current) {
    completionManagerRef.current = createCompletionManager({
      cwd: process.cwd(),
      history: [],
      commandManager: commandManagerRef.current,
    });
  }
  
  // Search state (remaining centralized for now)
  const [searchResults, setSearchResults] = useState<any[]>([]);
  
  // Global key handler callbacks
  const handleAbort = (): boolean => {
    if (!laceUI) return false;
    const aborted = laceUI.handleAbort();
    if (aborted) {
      setIsLoading(false);
      setIsStreaming(false);
    }
    return aborted;
  };

  const handleCancelledMessage = (message: string) => {
    // This would integrate with MessageContainer
    console.log(message); // Simplified for now
  };

  const handleExitNavigation = () => {
    appMode.exitToNormalMode();
    viewState.resetScrollPosition();
  };

  // Navigation callbacks
  const handleNavigationScroll = (position: number) => {
    viewState.setScrollPosition(position);
  };

  const handleToggleFold = (message: any) => {
    // This would integrate with MessageContainer to toggle fold state
    console.log("Toggle fold for message:", message);
  };

  const handleFilterModeChange = (mode: string) => {
    appMode.setFilterMode(mode as any);
    viewState.resetScrollPosition();
  };

  const handleSearchModeEnter = () => {
    appMode.enterSearchMode();
    appMode.exitToNormalMode(); // Exit navigation mode when entering search
  };

  const handleSearchNavigation = (direction: 'next' | 'prev') => {
    if (searchResults.length === 0) return;
    
    const currentIndex = appMode.searchResultIndex;
    let newIndex;
    
    if (direction === 'next') {
      newIndex = (currentIndex + 1) % searchResults.length;
    } else {
      newIndex = (currentIndex - 1 + searchResults.length) % searchResults.length;
    }
    
    appMode.setSearchResultIndex(newIndex);
    const result = searchResults[newIndex];
    viewState.setScrollPosition(result.messageIndex);
  };

  const handleFocusSearch = () => {
    focus("search-input");
  };

  const handleFocusTextEditor = () => {
    focus("text-editor");
  };

  // Message submission handler
  const handleSubmit = async (inputValue: string) => {
    if (!inputValue.trim() || isLoading || isStreaming) return;

    setInput("");
    setHistory(prev => [...prev, inputValue]);
    
    // Add command handling here
    const isCommand = inputValue.startsWith("/");
    
    if (isCommand) {
      // Handle commands through CommandManager
      const result = await commandManagerRef.current.execute(inputValue, {
        laceUI,
        agent: laceUI?.primaryAgent,
      });
      
      if (result.shouldShowModal) {
        // Handle modal display - this would integrate with modal components
        console.log("Show modal:", result.shouldShowModal);
      }
    } else {
      // Handle regular message submission
      setIsLoading(true);
      
      // This would integrate with LaceUI for actual message processing
      if (laceUI) {
        try {
          await laceUI.submitMessage(inputValue);
        } catch (error) {
          console.error("Error submitting message:", error);
        } finally {
          setIsLoading(false);
        }
      }
    }
  };

  // Set up tool approval callback
  useEffect(() => {
    if (laceUI) {
      laceUI.setToolApprovalUICallback((toolCall: any, riskLevel: any, context: any) => {
        return new Promise((resolve) => {
          setToolApprovalRequest({ toolCall, riskLevel, context, resolve });
        });
      });
    }
  }, [laceUI]);

  return (
    <AppLayout>
      <GlobalKeyHandler
        isLoading={isLoading}
        isStreaming={isStreaming}
        isNavigationMode={appMode.mode === 'navigation'}
        toolApprovalRequest={toolApprovalRequest}
        onAbort={handleAbort}
        onToggleView={viewState.toggleViewMode}
        onExitNavigation={handleExitNavigation}
        onCancelledMessage={handleCancelledMessage}
        onFocusTextEditor={handleFocusTextEditor}
      />
      
      <MessageContainer conversation={conversation}>
        <StreamingMessage
          isStreaming={isStreaming}
          onStreamingChange={setIsStreaming}
        />
        
        <MainContent
          viewMode={viewState.viewMode}
          conversationProps={{
            conversation: [], // This would come from MessageContainer context
            scrollPosition: viewState.scrollPosition,
            isNavigationMode: appMode.mode === 'navigation',
            filterMode: appMode.filterMode,
            searchTerm: appMode.searchTerm,
            searchResults,
          }}
          logViewProps={{
            conversation: [], // This would come from MessageContainer context
            scrollPosition: viewState.scrollPosition,
            isNavigationMode: appMode.mode === 'navigation',
          }}
        />
      </MessageContainer>

      <StatusBar
        isNavigationMode={appMode.mode === 'navigation'}
        scrollPosition={viewState.scrollPosition}
        isLoading={isLoading}
        filterMode={appMode.filterMode}
        isSearchMode={appMode.mode === 'search'}
        terminalWidth={stdout.columns || 100}
        viewMode={viewState.viewMode}
      />

      <NavigationInput
        value={input}
        placeholder="Type your message..."
        focusId="text-editor"
        autoFocus={true}
        onSubmit={handleSubmit}
        onChange={setInput}
        history={history}
        completionManager={completionManagerRef.current}
        
        // Navigation props
        isNavigationMode={appMode.mode === 'navigation'}
        toolApprovalRequest={toolApprovalRequest}
        scrollPosition={viewState.scrollPosition}
        totalMessages={viewState.totalMessages}
        filteredConversation={[]} // This would come from MessageContainer
        filterMode={appMode.filterMode}
        searchResults={searchResults}
        searchResultIndex={appMode.searchResultIndex}
        
        // Navigation callbacks
        onNavigationScroll={handleNavigationScroll}
        onToggleFold={handleToggleFold}
        onFilterModeChange={handleFilterModeChange}
        onSearchModeEnter={handleSearchModeEnter}
        onSearchNavigation={handleSearchNavigation}
        onExitNavigation={handleExitNavigation}
        onFocusSearch={handleFocusSearch}
      />

      {toolApprovalRequest && (
        <ToolApprovalModal 
          toolCall={toolApprovalRequest.toolCall}
          riskLevel={toolApprovalRequest.riskLevel}
          context={toolApprovalRequest.context}
          onApprove={(modifiedCall, comment) => {
            toolApprovalRequest.resolve({ approved: true, modifiedCall, comment });
            setToolApprovalRequest(null);
          }}
          onDeny={(reason) => {
            toolApprovalRequest.resolve({ approved: false, reason });
            setToolApprovalRequest(null);
          }}
          onStop={() => {
            toolApprovalRequest.resolve({ approved: false, reason: "Stopped by user" });
            setToolApprovalRequest(null);
          }}
        />
      )}
    </AppLayout>
  );
};

export default App;