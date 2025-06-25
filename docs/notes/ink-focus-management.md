# Ink Focus Management in Lace

This document explains how we use Ink's focus system for keyboard navigation in the terminal interface.

## Ink's Focus System Basics

Ink provides a hierarchical focus management system with these key hooks:

- `useFocus({ id: string })` - Registers a component as focusable and returns `{ isFocused }`
- `useFocusManager()` - Returns `{ focus, focusNext, focusPrevious }` for programmatic focus control
- `useInput(callback, { isActive })` - Handles keyboard input when `isActive` is true

### Key Principles

1. **Only focused components receive keyboard input** - `useInput` only fires when `isActive` is true
2. **Focus IDs must be unique** - Multiple components with the same focus ID cause conflicts
3. **Tab key moves between top-level focusable components** - This is Ink's native behavior
4. **Programmatic focus** - Use `focus(id)` to programmatically focus specific components

## Lace's Focus Architecture

We use a **hybrid approach** combining Ink's focus system with custom vim-like navigation:

### Timeline Navigation (Vim-like)
- Custom line-based cursor using `focusedLine` state
- Arrow keys, Page Up/Down, 'g'/'G' for navigation
- Cursor position determines which timeline item should be focused
- **One collapsible component per timeline item** (to avoid conflicts)

### Focus Hierarchy
```
Shell Input (top-level)
├── Timeline (main conversation)
│   ├── timeline-message-123 (user/agent messages)
│   ├── timeline-tool-456 (tool executions)
│   ├── timeline-delegation-789 (delegation boxes)
│   └── timeline-system-abc (system prompts)
└── Approval Modal (when active)
```

### Component Focus IDs

We use a naming convention for focus IDs:
- `timeline` - Main timeline container
- `timeline-message-{id}` - Message components
- `timeline-tool-{callId}` - Tool execution displays  
- `timeline-delegation-{callId}` - Delegation boxes
- `timeline-system-{id}` - System prompts
- `delegate-{threadId}` - Nested delegation timelines

## Timeline Focus Management

### Cursor → Focus Mapping

When the timeline cursor moves, `TimelineDisplay` automatically focuses the appropriate component:

```typescript
// In TimelineDisplay.tsx
React.useEffect(() => {
  if (focusedItemIndex >= 0 && focusedItemIndex < timeline.items.length) {
    const item = timeline.items[focusedItemIndex];
    const currentFocusId = focusId || 'timeline';
    
    let targetFocusId: string;
    
    if (item.type === 'tool_execution' && item.call?.toolName === 'delegate') {
      // For delegation, focus the delegation box (the main component)
      targetFocusId = `${currentFocusId}-delegation-${item.callId}`;
    } else if (item.type === 'tool_execution') {
      // For regular tools, focus the tool execution display
      targetFocusId = `${currentFocusId}-tool-${item.callId}`;
    } else {
      // For messages, thinking, system prompts, etc.
      const type = /* determine type */;
      targetFocusId = `${currentFocusId}-${type}-${itemId}`;
    }
    
    focus(targetFocusId);
  }
}, [focusedItemIndex, timeline.items, focus, focusId]);
```

### Escape Key Handling

Each focused component handles escape to move up the focus hierarchy:

```typescript
// In TimelineEntryCollapsibleBox.tsx
useInput(useCallback((input, key) => {
  if (!isFocused) return;
  
  if (key.escape) {
    onEscape?.(); // Delegate to parent
  } else if (key.rightArrow) {
    onExpandedChange(true);
  } else if (key.leftArrow) {
    onExpandedChange(false);
  }
}, [isFocused, onExpandedChange, onEscape]));
```

```typescript
// In TimelineDisplay.tsx
const handleEscape = useCallback(() => {
  if (parentFocusId) {
    // Nested timeline - go back to parent
    focus(parentFocusId);
  } else {
    // Main timeline - go to shell input
    focusNext();
  }
}, [focusId, parentFocusId, focus, focusNext]);
```

## Key Design Decisions

### One Collapsible Per Timeline Item

**Problem**: Originally, delegation items showed both `ToolExecutionDisplay` and `DelegationBox`, causing focus conflicts when both used the same focus ID.

**Solution**: Only show the `DelegationBox` for delegation items. This eliminates the conflict and provides a cleaner UX.

### Focus ID Uniqueness

**Problem**: Multiple `TimelineEntryCollapsibleBox` components with the same focus ID caused keyboard input conflicts.

**Solution**: Use unique, hierarchical focus IDs based on timeline context and item identifiers.

### Timeline-Managed Focus

**Problem**: The original approach had the parent timeline managing `isFocused` state, but Ink's focus system is designed around individual components registering themselves.

**Solution**: Use `useFocus({ id: focusId })` in each `TimelineEntryCollapsibleBox` and have the timeline programmatically focus the appropriate component when the cursor moves.

## Delegation and Nested Timelines

Delegation creates **nested timelines** with their own focus hierarchy:

```
Main Timeline (focusId: "timeline")
└── Delegation Item
    └── DelegationBox (focusId: "timeline-delegation-123")
        └── Nested Timeline (focusId: "delegate-thread456")
            ├── Nested Message (focusId: "delegate-thread456-message-789")
            └── Nested Tool (focusId: "delegate-thread456-tool-abc")
```

Escape key moves up this hierarchy:
- From nested components → parent timeline
- From main timeline → shell input

## Common Patterns

### Adding a New Collapsible Component

1. Use `TimelineEntryCollapsibleBox` wrapper
2. Accept `focusId` and `onEscape` props
3. Pass them to `TimelineEntryCollapsibleBox`
4. Update timeline's focus mapping logic

### Debugging Focus Issues

1. Check focus IDs are unique using browser dev tools
2. Verify `useInput` `isActive` conditions
3. Log focus changes to understand focus flow
4. Use `isFocused` state to highlight focused components

## Lessons Learned

1. **Ink's tab navigation works alongside custom navigation** - We don't override it, we complement it
2. **Focus conflicts are hard to debug** - Unique focus IDs are critical
3. **Hierarchical escape is intuitive** - Users expect escape to go "up" in the UI hierarchy
4. **One focusable component per timeline item** - Simplifies focus management significantly
5. **Programmatic focus control is powerful** - Allows timeline cursor to drive focus changes

## Future Improvements

- Consider using focus context to automatically handle escape hierarchy
- Explore making focus IDs self-describing (e.g., automatically derive parent from child ID)
- Add visual focus indicators for better UX
- Consider focus persistence across timeline refreshes