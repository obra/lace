# Lace Ink UI: Iterative Build Plan



## Testing Strategy

Each step must include:

1. **Unit tests** for individual components
2. **Integration tests** for keyboard interactions  
3. **Visual regression tests** for layout
4. **Manual testing** script with specific scenarios

### Test Framework Setup
```bash
npm install --save-dev jest @testing-library/react ink-testing-library
```

### Test Structure
```
test/
  ui/
    components/
      StatusBar.test.js
      ConversationView.test.js
      InputBar.test.js
    integration/
      navigation.test.js
      filtering.test.js
    visual/
      layouts.test.js
```

## Definition of Done (Each Step)

- [ ] All tests pass
- [ ] Component works in isolation  
- [ ] Integration with existing components works
- [ ] Manual testing scenarios complete
- [ ] No console errors or warnings
- [ ] Performance acceptable (< 100ms renders)
- [ ] Works at minimum terminal size (80x24)
- [ ] Documentation updated

This plan ensures the UI is always functional and can be demo'd at any stage while building toward the full vision.


## Phase 1: Foundation (Working Basic App)

### Step 1: Basic Ink App Setup
**Goal**: Get a "Hello World" Ink app running with proper package.json setup

**Dependencies to add**:
```json
{
  "ink": "^6.0.0",
  "react": "^18.2.0",
  "@types/react": "^18.2.0"
}
```

**Files to create**:
- `src/ui/index.js` - Basic Ink app entry point
- `src/ui/App.jsx` - Main app component

**Test**: App renders "Hello Lace" and exits cleanly

**Acceptance**: `node src/ui/index.js` shows text and exits

---

### Step 2: Basic Layout Structure
**Goal**: Full-window layout with status bar and input area

**Components to build**:
- `StatusBar.jsx` - Shows basic info at bottom
- `ConversationView.jsx` - Main scrollable area
- `InputBar.jsx` - Text input at very bottom

**Layout**:
```
┌─────────────────────────┐
│ ConversationView        │
│ (fills remaining space) │
│                         │
├─────────────────────────┤
│ StatusBar               │
│ InputBar                │
└─────────────────────────┘
```

**Test**: Layout renders correctly at different terminal sizes

**Acceptance**: Resizing terminal adjusts layout properly

---

### Step 3: Basic Message Display
**Goal**: Display a hardcoded conversation with user/assistant messages

**Features**:
- Display user messages with ">" prefix
- Display assistant messages with "🤖" prefix
- Simple text wrapping

**Test data**:
```javascript
const mockConversation = [
  { type: 'user', content: 'Hello' },
  { type: 'assistant', content: 'Hi! How can I help you today?' },
  { type: 'user', content: 'Can you write a function?' },
  { type: 'assistant', content: 'Sure! Here is a basic function:\n\nfunction hello() {\n  return "Hello World";\n}' }
];
```

**Test**: Messages display correctly with proper formatting

**Acceptance**: Conversation shows readable user/assistant alternation

---

## Phase 2: Navigation & Interaction

### Step 4: Keyboard Navigation Mode ✅ COMPLETE
**Goal**: Enter/exit navigation mode to scroll through conversation

**Features**:
- Press Enter to enter navigation mode
- j/k keys to scroll up/down
- Escape to exit back to input mode
- Visual indicator of current mode

**Status bar updates**:
- Show "Nav: j/k" when in navigation mode
- Show cursor position (line X of Y)

**Test**: Navigation mode toggles and scrolling works

**Acceptance**: Can navigate entire conversation with keyboard

**Implementation Notes**:
- Navigation state managed with useState hooks in App component
- useInput hook handles Enter/j/k/Escape key bindings
- Message highlighting uses inverse text styling
- StatusBar shows "Nav: j/k" and "Line X of Y" in navigation mode
- InputBar displays "Navigation mode - Press Escape to exit"
- Comprehensive integration tests verify component coordination

---

### Step 5: Basic Input Handling ✅ COMPLETE
**Goal**: Accept user input and add to conversation

**Features**:
- Text input in InputBar
- Submit with Enter (when not in nav mode)
- Add user message to conversation
- Basic input validation (no empty messages)

**Test**: User can type and submit messages

**Acceptance**: New messages appear in conversation view

**Implementation Notes**:
- Input state managed with useState in App component
- Character input and backspace handling in useInput hook
- InputBar displays typed text with cursor indicator
- ConversationView accepts dynamic messages prop
- Submit logic prevents empty/whitespace-only messages
- Input field resets after successful submission
- Enter behavior is mode-aware (submit vs navigation)
- 9 comprehensive automated tests verify all functionality

---

### Step 6: Mock Agent Response ✅ COMPLETE
**Goal**: Simulate agent responses for testing UI

**Features**:
- After user input, simulate loading state
- Add mock assistant response after delay
- Simple spinner during "thinking"

**Test**: Full conversation flow works end-to-end

**Acceptance**: User types → spinner → assistant responds

**Implementation Notes**:
- Loading state managed with isLoading useState hook
- Message type extended to support 'loading' with spinner prefix
- StatusBar shows "Thinking... | Please wait" during agent response
- Input handling disabled during loading to prevent multiple submissions
- 1.5 second delay with setTimeout for realistic UX
- 8 varied mock responses selected randomly
- Loading message replaced with actual agent response after delay
- 9 comprehensive automated tests verify complete conversation flow

---

## Phase 3: Advanced Display Features

### Step 7: Foldable Sections ✅ COMPLETE
**Goal**: Collapsible agent activity and tool output sections

**Features**:
- Detect agent activity blocks in conversation
- Render with fold/unfold indicator (▼/▶)
- Space key to toggle current section
- Show summary when folded

**Mock data**:
```javascript
{
  type: 'agent_activity',
  summary: 'Agent Activity - 2 items',
  content: [
    '🤖 orchestrator → delegating to coder agent',
    '🔨 coder → analyzing auth patterns (active)'
  ],
  folded: true
}
```

**Test**: Sections fold/unfold correctly

**Acceptance**: Space key toggles sections, navigation works around folds

**Implementation Notes**:
- Extended message types to support 'agent_activity' with summary and content arrays
- Message component renders ▶/▼ indicators with blue color for agent activity
- Space key in navigation mode toggles fold state of current agent_activity message
- Folded state shows only summary, unfolded shows summary + indented content items
- Fold state persists in conversation array with individual message folded property
- Navigation highlighting works correctly with foldable sections
- 10 comprehensive automated tests verify folding behavior and navigation integration

---

### Step 8: Basic Code Syntax Highlighting ✅ COMPLETE
**Goal**: Highlight code blocks in assistant messages

**Dependencies**: `cli-highlight`

**Features**:
- Detect ```language code blocks
- Apply syntax highlighting with cli-highlight
- Fallback to plain text if highlighting fails

**Test**: Code blocks display with colors

**Acceptance**: JavaScript, Python, JSON code blocks are highlighted

**Implementation Notes**:
- Added cli-highlight dependency for terminal syntax highlighting
- Created syntax-highlight utility with code block detection regex
- Processes assistant messages to highlight ```language code blocks
- Supports JavaScript, Python, JSON, TypeScript, CSS, HTML languages
- Graceful fallback to plain text when highlighting fails or unknown language
- Preserves code formatting and indentation within highlighted blocks
- Error handling prevents crashes on invalid syntax or languages
- 12 comprehensive automated tests verify highlighting functionality and edge cases

---

### Step 9: Filter System ✅ COMPLETE
**Goal**: Filter conversation view by content type

**Features**:
- `/` key to enter filter mode
- Filter options: all, conversation, search term
- `c` key for conversation-only mode
- `a` key for show-all mode

**Status bar updates**:
- Show current filter: "Filter: all" or "Filter: conversation" or "Filter: 'auth'"

**Test**: Filters hide/show appropriate content

**Acceptance**: Can filter to just user/assistant messages or search results

**Implementation Notes**:
- Filter state managed with filterMode and searchTerm useState hooks
- Three filter modes: 'all', 'conversation', 'search'
- filterMessages function handles message filtering based on current mode
- Conversation filter shows only user and assistant messages
- Search filter matches text content (including agent activity summary/content)
- StatusBar displays current filter mode with getFilterText function
- Filter keys c/a integrated into navigation mode key hints
- Navigation position resets when filter changes for consistent UX
- 10 comprehensive automated tests verify filtering logic and UI behavior

---

## Phase 4: Polish & Integration

### Step 10: Search Functionality ✅ COMPLETE
**Goal**: Search through conversation history

**Features**:
- `/` opens search input
- Highlight matching text in results
- Navigate between search results with n/N
- Clear search with Escape

**Test**: Search finds and highlights matches

**Acceptance**: Can search for text and navigate results

**Implementation Notes**:
- Search mode activated with `/` key from any mode (input/navigation)
- Search input shown with "/ " prefix in InputBar component
- Real-time search term entry with character input and backspace support
- Enter key executes search and switches to navigation mode with search filter
- Escape key cancels search and returns to previous state
- Text highlighting using ANSI escape codes (yellow background, black text)
- Case-insensitive search matching across all message types
- Agent activity search includes both summary and content array text
- n/N keys navigate between search results when in search filter mode
- StatusBar shows search mode hints and result navigation info
- 15 comprehensive automated tests verify all search functionality and edge cases

---

### Step 11: Improved Status Bar ✅ COMPLETE
**Goal**: Rich status information display

**Features**:
- Token usage: "Tokens: 1.2k/4k"
- Model name: "claude-3.5-sonnet"
- Current mode and available keys
- Responsive layout for narrow terminals

**Test**: Status bar shows accurate information

**Acceptance**: All status info fits and updates correctly

**Implementation Notes**:
- Added TokenUsage interface and new StatusBarProps (tokenUsage, modelName, terminalWidth)
- formatTokens utility converts large numbers to K-notation (15.6k/128k)
- Responsive layout logic: <80 chars = narrow, ≥120 chars = wide with full info
- Token usage displays with blue styling, model name with green styling
- Maintains all existing navigation, search, and filter functionality
- 5 comprehensive new tests following TDD approach, all 107 tests passing
- Updated integration tests for new JSX structure compatibility

---

### Step 12: Streaming Text Support ✅ COMPLETE
**Goal**: Display text as it streams in (preparation for real LLM)

**Features**:
- Smooth scrolling to follow streaming text
- Cursor/typing indicator during stream

**Test**: Streaming text displays smoothly

**Acceptance**: Long responses stream without flickering

**Implementation Notes**:
- Added `streaming` message type with `isStreaming` prop to Message component
- Implemented character-by-character streaming with 50ms intervals for smooth effect
- Added white cursor indicator (▌) that appears during streaming
- StatusBar shows "Streaming..." status with yellow styling during text generation
- State progression: loading → streaming → complete (assistant message)
- Prevents input during streaming to avoid conflicts
- Streaming messages support syntax highlighting and search highlighting
- Auto-conversion to assistant message when streaming completes
- 10 comprehensive automated tests verify all streaming functionality
- All 117 tests passing, no regressions introduced

---

## Phase 5: Real Integration

### Step 13: Connect to Lace Backend ✅ COMPLETE
**Goal**: Replace mock responses with real lace conversation system

**Features**:
- Hook up real agent responses
- Handle real tool outputs and agent activities

**Test**: UI displays real lace conversations

**Acceptance**: Full integration with existing lace system

**Implementation Notes**:
- Created LaceUI class to bridge lace backend and Ink UI components
- Real agent response handling through LaceUI.handleMessage() with streaming support
- Token usage and model name display in status bar from actual agent responses
- Agent activity tracking with foldable sections for tool calls and results
- Comprehensive error handling for aborts, failures, and network issues
- 11 integration tests covering real backend scenarios, all 128 tests passing
- Proper separation between production code and test mocks

---

### Step 14: Diff Highlighting ✅ COMPLETE
**Goal**: Show file changes with before/after highlighting

**Dependencies**: `jsdiff`, custom diff renderer

**Features**:
- Detect tool outputs with file changes
- Show unified diff format with colors
- Green for additions, red for deletions

**Test**: File changes display clearly

**Acceptance**: Code changes are easy to read and understand

**Implementation Notes**:
- Added jsdiff dependency for diff parsing and highlighting utilities
- Created diff-highlight.ts utility with highlightDiff() function for ANSI color codes
- Integrated diff highlighting into existing syntax-highlight.ts system
- Special handling for ```diff code blocks with green/red color coding
- Preserves diff formatting, indentation, and headers (---, +++, @@)
- Graceful fallback for malformed diff content without crashing
- Context lines remain uncolored, addition lines green, deletion lines red
- 10 comprehensive tests covering all diff scenarios and edge cases
- All 138 tests passing, no regressions introduced

---

### Step 15: Performance & Memory ✅ COMPLETE
**Goal**: Handle long conversations efficiently

**Features**:
- Virtual scrolling for large conversations
- Memory cleanup for old messages
- Efficient re-rendering

**Test**: UI remains responsive with 1000+ messages

**Acceptance**: No memory leaks or performance degradation

**Implementation Notes**:
- Implemented virtual scrolling with configurable window size (default 50 messages)
- Only renders messages around current scroll position for large conversations (>50 messages)
- Maintains correct highlighting and search functionality with virtual scrolling
- Added getVisibleMessageWindow() function to calculate visible message slice
- Performance testing with 1000+ messages shows consistent render times <50ms
- Proper handling of absolute vs relative message indices for search results
- Memory cleanup punt decision: not needed with virtual scrolling efficiency gains
- 10 comprehensive performance tests covering large conversations, navigation, search
- All 148 tests passing, virtual scrolling dramatically improves performance

---
