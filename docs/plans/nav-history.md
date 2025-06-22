# Navigation History Enhancement Plan

## Overview

Transform Lace's conversation display from a passive scroll interface into an interactive, navigable timeline where users can efficiently explore their AI conversation history with keyboard navigation and smart content truncation.

## Core Requirements

### 1. Universal Timeline Navigation
- **All message types are focusable**: user messages, agent messages, tool executions, system messages, thinking blocks, delegation boxes
- **Up/Down arrows** navigate through timeline chronologically 
- **Focus wraps** around (top ↑ goes to bottom, bottom ↓ goes to top)
- **Visual focus indicator**: simple `>` character before focused item
- Focus state is independent of expansion state

### 2. Tool Message Truncation
- **Default view**: Show only first 3 lines of tool output
- **Smart truncation**: Avoid cutting mid-word, respect line boundaries
- **Truncation indicator**: `... +N more lines` format
- **JSON special handling**: Show first few keys when collapsed
- **Preserve syntax highlighting** in both truncated and expanded views

### 3. Specialized Expansion Controls
- **Left/Right arrows** control expansion of focused tool executions
- **→ expands** focused tool (show full output)
- **← collapses** focused tool (back to 3-line preview)
- **Only tool executions expandable** (for now - user/agent messages get focus but no expansion)

## Component Architecture

### Enhanced TimelineDisplay
Update existing `TimelineDisplay` with navigation state management:
- Tracks focused item index across all timeline items
- Handles up/down navigation keyboard input
- Renders focus indicator (`>`) for current item
- Passes focus state to child components

### Enhanced ToolExecutionDisplay
Update existing `ToolExecutionDisplay` with specialized navigation:
- Compact header format: `🔧 bash npm test ✅ 0.2s`
- Integrates `CompactOutput` for truncated display
- Handles left/right expansion keyboard input
- Shows expansion indicator: `→` (expandable) or `↓` (expanded)
- Replaces `CollapsibleBox` usage with direct expansion logic

### CompactOutput (new)
Specialized component for tool output truncation:
- First 3 lines visible by default
- Smart line breaking logic
- Truncation indicator with line count
- JSON-aware truncation (show key structure)
- Maintains syntax highlighting via `CodeDisplay`

### Enhanced Event Display Components
Update existing components to support focus state:
- `UserMessageDisplay` - accepts focus prop, shows indicator
- `AgentMessageDisplay` - accepts focus prop, shows indicator
- `SystemMessageDisplay` - accepts focus prop, shows indicator
- `ThinkingDisplay` - accepts focus prop, shows indicator

## Information Density Design

### Tool Headers (Compact Format)
```
🔧 bash npm run test ✅ 2.1s
🔧 file-read package.json ✅ <1ms  
🔧 delegate "fix types" ⏳ 15.2s
❌ ripgrep search timeout 30s
```

### Compact Output Preview
```
✅ Tests passed: 15/15
✅ Coverage: 94.2%
✅ No lint errors
... +12 more lines
```

### Navigation Visual
```
> 👤 User: "run the tests"                    ← focused
  🤖 Agent: "I'll run the tests for you..."  
  🔧 bash npm test ✅ 0.2s                   → expandable
  🤖 Agent: "The tests passed successfully"  
  👤 User: "great, now deploy"               
```

## Keyboard Navigation Specification

### Timeline Navigation
- `↑` - Move focus to previous timeline item
- `↓` - Move focus to next timeline item
- Focus wraps: pressing ↑ on first item goes to last item
- Focus wraps: pressing ↓ on last item goes to first item

### Content Expansion (Tool Executions Only)
- `→` - Expand focused tool execution (show full output)
- `←` - Collapse focused tool execution (back to preview)
- No effect on non-expandable items (user/agent messages, system messages)

### Focus vs Expandable Distinction
- **Focus**: Visual indicator, responds to ↑/↓ navigation (all items)
- **Expandable**: Responds to ←/→ expansion (tool executions only)
- User/Agent messages are focusable but not expandable (preparing for future features)

## Implementation Strategy

### Phase 1: Enhanced TimelineDisplay Foundation
1. Update existing `TimelineDisplay` with focus state management
2. Add keyboard input handling for ↑/↓ navigation
3. Implement focus indicator rendering
4. Update all event display components to accept focus prop

### Phase 2: Tool Output Truncation
1. Create `CompactOutput` component with 3-line truncation
2. Implement smart line breaking and truncation indicators
3. Add JSON-aware truncation logic
4. Integrate with existing `CodeDisplay` for syntax highlighting

### Phase 3: Enhanced Tool Navigation
1. Update existing `ToolExecutionDisplay` with truncation support
2. Integrate `CompactOutput` for truncated display
3. Add left/right expansion keyboard handling
4. Replace `CollapsibleBox` usage with direct expansion logic

### Phase 4: Integration & Polish
1. Remove remaining dependencies on generic `CollapsibleBox`
2. Test navigation flow across all message types
3. Performance optimization for large conversation histories
4. Polish visual indicators and transitions

## Technical Considerations

### State Management
- Focus state lives in `NavigableTimeline`
- Expansion state lives in individual `NavigableToolExecution` components
- Navigation events bubble up from focused components

### Performance
- Virtual scrolling not needed initially (assume reasonable conversation lengths)
- Lazy rendering of expanded content to avoid memory bloat
- Efficient re-rendering when focus changes

### Accessibility
- Focus indicators work in terminal environment
- Keyboard navigation follows standard terminal UI patterns
- Clear visual hierarchy without relying on color alone

## Future Extension Points

### User/Agent Message Enhancement (Future)
Once navigation foundation is complete, user and agent messages could support:
- Message editing (↵ on focused user message)
- Copy to clipboard (Ctrl+C on focused message)
- Alternative response generation (Ctrl+R on focused agent message)
- Message threading/branching

### Advanced Navigation (Future)
- Jump to specific message types (Ctrl+T for tools, Ctrl+U for user)
- Timeline scrubbing with visual indicator
- Bookmarking important messages

### Content Search (Future)
- Quick search within conversation history
- Filter by message type or tool name
- Jump to search results

## Success Metrics

### User Experience
- Users can quickly navigate to any message in conversation history
- Tool output is scannable at a glance with option to dive deeper
- Keyboard navigation feels natural and responsive
- Information density allows more content visible on screen

### Technical
- No performance degradation with large conversation histories
- Clean component architecture supporting future enhancements
- Minimal breaking changes to existing codebase
- Maintainable keyboard navigation system