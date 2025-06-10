# Log View Implementation TODO

A series of focused prompts for implementing a toggleable detailed log view. Each prompt is designed to be small, testable, and incremental.

## PROMPT 1: Add Basic View Toggle State

**Task**: Add view mode state management to App.tsx without changing any UI rendering.

**Requirements**:
- Add `viewMode` state: `'conversation' | 'log'` (default: 'conversation')
- Add keyboard handler for `Ctrl+L` to toggle viewMode
- Add viewMode to StatusBar display text
- **Test**: Press Ctrl+L and verify status bar shows "Log Mode" / "Conversation Mode"

**Acceptance**: Status bar displays current view mode, keyboard toggle works, no visual changes to conversation display.

---

## PROMPT 2: Create Minimal DetailedLogView Component

**Task**: Create a basic DetailedLogView component that displays placeholder data.

**Requirements**:
- New file: `src/ui/components/DetailedLogView.tsx`
- Props: `scrollPosition`, `isNavigationMode`, `entries: string[]`
- Renders simple text list with navigation highlighting
- Use same virtual scrolling pattern as ConversationView
- **Test**: Create component with mock data `['Entry 1', 'Entry 2', 'Entry 3']`

**Acceptance**: Component renders, highlights current scroll position, accepts same navigation props as ConversationView.

---

## PROMPT 3: Wire View Toggle to Render Different Components

**Task**: Make App.tsx conditionally render ConversationView or DetailedLogView based on viewMode.

**Requirements**:
- Add conditional rendering in App.tsx
- Pass same navigation props to both components
- DetailedLogView gets placeholder entries: `['Mock log entry 1', 'Mock log entry 2']`
- **Test**: Toggle with Ctrl+L switches between conversation and mock log view

**Acceptance**: Ctrl+L toggles between showing ConversationView and DetailedLogView with mock data.

---

## PROMPT 4: Add Log Data Interface and Extraction

**Task**: Define log data structure and extract from existing conversation state.

**Requirements**:
- Create interface `DetailedLogEntry` with: `id`, `timestamp`, `type`, `content`
- Add function `extractLogEntries(conversation: ConversationMessage[]): DetailedLogEntry[]`
- Convert each conversation message to log entry with type matching message.type
- **Test**: Verify log entries have correct timestamps and types from conversation

**Acceptance**: Function converts conversation messages to log entries with proper typing and timestamps.

---

## PROMPT 5: Display Real Log Data in DetailedLogView

**Task**: Replace placeholder data with real log entries from conversation.

**Requirements**:
- Update App.tsx to pass real log entries to DetailedLogView
- Update DetailedLogView to accept `DetailedLogEntry[]` instead of `string[]`
- Display: timestamp, type, and full content for each entry
- **Test**: Log view shows actual conversation data with timestamps

**Acceptance**: Log view displays real conversation data in structured format with full content visible.

---

## PROMPT 6: Add Tool Call Data Extraction

**Task**: Extract tool calls and results from conversation data into separate log entries.

**Requirements**:
- Update `extractLogEntries` to create separate entries for tool calls and results
- Tool call entry: type='tool_call', show tool name and full input JSON
- Tool result entry: type='tool_result', show success/error and full output
- **Test**: Conversation with tool calls shows separate tool_call and tool_result entries

**Acceptance**: Tool executions appear as separate, clearly labeled log entries with full data.

---

## PROMPT 7: Add Entry Type Color Coding

**Task**: Add visual distinction for different log entry types.

**Requirements**:
- Use Ink's color props for different entry types
- USER_INPUT: blue, MODEL_RESPONSE: green, TOOL_CALL: magenta, TOOL_RESULT: yellow
- Add type prefix: `[USER]`, `[MODEL]`, `[TOOL→]`, `[TOOL←]`
- **Test**: Log entries display with appropriate colors and prefixes

**Acceptance**: Each log entry type has distinct color and clear visual prefix.

---

## PROMPT 8: Add Usage and Performance Data

**Task**: Display token usage and timing information where available.

**Requirements**:
- Show token counts for model responses: `(1.2K→456 tokens)`
- Show timing for tool executions: `(123ms)`
- Extract from `response.usage` and tool execution metadata
- Display full usage stats when available
- **Test**: Model responses show token usage, tool calls show execution time

**Acceptance**: Performance data is visible inline with relevant log entries, all data shown in full.

---

## Testing Strategy

Each prompt should be tested independently:

1. **Unit Tests**: Test data extraction functions with known inputs
2. **Component Tests**: Test component rendering with mock data
3. **Integration Tests**: Test keyboard navigation and state changes
4. **Manual Testing**: Verify visual output and user experience

## Design Principles

- **No Truncation**: Always show full content, let users scroll
- **YAGNI**: Only implement features explicitly requested
- **DRY**: Reuse existing navigation and state patterns
- **Clean API**: Simple, predictable interfaces
- **Testable**: Each prompt produces verifiable output
- **Incremental**: Each prompt builds on previous work

## Success Criteria

- View toggle works reliably
- Log data is accurate and complete with full content displayed
- Navigation feels consistent with conversation view
- Performance is acceptable for typical conversation sizes
- Code follows existing patterns and conventions
- All data visible without truncation or collapsing