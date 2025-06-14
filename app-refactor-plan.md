# App.tsx Refactoring Plan (React Best Practices)

## Analysis Summary

After analyzing `src/ui/App.tsx`, I've identified opportunities to break down this 897-line God Component into clean, well-factored, self-contained components following React best practices and single responsibility principle.

### Key Issues Found

1. **God Component Pattern**: App.tsx tries to do everything - state management, message handling, UI coordination, input handling, modal management, etc.

2. **Massive State Management**: 20+ useState hooks managing different concerns in one component

3. **Mixed Responsibilities**: 
   - Message formatting and display logic should be in modal components
   - Input handling and navigation should be closer to input components
   - Tool approval coordination should be in tool approval components
   - Search functionality should be in search components
   - Command execution should be in command components
   - Streaming management should be in message components

4. **Utility Functions Inside Component**: Large formatting functions should be extracted to where they're used

5. **Complex Event Handling**: 130+ lines of input handling logic mixed with component logic

## Refactoring Strategy (React Best Practices)

### 1. Move Logic Into Modal Components (Priority: High)
Instead of centralizing modal formatting, move logic into self-contained modal components:

**Files**: 
- `src/ui/components/modals/StatusModal.tsx`
- `src/ui/components/modals/ActivityModal.tsx`
- `src/ui/components/modals/ToolsModal.tsx`
- `src/ui/components/modals/MemoryModal.tsx`
- `src/ui/components/modals/ApprovalModal.tsx`
- `src/ui/components/modals/HelpModal.tsx`
- `src/ui/components/modals/CommandResultModal.tsx`

**What moves**:
- Lines 135-287: Modal formatting logic moves INTO each modal component
- Each modal becomes self-contained with its own formatting logic

```typescript
// StatusModal.tsx
export const StatusModal: React.FC<{ data: StatusData; onClose: () => void }> = ({ data, onClose }) => {
  const formatContent = (data: StatusData): string => {
    // Formatting logic lives here, close to where it's used
    let content = "🤖 Agent Status:\n";
    content += `  Role: ${data.agentInfo.role}\n`;
    // ... rest of formatting
    return content;
  };

  return (
    <Modal onClose={onClose}>
      {formatContent(data)}
    </Modal>
  );
};
```

### 2. Move Input Logic to Enhanced Input Components (Priority: High)
Instead of centralizing all input logic, enhance existing input components:

**Files**: 
- `src/ui/components/input/NavigationInput.tsx` (enhance existing ShellInput)
- `src/ui/components/input/SearchInput.tsx`
- `src/ui/components/input/GlobalKeyHandler.tsx`

**What moves**:
- Lines 669-799: Input handling logic moves into dedicated input components
- Navigation mode handling goes into NavigationInput component
- Search logic goes into SearchInput component
- Global shortcuts go into GlobalKeyHandler component

```typescript
// NavigationInput.tsx (enhanced ShellInput)
export const NavigationInput: React.FC<NavigationInputProps> = ({
  isNavigationMode,
  onNavigationChange,
  // ... other props
}) => {
  // Navigation-specific input handling lives here
  useInput((input, key) => {
    if (isNavigationMode) {
      // Handle navigation keys: j/k, escape, space, etc.
      // This logic was previously in App.tsx lines 733-798
    }
  });

  return <ShellInput {...enhancedProps} />;
};

// SearchInput.tsx  
export const SearchInput: React.FC<SearchInputProps> = ({ onSearch }) => {
  const [searchTerm, setSearchTerm] = useState("");
  
  const handleSearch = (term: string) => {
    // Search logic lives here, close to the search input
    onSearch(term);
  };

  return <input value={searchTerm} onChange={...} onSubmit={handleSearch} />;
};

// GlobalKeyHandler.tsx
export const GlobalKeyHandler: React.FC<GlobalKeyProps> = ({ 
  onAbort, 
  onToggleView,
  isProcessing 
}) => {
  useInput((input, key) => {
    // Global shortcuts: Ctrl+C, Ctrl+L, Escape
    // This logic was previously in App.tsx lines 669-731
  });

  return null; // Invisible component that just handles global keys
};
```

### 3. Move Message Logic to Message Components (Priority: High)
Create dedicated message management components:

**Files**: 
- `src/ui/components/messages/MessageContainer.tsx`
- `src/ui/components/messages/StreamingMessage.tsx`
- `src/ui/components/messages/MessageSubmissionHandler.tsx`

**What moves**:
- Lines 330-357: Message loading logic → MessageContainer
- Lines 472-622: Message submission logic → MessageSubmissionHandler  
- Lines 320-322 + streaming logic → StreamingMessage

```typescript
// MessageContainer.tsx
export const MessageContainer: React.FC<MessageContainerProps> = ({ 
  conversation, 
  children 
}) => {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  
  // Message loading and management logic lives here
  useEffect(() => {
    // Load existing messages logic (lines 336-358)
  }, [conversation]);

  const addMessage = (message: ConversationMessage) => {
    setMessages(prev => [...prev, message]);
  };

  return (
    <MessageContext.Provider value={{ messages, addMessage }}>
      {children}
    </MessageContext.Provider>
  );
};

// StreamingMessage.tsx
export const StreamingMessage: React.FC<StreamingProps> = () => {
  const streamingRef = useRef<{ content: string }>({ content: "" });
  const [isStreaming, setIsStreaming] = useState(false);
  
  // Streaming logic lives here (lines 320-322 + streaming handlers)
  
  return isStreaming ? <div>{streamingRef.current.content}</div> : null;
};
```

### 4. Enhanced Tool Approval Component (Priority: Medium)
Enhance existing ToolApprovalModal to be fully self-contained:

**File**: `src/ui/components/ToolApprovalModal.tsx` (enhance existing)

**What moves**:
- Lines 323-328: Tool approval state → into ToolApprovalModal
- Lines 624-666: Tool approval handlers → into ToolApprovalModal
- Lines 380-418: Tool approval setup logic → into ToolApprovalModal

```typescript
// Enhanced ToolApprovalModal.tsx
export const ToolApprovalModal: React.FC<ToolApprovalProps> = ({ 
  laceUI,
  onComplete 
}) => {
  const [toolApprovalRequest, setToolApprovalRequest] = useState<ToolApprovalRequest | null>(null);
  
  // All tool approval logic lives in this component
  const handleApproval = (modifiedCall?: any, comment?: string) => {
    // Logic from lines 624-637
  };

  // Setup effect for laceUI integration
  useEffect(() => {
    if (laceUI) {
      laceUI.setToolApprovalUICallback((toolCall, riskLevel, context) => {
        return new Promise((resolve) => {
          setToolApprovalRequest({ toolCall, riskLevel, context, resolve });
        });
      });
    }
  }, [laceUI]);

  if (!toolApprovalRequest) return null;

  return (
    <Box position="absolute" marginTop={2}>
      {/* Existing modal content */}
    </Box>
  );
};
```

### 5. Create Focused State Management Hooks (Priority: Medium)
Only create hooks for truly cross-cutting concerns:

**Files**: 
- `src/ui/hooks/useAppMode.ts` (navigation/search/normal modes)
- `src/ui/hooks/useViewState.ts` (scroll position, view mode)

```typescript
// useAppMode.ts - Only for mode coordination
export const useAppMode = () => {
  const [mode, setMode] = useState<'normal' | 'navigation' | 'search'>('normal');
  const [filterMode, setFilterMode] = useState<'all' | 'conversation' | 'search'>('all');
  
  const enterNavigationMode = () => setMode('navigation');
  const enterSearchMode = () => setMode('search');
  const exitToNormalMode = () => setMode('normal');
  
  return { mode, filterMode, enterNavigationMode, enterSearchMode, exitToNormalMode };
};

// useViewState.ts - Only for view coordination  
export const useViewState = () => {
  const [scrollPosition, setScrollPosition] = useState(0);
  const [viewMode, setViewMode] = useState<'conversation' | 'log'>('conversation');
  
  return { scrollPosition, setScrollPosition, viewMode, setViewMode };
};
```

### 6. Simple Layout Components (Priority: Medium)
Create simple presentational layout components:

**Files**:
- `src/ui/components/layout/AppLayout.tsx`
- `src/ui/components/layout/MainContent.tsx`

```typescript
// AppLayout.tsx - Simple layout component
export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  return (
    <Box flexDirection="column" flexGrow={1}>
      {children}
    </Box>
  );
};

// MainContent.tsx - Simple content switcher
export const MainContent: React.FC<MainContentProps> = ({
  viewMode,
  conversationProps,
  logViewProps
}) => {
  return viewMode === 'conversation' ? (
    <ConversationView {...conversationProps} />
  ) : (
    <DetailedLogView {...logViewProps} />
  );
};
```

### 7. Extract Log Processing Utility (Priority: Low)
Move log extraction to where it's used:

**File**: `src/ui/components/DetailedLogView.tsx` (enhance existing)

**What moves**:
- Lines 56-133: `extractLogEntries` function → into DetailedLogView component

```typescript
// Enhanced DetailedLogView.tsx
export const DetailedLogView: React.FC<DetailedLogViewProps> = ({ 
  conversation,
  scrollPosition,
  isNavigationMode 
}) => {
  // Move extractLogEntries logic into this component
  const extractLogEntries = useCallback((conversation: ConversationMessage[]): DetailedLogEntry[] => {
    // Logic from lines 56-133 lives here, close to where it's used
  }, []);

  const logEntries = useMemo(() => 
    extractLogEntries(conversation), 
    [conversation, extractLogEntries]
  );

  return (
    // Existing DetailedLogView implementation using logEntries
  );
};
```

### 8. Simplified App Component (Priority: High)
**File**: `src/ui/App.tsx`

Focus only on component composition - no business logic:

```typescript
const App: React.FC<AppProps> = ({ laceUI, conversation }) => {
  const { stdout } = useStdout();
  
  // Only minimal hooks for cross-cutting concerns
  const appMode = useAppMode();
  const viewState = useViewState();
  
  // Simple loading state (since components manage their own state)
  const [isLoading, setIsLoading] = useState(false);
  
  return (
    <AppLayout>
      <GlobalKeyHandler 
        onToggleView={() => viewState.setViewMode(prev => prev === 'conversation' ? 'log' : 'conversation')}
        onAbort={() => laceUI?.handleAbort()}
        isProcessing={isLoading}
      />
      
      <MessageContainer conversation={conversation}>
        <MainContent
          viewMode={viewState.viewMode}
          conversationProps={{
            scrollPosition: viewState.scrollPosition,
            isNavigationMode: appMode.mode === 'navigation',
            // Conversation gets messages from MessageContainer context
          }}
          logViewProps={{
            scrollPosition: viewState.scrollPosition,
            isNavigationMode: appMode.mode === 'navigation',
            // Log view gets conversation from MessageContainer context
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
        // Other props come from component's own state management
      />

      <NavigationInput
        isNavigationMode={appMode.mode === 'navigation'}
        onNavigationChange={appMode.enterNavigationMode}
        onSubmit={(input) => {
          // Simple message submission - component handles the rest
          setIsLoading(true);
        }}
        completionManager={/* created locally or passed down */}
      />

      <ToolApprovalModal 
        laceUI={laceUI}
        onComplete={() => {/* handled by component itself */}}
      />
    </AppLayout>
  );
};
```

## Benefits (React Best Practices)

- **Co-location**: Logic lives close to where it's used (modals handle their own formatting, inputs handle their own logic)
- **Self-contained Components**: Each component manages its own state and behavior
- **Minimal Prop Drilling**: Components get what they need directly, not passed through multiple layers
- **Easy Testing**: Components can be tested in isolation with their own logic
- **Better Performance**: No unnecessary re-renders from centralized state management
- **Clearer Dependencies**: Each component's dependencies are explicit and minimal
- **React Patterns**: Uses Context for cross-cutting concerns, component state for local concerns

## Implementation Approach (React Best Practices)

1. **Move logic into components first** - Start with modals and input components that can be self-contained
2. **Create minimal hooks** - Only for truly cross-cutting state (mode, view state)
3. **Use React Context sparingly** - Only for data that truly needs to be shared (messages)
4. **Enhance existing components** - Build on what's already there rather than creating new abstractions
5. **No backward compatibility constraints** - Can break existing interfaces for better design

## Files to Create/Modify

### NEW Files (Self-contained Components):
1. `src/ui/components/modals/StatusModal.tsx`
2. `src/ui/components/modals/ActivityModal.tsx`
3. `src/ui/components/modals/ToolsModal.tsx`
4. `src/ui/components/modals/MemoryModal.tsx`
5. `src/ui/components/modals/ApprovalModal.tsx`
6. `src/ui/components/modals/HelpModal.tsx`
7. `src/ui/components/modals/CommandResultModal.tsx`
8. `src/ui/components/input/NavigationInput.tsx`
9. `src/ui/components/input/SearchInput.tsx`
10. `src/ui/components/input/GlobalKeyHandler.tsx`
11. `src/ui/components/messages/MessageContainer.tsx`
12. `src/ui/components/messages/StreamingMessage.tsx`
13. `src/ui/components/messages/MessageSubmissionHandler.tsx`
14. `src/ui/components/layout/AppLayout.tsx`
15. `src/ui/components/layout/MainContent.tsx`

### NEW Files (Minimal Hooks for Cross-cutting Concerns):
16. `src/ui/hooks/useAppMode.ts`
17. `src/ui/hooks/useViewState.ts`

### ENHANCED Files (Add logic to existing components):
18. `src/ui/components/ToolApprovalModal.tsx` - Make fully self-contained
19. `src/ui/components/DetailedLogView.tsx` - Add log extraction logic
20. `src/ui/components/ShellInput.tsx` - Enhance with navigation logic or create NavigationInput wrapper

### MODIFIED Files:
21. `src/ui/App.tsx` - Simplified to minimal composition (~100-150 lines vs 897)

## Validation

- **Functionality preserved** but interfaces can change for better design
- **Performance improved** through better state co-location
- **Type safety improved** with focused component interfaces
- **~700+ lines of code removed** from main App component
- **React best practices followed** - components own their logic, minimal prop drilling, appropriate use of Context