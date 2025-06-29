# Terminal UI Focus System Design

## Overview

The Lace terminal interface uses a hierarchical focus system built on top of Ink's flat focus management. This document describes the architecture, patterns, and usage of our focus system.

## Problem Statement

Ink's native focus system is designed for simple Tab/Shift+Tab cycling through a flat list of focusable components. However, Lace requires:

1. **Hierarchical Navigation**: Users navigate into and out of nested contexts (shell → timeline → delegation → sub-timeline)
2. **Modal Focus Trapping**: Approval dialogs must trap focus until dismissed
3. **Context-Aware Navigation**: Escape key should "go back" to the previous context, not cycle through components
4. **No Tab Cycling**: Tab is used for autocomplete in the shell, not focus navigation

The previous implementation tried to bend Ink's system to support these needs, resulting in:
- Extensive prop drilling (`focusId`, `parentFocusId`, `currentFocusId`)
- Manual escape key handling in every focusable component
- Hardcoded focus transitions scattered throughout the codebase
- Complex state management and unclear focus hierarchy

## Architecture

### Focus Stack Pattern

The new system uses a focus stack to track navigation hierarchy:

```
┌─────────────────────────────────────────┐
│              Focus Stack                 │
│                                         │
│  bottom → ['shell-input']               │  (initial state)
│           ['shell-input', 'timeline']   │  (user pressed Escape to timeline)
│           ['shell-input', 'timeline',   │  (user expanded a delegation)
│            'delegate-abc123']           │
│                                         │
│  Escape key always pops the stack       │
└─────────────────────────────────────────┘
```

### Component Architecture

```
TerminalInterface
  └── LaceFocusProvider                    // Provides focus context
       ├── ShellInput                      // Uses useLaceFocus('shell-input')
       ├── ConversationDisplay
       │    └── TimelineViewport           // Uses useLaceFocus('timeline')
       │         └── DelegationBox         // Uses useLaceFocus('delegate-{id}')
       └── ToolApprovalModal               // Auto-pushed when shown
```

### Key Components

#### 1. FocusStack (`focus-stack.ts`)

A simple stack data structure that maintains the focus hierarchy:

```typescript
class FocusStack {
  private stack: string[] = ['shell-input'];
  
  push(focusId: string): string {
    this.stack.push(focusId);
    return focusId;
  }
  
  pop(): string | undefined {
    if (this.stack.length > 1) {
      this.stack.pop();
      return this.current();
    }
  }
  
  current(): string {
    return this.stack[this.stack.length - 1];
  }
}
```

#### 2. LaceFocusProvider (`focus-provider.tsx`)

A React context that:
- Wraps Ink's focus management
- Maintains the focus stack
- Provides a global Escape key handler
- Exposes `pushFocus` and `popFocus` methods

```typescript
function LaceFocusProvider({ children }) {
  const inkFocus = useFocusManager();
  const [focusStack] = useState(() => new FocusStack());
  
  // Disable Ink's Tab cycling
  useEffect(() => {
    inkFocus.disableFocus();
  }, []);
  
  // Global Escape handler
  useInput((input, key) => {
    if (key.escape) {
      const newFocus = focusStack.pop();
      if (newFocus) inkFocus.focus(newFocus);
    }
  });
  
  // ... provide context
}
```

#### 3. useLaceFocus Hook (`use-lace-focus.ts`)

A custom hook that components use to participate in focus:

```typescript
function useLaceFocus(id: string, options?: { autoFocus?: boolean }) {
  const { currentFocus, pushFocus } = useContext(LaceFocusContext);
  const { isFocused } = useFocus({ id, autoFocus: options?.autoFocus });
  
  return {
    isFocused: currentFocus === id && isFocused,
    takeFocus: () => pushFocus(id),
  };
}
```

#### 4. Focus Regions (`focus-regions.ts`)

Semantic constants for focus IDs:

```typescript
export const FocusRegions = {
  shell: 'shell-input',
  timeline: 'timeline',
  modal: (type: string) => `modal-${type}`,
  delegate: (threadId: string) => `delegate-${threadId}`,
  autocomplete: 'autocomplete',
} as const;
```

## Usage Patterns

### Basic Component

```typescript
function MyComponent() {
  const { isFocused, takeFocus } = useLaceFocus(FocusRegions.timeline);
  
  useInput((input, key) => {
    if (!isFocused) return;
    
    // Handle navigation keys
    if (key.upArrow) navigateUp();
    if (key.downArrow) navigateDown();
    // No need to handle Escape - provider does it
  }, { isActive: isFocused });
  
  return <Box>...</Box>;
}
```

### Modal Pattern

```typescript
function ApprovalModal({ isOpen, onClose }) {
  const { pushFocus, popFocus } = useContext(LaceFocusContext);
  
  useEffect(() => {
    if (isOpen) {
      pushFocus(FocusRegions.modal('approval'));
      return () => popFocus();
    }
  }, [isOpen]);
  
  // Modal content...
}
```

### Nested Navigation

```typescript
function DelegationBox({ threadId }) {
  const focusId = FocusRegions.delegate(threadId);
  const { takeFocus } = useLaceFocus(focusId);
  const [expanded, setExpanded] = useState(false);
  
  const handleExpand = () => {
    setExpanded(true);
    takeFocus(); // Push focus when expanding
  };
  
  return (
    <Box>
      {expanded && (
        <TimelineDisplay /> {/* Will handle its own focus */}
      )}
    </Box>
  );
}
```

## Focus Flow Examples

### Example 1: Basic Navigation

1. App starts with focus on `shell-input`
2. User presses Escape → focus moves to `timeline`
3. User presses Escape again → focus returns to `shell-input`

```
Stack: ['shell-input'] → ['shell-input', 'timeline'] → ['shell-input']
```

### Example 2: Modal Interaction

1. User triggers tool approval
2. Modal appears and pushes focus
3. User approves/denies
4. Modal closes and focus returns automatically

```
Stack: ['shell-input'] → ['shell-input', 'modal-approval'] → ['shell-input']
```

### Example 3: Delegation Navigation

1. User is viewing timeline
2. User expands a delegation box
3. Focus moves into the delegation
4. Escape returns to main timeline
5. Another Escape returns to shell

```
Stack: ['shell-input', 'timeline'] 
    → ['shell-input', 'timeline', 'delegate-abc123']
    → ['shell-input', 'timeline']
    → ['shell-input']
```

## Integration with Ink

We use Ink's focus system as a low-level registry while implementing our own navigation logic:

1. **Component Registration**: `useFocus()` still registers components with Ink
2. **Focus State**: Ink tracks which component has focus
3. **Programmatic Focus**: We use `focus(id)` to tell Ink what to focus
4. **Tab Cycling Disabled**: We call `disableFocus()` to prevent Tab navigation

This approach gives us the best of both worlds:
- Ink handles the complexity of tracking focusable components
- We control the navigation logic through our focus stack

## Benefits

1. **No Prop Drilling**: Focus behavior is accessed via hooks and context
2. **Consistent Navigation**: Escape always goes "back" 
3. **Self-Contained Components**: Each component manages its own focus needs
4. **Type Safety**: Focus regions prevent typos and provide autocomplete
5. **Testable**: Focus stack is a simple data structure that's easy to test
6. **Maintainable**: Clear separation between focus logic and component logic

## Testing

The focus system can be tested at multiple levels:

### Unit Tests
- Test `FocusStack` operations in isolation
- Test `useLaceFocus` hook behavior
- Mock the context for component tests

### Integration Tests
- Test focus navigation flows
- Verify modal focus restoration
- Test keyboard navigation within focused components

### Example Test

```typescript
describe('FocusStack', () => {
  it('maintains hierarchy correctly', () => {
    const stack = new FocusStack();
    expect(stack.current()).toBe('shell-input');
    
    stack.push('timeline');
    expect(stack.current()).toBe('timeline');
    
    stack.push('delegate-123');
    expect(stack.current()).toBe('delegate-123');
    
    expect(stack.pop()).toBe('timeline');
    expect(stack.current()).toBe('timeline');
  });
});
```

## Migration Notes

When migrating components:

1. Remove all focus-related props
2. Replace `useFocus({ id: 'hardcoded-id' })` with `useLaceFocus(FocusRegions.something)`
3. Remove manual Escape key handling
4. Remove `focus()` calls
5. For modals, use the auto-push/pop pattern

## Future Enhancements

The focus stack pattern enables future features:

1. **Focus History**: Could maintain a history for forward navigation
2. **Focus Shortcuts**: Could add keyboard shortcuts to jump to specific regions
3. **Focus Persistence**: Could save/restore focus state across sessions
4. **Focus Breadcrumbs**: Could show visual indication of focus depth
5. **Smart Focus**: Could remember last focused item when returning to a region