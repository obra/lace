# Terminal UI Focus System Design

## Overview

The Lace terminal interface uses a hierarchical focus system built on top of Ink's focus management. This system enables vi-like navigation, modal focus trapping, and complex nested UI interactions while maintaining clean, testable code.

## Problem Statement

Ink's native focus system is designed for simple Tab/Shift+Tab cycling through a flat list of focusable components. However, Lace requires:

1. **Hierarchical Navigation**: Users navigate into and out of nested contexts (shell → timeline → delegation → sub-timeline)
2. **Modal Focus Trapping**: Approval dialogs must trap focus until dismissed
3. **Context-Aware Navigation**: Escape key should "go back" to the previous context, not cycle through components
4. **Event Isolation**: Multiple timelines (main + delegates) must not interfere with each other
5. **No Tab Cycling**: Tab is used for autocomplete in the shell, not focus navigation

## Architecture

### Focus Stack Pattern

The system uses a focus stack to track navigation hierarchy:

```
┌─────────────────────────────────────────┐
│              Focus Stack                 │
│                                         │
│  bottom → ['shell-input']               │  (initial state)
│           ['shell-input', 'timeline']   │  (user pressed Escape to timeline)
│           ['shell-input', 'timeline',   │  (user entered a delegation)
│            'delegate-abc123']           │
│                                         │
│  Escape key always pops the stack       │
└─────────────────────────────────────────┘
```

### Component Architecture

```
TerminalInterface
 └── LaceFocusProvider                    // Global focus management
      ├── ShellInput                      // Uses useLaceFocus('shell-input')
      ├── ConversationDisplay
      │    └── TimelineExpansionProvider  // Isolated expansion events
      │         └── TimelineDisplay
      │              └── TimelineViewport // Uses useLaceFocus('timeline')
      │                   └── DelegateToolRenderer
      │                        └── FocusLifecycleWrapper
      │                             └── TimelineExpansionProvider  // Nested isolation
      │                                  └── TimelineDisplay      // Delegate timeline
      └── ToolApprovalModal               // Auto-managed via ModalWrapper
```

## Key Components

### 1. FocusStack (`focus-stack.ts`)

A simple stack data structure that maintains the focus hierarchy:

```typescript
class FocusStack {
  private stack: string[] = ['shell-input'];
  
  push(focusId: string): string {
    // Prevents duplicate consecutive pushes
    if (this.current() === focusId) {
      return focusId; 
    }
    this.stack.push(focusId);
    return focusId;
  }
  
  pop(): string | undefined {
    if (this.stack.length > 1) {
      this.stack.pop();
      return this.current();
    }
    return undefined;
  }
  
  current(): string {
    return this.stack[this.stack.length - 1];
  }
}
```

### 2. LaceFocusProvider (`focus-provider.tsx`)

The global focus context that:
- Wraps Ink's focus management with stack-based logic
- Provides global escape handler for vi-like navigation
- Handles delegate context isolation
- Manages focus transitions via `pushFocus()` and `popFocus()`

```typescript
export function LaceFocusProvider({ children }) {
  const inkFocus = useFocusManager();
  const focusStackRef = useRef(new FocusStack());
  const [currentFocus, setCurrentFocus] = useState(focusStackRef.current.current());

  // Disable Ink's focus cycling completely
  useEffect(() => {
    inkFocus.disableFocus();
    inkFocus.focus(FocusRegions.shell);
  }, []); 

  // Global Escape handler with delegate context awareness
  useInput((input, key) => {
    if (key.escape) {
      // Don't handle escape if we're in a delegate context
      if (currentFocus.startsWith('delegate-')) {
        return; // Let the delegate handler process this escape
      }
      
      // Vi-like behavior: shell escape goes to timeline
      if (currentFocus === FocusRegions.shell) {
        pushFocus(FocusRegions.timeline);
      } else {
        popFocus();
      }
    }
  });

  // ... context value and provider
}
```

### 3. FocusLifecycleWrapper (`focus-lifecycle-wrapper.tsx`)

**Critical Component**: Automatically manages focus stack push/pop based on boolean state:

```typescript
interface FocusLifecycleWrapperProps {
  focusId: string;
  isActive: boolean;                    // When true, pushes focus; when false, pops
  children: ReactNode;
  renderWhenInactive?: boolean;         // true=always render, false=hide when inactive
  onFocusActivated?: () => void;
  onFocusRestored?: () => void;
}

export function FocusLifecycleWrapper({
  focusId,
  isActive,
  children,
  renderWhenInactive = true,
  onFocusActivated,
  onFocusRestored,
}) {
  const { pushFocus, popFocus } = useLaceFocusContext();

  useEffect(() => {
    if (isActive) {
      pushFocus(focusId);
      onFocusActivated?.();
      
      return () => {
        // Delayed cleanup to handle React re-render cycles
        const timeoutId = setTimeout(() => {
          const restoredFocus = popFocus();
          if (restoredFocus) {
            onFocusRestored?.();
          }
        }, 0);
        
        return () => clearTimeout(timeoutId);
      };
    }
  }, [isActive, focusId, pushFocus, popFocus, onFocusActivated, onFocusRestored]);

  if (!renderWhenInactive && !isActive) {
    return null;
  }

  return <>{children}</>;
}
```

### 4. ModalWrapper (`modal-wrapper.tsx`)

Thin wrapper around `FocusLifecycleWrapper` for modal-specific behavior:

```typescript
export function ModalWrapper({ focusId, isOpen, children, onFocusActivated, onFocusRestored }) {
  return (
    <FocusLifecycleWrapper
      focusId={focusId}
      isActive={isOpen}
      renderWhenInactive={false}        // Modal-specific: hide when closed
      onFocusActivated={onFocusActivated}
      onFocusRestored={onFocusRestored}
    >
      {children}
    </FocusLifecycleWrapper>
  );
}
```

### 5. useLaceFocus Hook (`use-lace-focus.ts`)

Component-level focus participation:

```typescript
function useLaceFocus(id: string, options?: { autoFocus?: boolean }) {
  const { currentFocus } = useLaceFocusContext();
  const { isFocused } = useFocus({ id, autoFocus: options?.autoFocus });
  
  return {
    isFocused: currentFocus === id && isFocused, // Both Lace and Ink must agree
    takeFocus: () => pushFocus(id),
    isInFocusPath: currentFocus.includes(id),
  };
}
```

### 6. Focus Regions (`focus-regions.ts`)

Type-safe focus ID constants:

```typescript
export const FocusRegions = {
  shell: 'shell-input',
  timeline: 'timeline',
  autocomplete: 'autocomplete',
  modal: (type: string) => `modal-${type}`,
  delegate: (threadId: string) => `delegate-${threadId}`,
} as const;
```

## Critical Insight: Ink's Event System

**Key Understanding**: Ink's `useInput` hooks create **global keyboard listeners** - all active hooks receive every keystroke simultaneously. This is **not** like DOM event bubbling where you can `preventDefault()`.

```typescript
// ❌ THIS DOESN'T WORK - "consuming" events doesn't prevent other handlers
useInput((input, key) => {
  if (key.leftArrow) {
    handleLeftArrow();
    return; // ❌ Other useInput hooks still get this event!
  }
}, { isActive: isFocused });

// ✅ THIS WORKS - coordinate via focus context
useInput((input, key) => {
  const isMainTimeline = focusRegion === FocusRegions.timeline;
  const isInDelegateContext = currentFocus.startsWith('delegate-');
  
  if (isMainTimeline && isInDelegateContext) {
    return; // ✅ Explicitly ignore based on focus state
  }
  
  if (key.leftArrow) {
    handleLeftArrow();
  }
}, { isActive: isFocused });
```

## Event Isolation Patterns

### Timeline Focus Isolation

**Problem**: Multiple timelines (main + delegates) receiving the same keyboard events.

**Solution**: Focus region scoping in `TimelineViewport`:

```typescript
// TimelineViewport.tsx - Event isolation logic
const { currentFocus } = useLaceFocusContext();

useInput((input, key) => {
  // Only process events if this timeline should handle them
  const isMainTimeline = (focusRegion || FocusRegions.timeline) === FocusRegions.timeline;
  const isInDelegateContext = currentFocus.startsWith('delegate-');
  
  if (isMainTimeline && isInDelegateContext) {
    return; // Let delegate timeline handle all keys
  }

  // Process navigation keys...
}, { isActive: isFocused });
```

### Event Emitter Isolation

**Problem**: Timeline expansion events bleeding between main and delegate timelines.

**Solution**: Each timeline gets its own `TimelineExpansionProvider`:

```typescript
// DelegateToolRenderer.tsx - Isolated event emitters
<TimelineExpansionProvider>  {/* Creates isolated ExpansionEmitter */}
  <TimelineDisplay 
    timeline={delegateTimeline} 
    focusRegion={FocusRegions.delegate(threadId)}
  />
</TimelineExpansionProvider>
```

This ensures expansion events (left/right arrows) only affect the intended timeline.

## Usage Patterns

### Basic Focusable Component

```typescript
function MyComponent() {
  const { isFocused } = useLaceFocus(FocusRegions.timeline);
  
  useInput((input, key) => {
    if (!isFocused) return;
    
    // Handle navigation keys
    if (key.upArrow) navigateUp();
    if (key.downArrow) navigateDown();
    // No need to handle Escape - LaceFocusProvider does it
  }, { isActive: isFocused });
  
  return <Box>...</Box>;
}
```

### Modal Pattern

```typescript
function ApprovalModal({ isOpen, onClose }) {
  return (
    <ModalWrapper
      focusId={FocusRegions.modal('approval')}
      isOpen={isOpen}
      onFocusRestored={onClose}
    >
      <Box>Modal content...</Box>
    </ModalWrapper>
  );
}
```

### Timeline Item Focus Pattern

```typescript
function DelegateToolRenderer({ item, isSelected }) {
  const [isEntered, setIsEntered] = useState(false);
  const delegateThreadId = extractDelegateThreadId(item);
  const { isFocused } = useLaceFocus(
    delegateThreadId ? FocusRegions.delegate(delegateThreadId) : 'none'
  );

  // Listen for timeline focus entry events
  useTimelineItemFocusEntry(isSelected, () => {
    setIsEntered(true);
  });

  // Handle keyboard when focused
  useInput((input, key) => {
    if (!isFocused) return;
    
    if (key.escape) {
      setIsEntered(false); // Triggers FocusLifecycleWrapper cleanup
    }
  }, { isActive: isFocused });

  return (
    <FocusLifecycleWrapper
      focusId={delegateThreadId ? FocusRegions.delegate(delegateThreadId) : 'none'}
      isActive={isEntered}
      renderWhenInactive={true}
      onFocusRestored={() => setIsEntered(false)}
    >
      <TimelineEntryCollapsibleBox isFocused={isFocused} isSelected={isSelected}>
        {/* Nested timeline with isolated events */}
        <TimelineExpansionProvider>
          <TimelineDisplay 
            timeline={delegateTimeline}
            focusRegion={FocusRegions.delegate(delegateThreadId)}
          />
        </TimelineExpansionProvider>
      </TimelineEntryCollapsibleBox>
    </FocusLifecycleWrapper>
  );
}
```

## Debugging Tools

### Focus Debug Panel

Toggle with `/debug-focus` command or programmatically:

```typescript
// Shows real-time focus state
const userInterface: UserInterface = {
  toggleFocusDebugPanel(): boolean {
    setIsFocusDebugVisible(prev => !prev);
    return !isFocusDebugVisible;
  }
};
```

The debug panel displays:
- Current focus stack
- Active focus regions
- Focus transitions and events

### Logging

The focus system includes comprehensive debug logging:

```typescript
logger.debug('LaceFocusProvider: Global escape pressed', {
  currentFocus,
  stackBefore: focusStackRef.current.getStack(),
});
```

Enable with `DEBUG=lace:focus` environment variable.

## Testing Patterns

### Unit Tests

```typescript
describe('FocusStack', () => {
  it('prevents duplicate consecutive pushes', () => {
    const stack = new FocusStack();
    expect(stack.current()).toBe('shell-input');
    
    const result1 = stack.push('timeline');
    const result2 = stack.push('timeline'); // Duplicate
    
    expect(result1).toBe('timeline');
    expect(result2).toBe('timeline');
    expect(stack.getStack()).toEqual(['shell-input', 'timeline']); // Only one
  });
});
```

### Integration Tests

```typescript
describe('Timeline Focus Integration', () => {
  it('isolates events between main and delegate timelines', async () => {
    const { mockInput, queryByTestId } = renderTimelineWithDelegate();
    
    // Enter delegate focus
    fireEvent.click(getByTestId('delegate-item'));
    mockInput('', { return: true });
    
    // Navigate in delegate timeline
    mockInput('', { downArrow: true });
    
    // Verify main timeline cursor didn't move
    expect(queryByTestId('main-timeline-cursor')).toHaveAttribute('data-line', '0');
  });
});
```

### Test Utilities

```typescript
// Mock focus context for component tests
function mockLaceFocusContext(currentFocus = 'timeline') {
  return {
    currentFocus,
    pushFocus: vi.fn(),
    popFocus: vi.fn(),
    getFocusStack: () => ['shell-input', currentFocus],
    isFocusActive: (id: string) => id === currentFocus,
  };
}
```

## Common Pitfalls

### 1. Event Consumption Assumption

**❌ Wrong**: Trying to "consume" events in `useInput`
```typescript
useInput((input, key) => {
  if (key.leftArrow) {
    handleArrow();
    return; // ❌ Doesn't prevent other handlers
  }
}, { isActive: true });
```

**✅ Correct**: Coordinate via focus context
```typescript
useInput((input, key) => {
  if (!shouldHandleEvents()) return; // ✅ Check focus context first
  
  if (key.leftArrow) {
    handleArrow();
  }
}, { isActive: isFocused });
```

### 2. Focus Stack Corruption

**❌ Wrong**: Manual focus management
```typescript
const { pushFocus, popFocus } = useLaceFocusContext();

useEffect(() => {
  if (isOpen) pushFocus('my-modal');
  return () => popFocus(); // ❌ Runs on every re-render
}, [isOpen, pushFocus, popFocus]); // ❌ Dependencies cause re-renders
```

**✅ Correct**: Use `FocusLifecycleWrapper`
```typescript
<FocusLifecycleWrapper
  focusId="my-modal"
  isActive={isOpen}
  renderWhenInactive={false}
>
  {children}
</FocusLifecycleWrapper>
```

### 3. Missing Event Isolation

**❌ Wrong**: Nested timelines without isolation
```typescript
<TimelineDisplay timeline={mainTimeline} />
  <SomeComponent>
    <TimelineDisplay timeline={delegateTimeline} /> {/* ❌ Shares events */}
  </SomeComponent>
```

**✅ Correct**: Isolate with separate providers
```typescript
<TimelineExpansionProvider>
  <TimelineDisplay timeline={mainTimeline} />
</TimelineExpansionProvider>

<TimelineExpansionProvider> {/* ✅ Isolated */}
  <TimelineDisplay 
    timeline={delegateTimeline}
    focusRegion={FocusRegions.delegate(threadId)}
  />
</TimelineExpansionProvider>
```

## Focus Flow Examples

### Example 1: Basic Navigation
1. App starts with focus on `shell-input`
2. User presses Escape → focus moves to `timeline`
3. User presses Escape again → focus returns to `shell-input`

```
Stack: ['shell-input'] → ['shell-input', 'timeline'] → ['shell-input']
```

### Example 2: Delegate Timeline Entry
1. User navigates to delegate item in timeline
2. User presses Return → focus enters delegate
3. User navigates within delegate timeline
4. User presses Escape → focus returns to main timeline

```
Stack: ['shell-input', 'timeline'] 
    → ['shell-input', 'timeline', 'delegate-abc123']
    → ['shell-input', 'timeline']
```

### Example 3: Modal Interaction
1. Tool approval modal appears
2. Focus automatically pushed to modal
3. User makes decision
4. Modal closes, focus automatically restored

```
Stack: ['shell-input'] → ['shell-input', 'modal-approval'] → ['shell-input']
```

## Benefits

1. **No Prop Drilling**: Focus behavior accessed via hooks and context
2. **Automatic Lifecycle**: `FocusLifecycleWrapper` handles complex push/pop logic
3. **Event Isolation**: Multiple timelines don't interfere with each other
4. **Consistent Navigation**: Escape always goes "back" in a predictable way
5. **Type Safety**: Focus regions prevent typos and provide autocomplete
6. **Testable**: Clear interfaces and isolated components
7. **Debuggable**: Comprehensive logging and debug panel

## Performance Considerations

1. **Memoized Context**: `LaceFocusProvider` memoizes context value to prevent re-render cycles
2. **Stable Refs**: Focus stack uses `useRef` to avoid dependency changes
3. **Event Handler Gating**: All `useInput` handlers check `isFocused` before processing
4. **Cleanup Delays**: `FocusLifecycleWrapper` uses `setTimeout(0)` to handle React re-render cycles

## Migration Guide

When adding focus to a new component:

1. **Identify Focus Region**: Choose appropriate `FocusRegions` constant
2. **Use `useLaceFocus`**: Replace any direct `useFocus` calls
3. **Gate Input Handlers**: Always check `isFocused` in `useInput`
4. **Use Lifecycle Wrapper**: For components that need automatic focus management
5. **Add Event Isolation**: For nested interactive components
6. **Consider Expansion Isolation**: For components with timeline-like expansion behavior

## Future Enhancements

The focus stack pattern enables:

1. **Focus History**: Could maintain history for forward navigation
2. **Focus Persistence**: Could save/restore focus state across sessions  
3. **Smart Focus Memory**: Could remember last focused item when returning to regions
4. **Focus Shortcuts**: Could add keyboard shortcuts to jump to specific regions
5. **Visual Focus Indicators**: Could show breadcrumb-style focus depth
6. **Focus Analytics**: Could track navigation patterns for UX improvements