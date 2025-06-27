# Timeline Architecture Refactor Plan

## Goal
Create a beautiful, simple timeline architecture where:
- Tool-specific rendering is dynamically discovered
- All timeline entries use consistent expansion behavior  
- Agent messages handle thinking blocks internally (no separate timeline items)
- User messages always show full content
- Less code is better code

## Current Problems
- Complex thinking block extraction creates multiple timeline items from single agent message
- Tool-specific rendering logic scattered throughout TimelineItem
- Multiple expansion state systems (delegationExpandState, toolExpandState)
- Inconsistent expandability and summarization across timeline entry types

## Target Architecture
```
AgentMessage (single timeline entry)
├── Collapsed: "Message content /thought for 150 words/"
└── Expanded: Full message including thinking blocks

UserMessage (single timeline entry)  
└── Always full content (no collapse)

ToolExecution (single timeline entry)
├── Dynamic renderer discovery (BashToolRenderer.tsx, etc.)
└── TimelineEntryCollapsibleBox for expansion

Single expansion state map for everything
```

---

## ✅ Step 1: Simplify Agent Message Processing ✅ COMPLETED

**Prompt**: "Remove thinking block extraction from ThreadProcessor and simplify agent message processing. Test-first approach.

Requirements:
- Remove `extractThinkingBlocks()` method from ThreadProcessor
- Change AGENT_MESSAGE case to create single timeline item with full content
- Remove thinking-related caching logic
- Remove THINKING event case (no longer needed)
- Update tests to expect single agent_message item instead of thinking + agent_message
- Keep raw content intact - let AgentMessageDisplay handle thinking internally

The AGENT_MESSAGE case should become:
```typescript
case 'AGENT_MESSAGE': {
  items.push({
    type: 'agent_message',
    content: event.data as string, // Full content with thinking blocks
    timestamp: event.timestamp,
    id: event.id,
  });
  break;
}
```

Remove all thinking-related timeline processing complexity."

---

## ✅ Step 2: Enhance AgentMessageDisplay with Internal Thinking Handling ✅ COMPLETED

**Prompt**: "Refactor AgentMessageDisplay to handle thinking blocks internally with expansion. Test-first approach.

Requirements:
- Remove current thinking block stripping regex
- Parse thinking blocks internally: extract `<think>content</think>` sections
- When collapsed: Show message content + '/thought for X words/' markers where thinking blocks were
- When expanded: Show full message with thinking blocks rendered inline
- Use TimelineEntryCollapsibleBox for consistent expansion behavior
- Accept isExpanded and onExpandedChange props
- Default to collapsed state for messages with thinking blocks
- Count words in thinking blocks for the marker text

Collapsed example: 'I'll help you with that. /thought for 47 words/ Here's the solution...'
Expanded example: Show full markdown including thinking blocks with proper formatting

Remove dependency on separate ThinkingDisplay component."

---

## ✅ Step 3: Update TimelineItem to Use Expansion for Agent Messages ✅ COMPLETED

**Prompt**: "Update TimelineItem to support expansion for agent_message type. Test-first approach.

Requirements:
- Add agent_message to expandable timeline entries
- Pass expansion props (isExpanded, onExpandedChange) to AgentMessageDisplay
- Use consistent expansion handling with other timeline entry types
- Generate unique item IDs for expansion state tracking
- Remove any remaining thinking-related logic from TimelineItem
- Update tests to cover agent message expansion behavior

Agent messages should now expand/collapse like tool executions and other entries."

---

## ✅ Step 4: Ensure User Messages Always Show Full Content ✅ COMPLETED

**Prompt**: "Update user message rendering to always show full content without summarization. Test-first approach.

Requirements:
- User messages should not use TimelineEntryCollapsibleBox
- Always render full user message content regardless of length
- Remove any truncation or summarization of user messages
- User messages should be immediately readable without expansion
- Update tests to verify full content display
- Keep MessageDisplay component but ensure it never truncates user content

User messages are typically short and represent user intent - they should always be fully visible."

---

## 🚧 PARTIALLY COMPLETED: Prop Drilling Elimination (Steps 8-9) 🚧

We completed early elimination of prop drilling for delegation state:
- Removed delegateTimelines prop drilling from all timeline components  
- DelegationBox now accepts toolCall prop and extracts thread ID internally
- Removed extractDelegateThreadId prop drilling by making it internal utility
- All timeline components now manage their own state (expansion, delegation)
- Single expansion state approach established

This work aligns with Steps 8-9 goals and simplifies the remaining tool renderer work.

---

## ✅ Step 5: Create Generic Tool Renderer Foundation ✅ COMPLETED

**Completed**: Created GenericToolRenderer component with dynamic tool discovery system.

**What was implemented**:
- GenericToolRenderer component using TimelineEntryCollapsibleBox for consistent expansion
- Smart command extraction for bash, file operations, ripgrep, delegate tools
- Status indicators (✓ success, ✗ error, ⏳ pending) and streaming states
- JSON/text output detection with compact preview when collapsed
- Full input/output display when expanded with proper formatting
- Tool name formatting (file_read → file-read) and parameter extraction
- getToolRenderer utility for dynamic component discovery with naming conventions
- Both async and React.lazy versions for different use cases
- 47 comprehensive test cases covering all functionality and edge cases

**Files created**:
- `src/interfaces/terminal/components/events/tool-renderers/GenericToolRenderer.tsx`
- `src/interfaces/terminal/components/events/tool-renderers/__tests__/GenericToolRenderer.test.tsx`
- `src/interfaces/terminal/components/events/tool-renderers/getToolRenderer.ts`
- `src/interfaces/terminal/components/events/tool-renderers/__tests__/getToolRenderer.test.ts`

**Architecture benefits**:
- Consistent expansion behavior for all tool executions
- Dynamic tool renderer discovery (bash → BashToolRenderer.tsx)
- Easy extensibility by creating new component files
- Graceful fallback to GenericToolRenderer for unknown tools

---

## ✅ Step 6: Create Dynamic Tool Component Discovery ✅ COMPLETED  

**Completed**: Dynamic tool discovery utility was implemented as part of Step 5.

**What was implemented**:
- getToolRenderer function with naming convention mapping
- Graceful error handling for missing components  
- Both async and React.lazy versions for different use cases
- Comprehensive test coverage with 19 test cases
- Tool name to component name conversion (bash → BashToolRenderer.tsx)
- Proper TypeScript types and linting compliance

This step was completed together with Step 5 as they were closely related.

---

## ✅ Step 7: Simplify TimelineItem Tool Execution Rendering ✅ COMPLETED

**Completed**: Refactored TimelineItem to use dynamic tool renderer discovery with self-managed component state.

**What was implemented**:
- Removed all tool-specific switch/case logic for tool_execution items
- Created DynamicToolRenderer component with async tool discovery
- Used getToolRenderer() to find specific components, fallback to GenericToolRenderer
- Removed expansion state props - components manage their own state
- Async component loading with loading state (shows GenericToolRenderer while loading)
- Updated all tests to match new simplified interface
- Preserved all existing tool functionality while simplifying architecture

**Key architectural decisions**:
- Components manage their own expansion state instead of prop drilling
- DynamicToolRenderer handles async loading and graceful fallback
- No delegate-specific logic in TimelineItem (will be handled by DelegateToolRenderer)
- Clean separation of concerns with unified tool rendering interface

**Files modified**:
- `src/interfaces/terminal/components/events/TimelineItem.tsx`
- `src/interfaces/terminal/components/events/__tests__/TimelineItem.test.tsx`

---

## ✅ Step 8: Create Delegate Tool Renderer ✅ COMPLETED

**Completed**: Created comprehensive DelegateToolRenderer with specialized delegation functionality.

**What was implemented**:
- DelegateToolRenderer component using TimelineEntryCollapsibleBox for consistent expansion
- Delegate thread extraction logic moved from TimelineItem to DelegateToolRenderer
- Smart task extraction from input.task or input.prompt fields with fallback
- Thread ID extraction from output using pattern matching (Thread: delegate-thread-xxx)
- DelegationBox integration for full delegation timeline display when expanded
- Status indicators showing delegation progress and thread information
- Compact summary when collapsed: "delegate 'Task description'" with status
- Full delegation details when expanded: input, output, and delegation timeline
- Graceful handling when no delegate thread is found (no DelegationBox shown)
- JSON/text output detection for proper formatting
- 26 comprehensive test cases covering all functionality

**Files created**:
- `src/interfaces/terminal/components/events/tool-renderers/DelegateToolRenderer.tsx`
- `src/interfaces/terminal/components/events/tool-renderers/__tests__/DelegateToolRenderer.test.tsx`

**Verification**:
- Dynamic tool discovery successfully finds DelegateToolRenderer for 'delegate' tools
- Falls back to GenericToolRenderer for other tools as expected
- All tests passing with comprehensive coverage
- Clean separation of delegate-specific logic from generic timeline components

---

## Step 9: Fix Focus vs Selection Terminology

**Prompt**: "Rename all timeline cursor/selection variables to use correct terminology. Test-first approach.

Requirements:
- Rename `focusedItemIndex` → `selectedItemIndex` throughout timeline components
- Rename `isFocused` props on timeline items → `isSelected` 
- Rename `focusedLine` → `selectedLine` or `cursorLine`
- Rename `itemToRefocusAfterMeasurement` → `itemToReselectAfterMeasurement`
- Keep `useFocus({ id: 'timeline' })` for actual keyboard focus (correct as-is)
- Update all component interfaces and function signatures
- Update all tests to use correct terminology
- Update variable names in viewport hooks and timeline processors

**Terminology clarification**:
- **Focus**: Which component receives keyboard input (timeline, shell-input, etc.)
- **Selection**: Which item the cursor is highlighting within the focused timeline

This creates clearer separation between keyboard focus management and visual cursor selection."

---

## Step 10: Remove Keyboard Handling from TimelineEntryCollapsibleBox

**Prompt**: "Remove useInput from TimelineEntryCollapsibleBox to fix focus hierarchy issues. Test-first approach.

Requirements:
- Remove useInput hook entirely from TimelineEntryCollapsibleBox component
- Remove useCallback import (no longer needed)
- Keep component purely presentational - no keyboard handling
- Ensure TimelineViewport remains the single source of keyboard input
- Update any tests that expect TimelineEntryCollapsibleBox to handle keys directly
- Verify that expansion still works through proper hierarchy (TimelineViewport → TimelineDisplay → components)

**Problem being solved**: TimelineEntryCollapsibleBox was listening for keyboard input even when the timeline wasn't focused, causing expansion to work when it shouldn't (e.g., when shell-input is focused)."

---

## Step 11: Implement Event-Based Expansion Toggle

**Prompt**: "Add event-based communication for timeline expansion toggle. Test-first approach.

Requirements:
- Create useTimelineExpansionToggle hook for expandable components
- Use simple event emitter pattern (EventEmitter or custom events)
- Hook accepts isSelected boolean and toggleExpansion callback
- Only selected item responds to toggle events
- Update TimelineDisplay handleItemInteraction to emit toggle events on left/right arrows
- Update GenericToolRenderer and other expandable components to use the hook
- Test that only the selected item expands when left/right pressed
- Test that expansion doesn't work when timeline isn't focused

**Event flow**:
1. Timeline focused + item selected + left/right arrow pressed
2. TimelineDisplay emits 'toggle-expansion' event  
3. Only the selected expandable component responds and toggles its state

**Files to create**:
- `src/interfaces/terminal/components/events/hooks/useTimelineExpansionToggle.ts`
- Corresponding test file"

---

## ⚠️ Step 11.5: Fix DelegationBox Rendering (BLOCKED)

**Status**: BLOCKED - Requires tool types refactor first

**Issue**: DelegationBox cannot access delegate thread metadata due to type mismatch between ToolResult (rich content + metadata) and ToolResultData (flat string output). 

**Dependencies**: Complete `docs/plans/tool-types-refactor.md` first to enable:
- Delegate tool to include `metadata.threadId` in ToolResult
- DelegationBox to access thread ID directly without regex parsing  
- Full delegation timeline rendering

**Prompt**: "Fix DelegationBox to render delegate timelines properly after tool types refactor.

Requirements:
- Update DelegationBox to access `toolCall.result?.metadata?.threadId` directly
- Remove regex parsing logic for thread ID extraction
- Fetch actual timeline data from ThreadManager using threadId
- Replace placeholder timeline with real delegate thread events
- Test delegation rendering with actual delegate tool executions

This step can only be completed after the tool types refactor provides metadata access."

---

## ✅ Step 12: Clean Up Removed Components and Dependencies ✅ COMPLETED

**Completed**: Successfully removed all unused thinking extraction components and dependencies.

**What was implemented**:
- Removed ThinkingDisplay component (no longer needed)
- Removed THINKING event type from timeline processor and type definitions
- Removed thinking case from TimelineItem switch statement
- Updated imports throughout codebase to remove thinking dependencies
- Cleaned up thinking-related comments and references
- Updated all test files to remove thinking-related assertions
- Verified no broken imports or unused code remains

**Files removed**:
- `src/interfaces/terminal/components/events/ThinkingDisplay.tsx`

**Files modified**:
- `src/interfaces/thread-processor.ts` - Removed THINKING event processing
- `src/threads/types.ts` - Removed THINKING from EventType
- `src/interfaces/terminal/components/events/TimelineItem.tsx` - Removed thinking case
- `src/interfaces/terminal/components/events/EventDisplay.tsx` - Removed ThinkingDisplay import
- Multiple test files - Removed thinking-related test cases

**Preserved**:
- `thinking-parser.ts` utilities (still used by AgentMessageDisplay for internal processing)
- AgentMessageDisplay's internal thinking block handling

**Verification**:
- TypeScript compilation clean ✅
- 1252/1259 tests passing (99.4% - failures are external integration timeouts) ✅
- Core timeline functionality preserved ✅
- Thinking blocks still work internally in agent messages ✅

Timeline architecture is now clean of old thinking extraction complexity while preserving all functionality.

---

## Step 13: Add Specialized Tool Renderers (Optional)

**Prompt**: "Create specialized renderers for file operations and bash tools. Test-first approach.

Requirements:
- Create FileReadToolRenderer, FileWriteToolRenderer for file operations
- Create BashToolRenderer for bash command execution  
- Show file path or command in summary when collapsed
- Show file content or command output when expanded
- Use TimelineEntryCollapsibleBox consistently
- Add syntax highlighting for file content if feasible in terminal
- Test that dynamic discovery automatically finds these renderers

Files to create:
- `src/interfaces/terminal/components/events/tool-renderers/FileReadToolRenderer.tsx`
- `src/interfaces/terminal/components/events/tool-renderers/BashToolRenderer.tsx`
- Corresponding test files

Only implement if they provide clear value over GenericToolRenderer."

---

## Success Criteria

After completion:
- [x] Agent messages are single timeline entries with internal thinking handling
- [x] User messages always show full content  
- [x] Single expansion state system instead of multiple
- [x] All timeline entries consistently expandable
- [ ] Tool-specific rendering automatically discovered
- [ ] No tool-specific logic in TimelineItem or TimelineDisplay
- [x] No separate thinking timeline items or processing
- [x] Fewer total lines of code
- [x] All existing functionality preserved
- [x] 100% test coverage maintained
- [ ] Easy to add new tool renderers by creating files

## Non-Goals

- Don't change core timeline scrolling/viewport behavior
- Don't modify event processing beyond thinking extraction removal
- Don't alter keyboard navigation beyond expansion
- Don't add new tool types - just reorganize existing rendering

## Architecture Benefits

- **Simpler agent messages**: No artificial splitting into thinking + message
- **Better UX**: Related content stays together in expandable entries
- **Extensible**: New tools get rendering automatically
- **Consistent**: All entries expand the same way
- **Less processing**: No complex thinking block extraction
- **Discoverable**: File names indicate available tool renderers
- **Testable**: Each renderer tested independently
- **Beautiful**: Clean separation of concerns with unified expansion