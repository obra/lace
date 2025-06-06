// ABOUTME: Main Ink application component for Lace terminal UI
// ABOUTME: Implements full-window layout with ConversationView, StatusBar, and InputBar

import React, { useState, useEffect, useRef } from 'react';
// @ts-expect-error - useStdout is available at runtime but TypeScript has module resolution issues
import { Box, useStdout } from 'ink';
// Remove fullscreen-ink import from here - will be used in lace-ui.ts instead
import ConversationView from './components/ConversationView';
import StatusBar from './components/StatusBar';
import TextEditorInput from './components/TextEditorInput';
import ToolApprovalModal from './components/ToolApprovalModal';
import { useInput, useFocus, useFocusManager } from 'ink';

type ConversationMessage = 
  | { type: 'user'; content: string }
  | { type: 'assistant'; content: string }
  | { type: 'loading'; content: string }
  | { type: 'streaming'; content: string; isStreaming: boolean }
  | { type: 'agent_activity'; summary: string; content: string[]; folded: boolean };

interface AppProps {
  laceUI?: any; // LaceUI instance passed from parent
}

const AppInner: React.FC<AppProps> = ({ laceUI }) => {
  const { stdout } = useStdout();
  const { focus } = useFocusManager();
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
      const uiCallback = (toolCall: any, riskLevel: 'low' | 'medium' | 'high', context?: any) => {
        return new Promise((resolve) => {
          setToolApprovalRequest({ toolCall, riskLevel, context, resolve });
        });
      };

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
        requestToolApproval: uiCallback
      };

      // Set the UI callback on the tool approval manager
      laceUI.setToolApprovalUICallback(uiCallback);
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

  const submitMessage = async (inputValue?: string) => {
    const userInput = (inputValue || inputText).trim();
    if (userInput && !isLoading && !isStreaming && laceUI) {
      
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
      // Return focus to text editor
      focus('text-editor');
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
      // Return focus to text editor
      focus('text-editor');
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
      // Return focus to text editor
      focus('text-editor');
    }
  };

  // Global input handlers using regular useInput hook
  useInput((input, key) => {
    // Global Ctrl+C handler (always active)
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
      return; // Always handle Ctrl+C
    }

    // Navigation mode handlers (only when navigation is active)
    if (isNavigationMode && !toolApprovalRequest) {
      if (key.escape || input === 'q') {
        // Exit navigation mode
        setIsNavigationMode(false);
        setScrollPosition(0);
        setActiveInput('text-editor');
      } else if (input === 'j' || key.downArrow) {
        // Scroll down
        setScrollPosition(prev => Math.min(prev + 1, totalMessages - 1));
      } else if (input === 'k' || key.upArrow) {
        // Scroll up
        setScrollPosition(prev => Math.max(prev - 1, 0));
      } else if (input === ' ') {
        // Toggle fold state
        const currentMessage = filteredConversation[scrollPosition];
        if (currentMessage && currentMessage.type === 'agent_activity') {
          setConversation(prev => prev.map((msg, index) => 
            index === conversation.indexOf(currentMessage) && msg.type === 'agent_activity'
              ? { ...msg, folded: !msg.folded }
              : msg
          ));
        }
      } else if (input === 'c') {
        // Conversation filter mode
        setFilterMode('conversation');
        setScrollPosition(0);
      } else if (input === 'a') {
        // Show all mode
        setFilterMode('all');
        setScrollPosition(0);
      } else if (input === '/') {
        // Enter search mode
        setIsSearchMode(true);
        setSearchTerm('');
        setIsNavigationMode(false);
        focus('search-input');
      } else if (input === 'n' && filterMode === 'search' && searchResults.length > 0) {
        // Next search result
        setSearchResultIndex(prev => (prev + 1) % searchResults.length);
        const nextResult = searchResults[(searchResultIndex + 1) % searchResults.length];
        setScrollPosition(nextResult.messageIndex);
      } else if (input === 'N' && filterMode === 'search' && searchResults.length > 0) {
        // Previous search result  
        setSearchResultIndex(prev => (prev - 1 + searchResults.length) % searchResults.length);
        const prevResult = searchResults[(searchResultIndex - 1 + searchResults.length) % searchResults.length];
        setScrollPosition(prevResult.messageIndex);
      }
      return; // Navigation mode consumes all input
    }
  });

  // Handle mode transitions with proper focus coordination
  useEffect(() => {
    if (toolApprovalRequest) {
      // Tool approval has highest priority
      focus('tool-approval');
    } else if (isSearchMode) {
      focus('search-input');
    } else {
      focus('text-editor');
    }
  }, [isSearchMode, toolApprovalRequest, focus]);

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
      <TextEditorInput 
        value={isSearchMode ? searchTerm : inputText}
        placeholder={isSearchMode ? 'Search...' : 'Type your message...'}
        focusId={isSearchMode ? 'search-input' : 'text-editor'}
        autoFocus={!isSearchMode}
        onSubmit={isSearchMode ? 
          (searchValue) => {
            if (searchValue.trim()) {
              setFilterMode('search');
              setIsSearchMode(false);
              setIsNavigationMode(true);
              setScrollPosition(0);
            }
          } : 
          submitMessage
        }
        onChange={isSearchMode ? setSearchTerm : setInputText}
        onCommandCompletion={(prefix) => {
          // Use single source of truth from console command registry
          return laceUI ? laceUI.getCommandCompletions(prefix) : [];
        }}
        onFileCompletion={async (prefix) => {
          // Use real file system completion via file tool
          return laceUI ? await laceUI.getFileCompletions(prefix) : [];
        }}
        history={conversation.filter(msg => msg.type === 'user').map(msg => msg.content).slice(-10)}
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

// Main App component using Ink's built-in focus management
const App: React.FC<AppProps> = (props) => {
  return <AppInner {...props} />;
};

export default App;