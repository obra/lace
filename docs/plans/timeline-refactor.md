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

## Step 5: Create Generic Tool Renderer Foundation 🔄 NEXT PHASE

**Prompt**: "Create a GenericToolRenderer component that renders any tool execution using TimelineEntryCollapsibleBox. Test-first approach.

Requirements:
- Takes tool execution item as props
- Uses TimelineEntryCollapsibleBox for consistent expansion
- Shows tool name and input summary when collapsed
- Shows full input/output when expanded
- Handles expansion state via props (isExpanded, onExpandedChange)
- Format tool name nicely (bash, file-read, etc.)
- Truncate long inputs for summary (first 50 chars)
- Write comprehensive tests covering expansion, focus, and content rendering

Files to create:
- `src/interfaces/terminal/components/events/tool-renderers/GenericToolRenderer.tsx`
- `src/interfaces/terminal/components/events/tool-renderers/__tests__/GenericToolRenderer.test.tsx`

This replaces current ToolExecutionDisplay logic with consistent expansion."

---

## Step 6: Create Dynamic Tool Component Discovery

**Prompt**: "Create utility function for dynamic tool renderer discovery using naming conventions. Test-first approach.

Requirements:
- Function `getToolRenderer(toolName: string)` returns React component or null
- Naming convention: 'bash' → try to import './tool-renderers/BashToolRenderer.tsx'
- 'file-read' → try to import './tool-renderers/FileReadToolRenderer.tsx'  
- Return null if specific renderer not found (caller uses GenericToolRenderer)
- Use dynamic import with proper error handling
- Handle async loading with React.lazy and Suspense
- Return type should be Promise<React.ComponentType> or null

Files to create:
- `src/interfaces/terminal/components/events/tool-renderers/getToolRenderer.ts`
- `src/interfaces/terminal/components/events/tool-renderers/__tests__/getToolRenderer.test.ts`

Test successful discovery, failed imports, and naming convention edge cases."

---

## Step 7: Simplify TimelineItem Tool Execution Rendering

**Prompt**: "Refactor TimelineItem to use dynamic tool renderer discovery and remove tool-specific logic. Test-first approach.

Requirements:
- Remove all tool-specific switch/case logic for tool_execution items
- Use getToolRenderer() to get appropriate component, fallback to GenericToolRenderer
- Remove delegateTimelines, delegationExpandState, toolExpandState props
- Replace with single expandedItems map and onItemExpansion callback
- Handle async component loading with Suspense
- Update all tests to use new simplified props interface
- Ensure existing tool functionality is preserved

The tool_execution case should become:
```typescript
case 'tool_execution':
  const ToolRenderer = React.lazy(() => getToolRenderer(item.call.toolName));
  return (
    <Suspense fallback={<GenericToolRenderer item={item} {...props} />}>
      <ToolRenderer item={item} {...props} />
    </Suspense>
  );
```

Remove complex delegate-specific logic from this component."

---

## Step 8: Create Delegate Tool Renderer

**Prompt**: "Extract all delegate-specific logic into a DelegateToolRenderer component. Test-first approach.

Requirements:
- Move delegate thread extraction logic from TimelineDisplay/TimelineItem
- Handle delegate timeline rendering with DelegationBox
- Use TimelineEntryCollapsibleBox for consistent expansion behavior
- Show delegate status summary when collapsed ('Delegated task: Calculate 3+6')
- Show full delegation details when expanded
- Include delegate-specific props (delegateTimelines, extractDelegateThreadId)
- Handle case where delegate timeline is not found gracefully

Files to create:
- `src/interfaces/terminal/components/events/tool-renderers/DelegateToolRenderer.tsx`  
- `src/interfaces/terminal/components/events/tool-renderers/__tests__/DelegateToolRenderer.test.tsx`

This component should be automatically discovered when toolName === 'delegate'."

---

## Step 9: Unify Timeline Expansion State

**Prompt**: "Replace multiple expansion state systems with single unified state in TimelineDisplay. Test-first approach.

Requirements:
- Remove delegationExpandState and toolExpandState from TimelineDisplay
- Replace with single `expandedItems: Map<string, boolean>` 
- Remove complex tool-specific interaction handling (delegate vs regular tool logic)
- Replace handleItemInteraction with simple universal expansion toggle
- Update TimelineContent props to pass unified expansion state
- Generate unique item IDs for expansion tracking (use item.id or item.callId)
- Support left/right arrow expansion for all expandable items

The interaction should become:
```typescript
if (key.leftArrow || key.rightArrow) {
  const itemId = getItemId(timeline.items[focusedItemIndex]);
  const currentExpanded = expandedItems.get(itemId) ?? getDefaultExpansion(item);
  handleItemExpansion(itemId, !currentExpanded);
}
```

All timeline entries should have consistent expansion behavior."

---

## Step 10: Clean Up Removed Components and Dependencies

**Prompt**: "Remove unused components and clean up dependencies after timeline refactor. Test-first approach.

Requirements:
- Remove ThinkingDisplay component (no longer needed)
- Remove extractThinkingBlocks utility functions
- Remove thinking-related test files
- Update imports throughout codebase to remove thinking dependencies
- Remove thinking event type from timeline processor if no longer used
- Clean up any remaining thinking-related interfaces or types
- Update all tests to remove thinking-related assertions
- Verify no broken imports or unused code remains

Ensure timeline functionality works without thinking extraction complexity."

---

## Step 11: Add Specialized Tool Renderers (Optional)

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