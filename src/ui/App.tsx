// ABOUTME: Main Ink application component for Lace terminal UI
// ABOUTME: Implements full-window layout with ConversationView, StatusBar, and InputBar

import React, { useState, useEffect, useRef } from 'react';
// @ts-expect-error - useInput and useStdout are available at runtime but TypeScript has module resolution issues
import { Box, useInput, useStdout } from 'ink';
// Remove fullscreen-ink import from here - will be used in lace-ui.ts instead
import ConversationView from './components/ConversationView';
import StatusBar from './components/StatusBar';
import InputBar from './components/InputBar';
import ToolApprovalModal from './components/ToolApprovalModal';

type ConversationMessage = 
  | { type: 'user'; content: string }
  | { type: 'assistant'; content: string }
  | { type: 'loading'; content: string }
  | { type: 'streaming'; content: string; isStreaming: boolean }
  | { type: 'agent_activity'; summary: string; content: string[]; folded: boolean };

interface AppProps {
  laceUI?: any; // LaceUI instance passed from parent
}

const App: React.FC<AppProps> = ({ laceUI }) => {
  const { stdout } = useStdout();
  const [isNavigationMode, setIsNavigationMode] = useState(false);
  const [scrollPosition, setScrollPosition] = useState(0);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [filterMode, setFilterMode] = useState<'all' | 'conversation' | 'search'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchResultIndex, setSearchResultIndex] = useState(0);
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [tokenUsage, setTokenUsage] = useState({ used: 0, total: 200000 });
  const [modelName, setModelName] = useState('claude-3-5-sonnet');
  const streamingRef = useRef<{ content: string }>({ content: '' });
  const [ctrlCCount, setCtrlCCount] = useState(0);
  const ctrlCTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [toolApprovalRequest, setToolApprovalRequest] = useState<{
    toolCall: any;
    riskLevel: 'low' | 'medium' | 'high';
    context?: any;
    resolve: (result: any) => void;
  } | null>(null);
  
  // Setup streaming callback and tool approval for laceUI
  useEffect(() => {
    if (laceUI) {
      laceUI.uiRef = {
        handleStreamingToken: (token: string) => {
          streamingRef.current.content += token;
          
          // Update the streaming message with new content
          setConversation(prev => {
            const updated = [...prev];
            const lastMessage = updated[updated.length - 1];
            if (lastMessage && lastMessage.type === 'streaming') {
              updated[updated.length - 1] = {
                ...lastMessage,
                content: streamingRef.current.content
              };
            }
            return updated;
          });
        },
        requestToolApproval: (toolCall: any, riskLevel: 'low' | 'medium' | 'high', context?: any) => {
          return new Promise((resolve) => {
            setToolApprovalRequest({ toolCall, riskLevel, context, resolve });
          });
        }
      };
    }
  }, [laceUI]);
  const filterMessages = (messages: ConversationMessage[]) => {
    switch (filterMode) {
      case 'conversation':
        return messages.filter(msg => msg.type === 'user' || msg.type === 'assistant');
      case 'search':
        if (!searchTerm.trim()) return messages;
        return messages.filter(msg => {
          const content = msg.type === 'agent_activity' ? msg.summary + ' ' + msg.content.join(' ') : msg.content;
          return content.toLowerCase().includes(searchTerm.toLowerCase());
        });
      case 'all':
      default:
        return messages;
    }
  };

  const findSearchResults = (messages: ConversationMessage[], term: string) => {
    if (!term.trim()) return [];
    const results: { messageIndex: number; message: ConversationMessage }[] = [];
    
    messages.forEach((msg, index) => {
      const content = msg.type === 'agent_activity' 
        ? msg.summary + ' ' + msg.content.join(' ') 
        : msg.content;
      
      if (content.toLowerCase().includes(term.toLowerCase())) {
        results.push({ messageIndex: index, message: msg });
      }
    });
    
    return results;
  };

  const filteredConversation = filterMessages(conversation);
  const searchResults = isSearchMode ? findSearchResults(conversation, searchTerm) : [];
  const totalMessages = filteredConversation.length;

  const submitMessage = async () => {
    if (inputText.trim() && !isLoading && !isStreaming && laceUI) {
      const userInput = inputText.trim();
      
      // Add user message
      setConversation(prev => [...prev, { type: 'user' as const, content: userInput }]);
      setInputText('');
      
      // Start loading state
      setIsLoading(true);
      setConversation(prev => [...prev, { type: 'loading' as const, content: 'Assistant is thinking...' }]);
      
      try {
        // Clear streaming content
        streamingRef.current.content = '';
        
        // Start streaming after a brief delay
        setTimeout(() => {
          setIsLoading(false);
          setIsStreaming(true);
          
          // Remove loading message and start streaming
          setConversation(prev => {
            const withoutLoading = prev.slice(0, -1);
            return [...withoutLoading, { type: 'streaming' as const, content: '', isStreaming: true }];
          });
        }, 500);
        
        // Get real agent response
        const response = await laceUI.handleMessage(userInput);
        
        if (response.error) {
          // Handle error
          setIsLoading(false);
          setIsStreaming(false);
          setConversation(prev => {
            const withoutLoadingOrStreaming = prev.filter(msg => 
              msg.type !== 'loading' && msg.type !== 'streaming'
            );
            return [...withoutLoadingOrStreaming, { 
              type: 'assistant' as const, 
              content: `Error: ${response.error}` 
            }];
          });
        } else {
          // Streaming complete - convert to assistant message and add agent activities
          setIsStreaming(false);
          
          setConversation(prev => {
            const updated = [...prev];
            const lastIndex = updated.length - 1;
            const lastMessage = updated[lastIndex];
            
            // Replace streaming message with final assistant response
            if (lastMessage && lastMessage.type === 'streaming') {
              updated[lastIndex] = {
                type: 'assistant' as const,
                content: response.content || streamingRef.current.content
              };
            }
            
            // Add agent activities if present
            if (response.agentActivities && response.agentActivities.length > 0) {
              updated.push({
                type: 'agent_activity' as const,
                summary: `Agent Activity - ${response.agentActivities.length} items`,
                content: response.agentActivities,
                folded: true
              });
            }
            
            return updated;
          });
          
          // Update token usage if available
          if (response.usage) {
            setTokenUsage({
              used: response.usage.total_tokens || response.usage.totalTokens || 0,
              total: 200000 // Default context window
            });
          }
        }
      } catch (error) {
        setIsLoading(false);
        setIsStreaming(false);
        setConversation(prev => {
          const withoutLoadingOrStreaming = prev.filter(msg => 
            msg.type !== 'loading' && msg.type !== 'streaming'
          );
          return [...withoutLoadingOrStreaming, { 
            type: 'assistant' as const, 
            content: `Error: ${error.message}` 
          }];
        });
      }
    }
  };

  const handleToolApproval = (modifiedCall?: any, comment?: string) => {
    if (toolApprovalRequest) {
      const result = {
        approved: true,
        reason: comment ? 'User approved with comment' : 'User approved',
        modifiedCall: modifiedCall || toolApprovalRequest.toolCall,
        postExecutionComment: comment
      };
      toolApprovalRequest.resolve(result);
      setToolApprovalRequest(null);
    }
  };

  const handleToolDeny = (reason?: string) => {
    if (toolApprovalRequest) {
      const result = {
        approved: false,
        reason: reason || 'User denied',
        modifiedCall: null
      };
      toolApprovalRequest.resolve(result);
      setToolApprovalRequest(null);
    }
  };

  const handleToolStop = () => {
    if (toolApprovalRequest) {
      const result = {
        approved: false,
        reason: 'User requested stop',
        modifiedCall: null,
        shouldStop: true
      };
      toolApprovalRequest.resolve(result);
      setToolApprovalRequest(null);
    }
  };

  useInput((input, key) => {
    // If tool approval modal is open, let it handle input
    if (toolApprovalRequest) {
      return;
    }

    if (key.ctrl && input === 'c') {
      setCtrlCCount(prev => prev + 1);
      
      if (ctrlCCount === 0) {
        // First Ctrl+C - show warning and start timeout
        console.log('\nPress Ctrl+C again to exit...');
        
        // Clear any existing timeout
        if (ctrlCTimeoutRef.current) {
          clearTimeout(ctrlCTimeoutRef.current);
        }
        
        // Reset count after 2 seconds
        ctrlCTimeoutRef.current = setTimeout(() => {
          setCtrlCCount(0);
        }, 2000);
      } else {
        // Second Ctrl+C - exit immediately
        process.exit(0);
      }
      return;
    }

    if (isSearchMode) {
      // Search mode: handle search input and navigation
      if (key.escape || input === 'q') {
        // Escape or q to exit search mode
        setIsSearchMode(false);
        setSearchTerm('');
        setFilterMode('all');
        setSearchResultIndex(0);
      } else if (key.return) {
        // Enter to execute search
        if (searchTerm.trim()) {
          setFilterMode('search');
          setIsSearchMode(false);
          setIsNavigationMode(true);
          setScrollPosition(0);
        }
      } else if (key.backspace || key.delete) {
        // Handle backspace in search
        setSearchTerm(prev => prev.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta && input.length === 1) {
        // Handle character input in search
        setSearchTerm(prev => prev + input);
      } else if (input === 'n' && searchResults.length > 0) {
        // Navigate to next search result
        setSearchResultIndex(prev => (prev + 1) % searchResults.length);
        const nextResult = searchResults[(searchResultIndex + 1) % searchResults.length];
        setScrollPosition(nextResult.messageIndex);
      } else if (input === 'N' && searchResults.length > 0) {
        // Navigate to previous search result
        setSearchResultIndex(prev => (prev - 1 + searchResults.length) % searchResults.length);
        const prevResult = searchResults[(searchResultIndex - 1 + searchResults.length) % searchResults.length];
        setScrollPosition(prevResult.messageIndex);
      }
    } else if (!isNavigationMode && !isLoading && !isStreaming) {
      // Input mode: handle text input and submission (disabled during loading/streaming)
      if (key.return) {
        if (inputText.trim()) {
          // Submit message if input has content
          submitMessage();
        } else {
          // Enter navigation mode if input is empty
          setIsNavigationMode(true);
          setScrollPosition(0);
        }
      } else if (key.backspace || key.delete) {
        // Handle backspace/delete
        setInputText(prev => prev.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta && input.length === 1) {
        // Handle regular character input
        setInputText(prev => prev + input);
      }
    } else if (!isNavigationMode && (isLoading || isStreaming)) {
      // During loading/streaming, only allow entering navigation mode with empty input
      if (key.return && !inputText.trim()) {
        setIsNavigationMode(true);
        setScrollPosition(0);
      }
    } else {
      // Navigation mode
      if (key.escape) {
        // Escape to exit navigation mode
        setIsNavigationMode(false);
        setScrollPosition(0);
      } else if (input === 'q') {
        // q key as alternative to escape (vim-style)
        setIsNavigationMode(false);
        setScrollPosition(0);
      } else if (input === 'j' || key.downArrow) {
        // j or down arrow to scroll down
        setScrollPosition(prev => Math.min(prev + 1, totalMessages - 1));
      } else if (input === 'k' || key.upArrow) {
        // k or up arrow to scroll up
        setScrollPosition(prev => Math.max(prev - 1, 0));
      } else if (input === ' ') {
        // Space key to toggle fold state of current message
        const currentMessage = filteredConversation[scrollPosition];
        if (currentMessage && currentMessage.type === 'agent_activity') {
          setConversation(prev => prev.map((msg, index) => 
            index === conversation.indexOf(currentMessage) && msg.type === 'agent_activity'
              ? { ...msg, folded: !msg.folded }
              : msg
          ));
        }
      } else if (input === 'c') {
        // c key for conversation-only mode
        setFilterMode('conversation');
        setScrollPosition(0);
      } else if (input === 'a') {
        // a key for show-all mode
        setFilterMode('all');
        setScrollPosition(0);
      } else if (input === '/') {
        // / key to enter search mode
        setIsSearchMode(true);
        setSearchTerm('');
        setIsNavigationMode(false);
      } else if (input === 'n' && filterMode === 'search' && searchResults.length > 0) {
        // n key to navigate to next search result
        setSearchResultIndex(prev => (prev + 1) % searchResults.length);
        const nextResult = searchResults[(searchResultIndex + 1) % searchResults.length];
        setScrollPosition(nextResult.messageIndex);
      } else if (input === 'N' && filterMode === 'search' && searchResults.length > 0) {
        // N key to navigate to previous search result  
        setSearchResultIndex(prev => (prev - 1 + searchResults.length) % searchResults.length);
        const prevResult = searchResults[(searchResultIndex - 1 + searchResults.length) % searchResults.length];
        setScrollPosition(prevResult.messageIndex);
      }
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      <ConversationView 
        scrollPosition={scrollPosition} 
        isNavigationMode={isNavigationMode} 
        messages={filteredConversation}
        searchTerm={filterMode === 'search' || isSearchMode ? searchTerm : ''}
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
      <InputBar 
        isNavigationMode={isNavigationMode} 
        inputText={isSearchMode ? searchTerm : inputText}
        showCursor={true}
        isSearchMode={isSearchMode}
      />
      
      {/* Tool Approval Modal */}
      {toolApprovalRequest && (
        <Box position="absolute" top={2} left={0} right={0}>
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

export default App;