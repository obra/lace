# Timeline Entry Focus Implementation Plan

## Overview

Enable users to "enter" timeline items (like DelegationToolRenderer) by pressing Return, giving keyboard focus to the item's internal interface. This requires generalizing the modal focus pattern to work with timeline items.

## Core Changes

### 1. Generalize ModalWrapper → FocusLifecycleWrapper

**Why**: ModalWrapper implements generic "auto-manage focus stack based on boolean" pattern that applies beyond modals.

**Files to Change**:
- `src/interfaces/terminal/focus/focus-lifecycle-wrapper.tsx` (NEW)
- `src/interfaces/terminal/focus/modal-wrapper.tsx` (REFACTOR)
- `src/interfaces/terminal/focus/index.ts` (UPDATE exports)

**New Component**: `FocusLifecycleWrapper`
```typescript
interface FocusLifecycleWrapperProps {
  focusId: string;
  isActive: boolean;                    // Generic trigger (was isOpen)
  children: ReactNode;
  renderWhenInactive?: boolean;         // true=always render, false=hide when inactive
  onFocusActivated?: () => void;
  onFocusRestored?: () => void;
}
```

**Refactored Component**: `ModalWrapper` becomes thin wrapper:
```typescript
export function ModalWrapper(props: ModalWrapperProps) {
  return (
    <FocusLifecycleWrapper
      focusId={props.focusId}
      isActive={props.isOpen}
      renderWhenInactive={false}        // Modal-specific: hide when closed
      onFocusActivated={props.onFocusActivated}
      onFocusRestored={props.onFocusRestored}
    >
      {props.children}
    </FocusLifecycleWrapper>
  );
}
```

### 2. Add Timeline Return Key Handling

**Why**: Timeline currently forwards Return key but doesn't handle it. Need to detect focusable items and trigger entry.

**Files to Change**:
- `src/interfaces/terminal/components/timeline-display.tsx` (UPDATE)

**Add to `handleItemInteraction`**:
```typescript
const handleItemInteraction = useCallback(
  (selectedItemIndex: number, input: string, key: any) => {
    if (key.leftArrow) {
      emitCollapse();
    } else if (key.rightArrow) {
      emitExpand();
    } else if (key.return) {
      // NEW: Check if selected item can accept focus
      const selectedItem = timelineItems[selectedItemIndex];
      if (selectedItem && canTimelineItemAcceptFocus(selectedItem)) {
        enterTimelineItem(selectedItem);
      }
    }
  },
  [emitCollapse, emitExpand, timelineItems, enterTimelineItem]
);
```

### 3. Create Timeline Item Focus Interface

**Why**: Need type-safe way to identify and interact with focusable timeline items.

**Files to Change**:
- `src/interfaces/terminal/components/timeline-item-focus.ts` (NEW)

**New Interface**:
```typescript
// Timeline items that can accept keyboard focus
export interface TimelineItemFocusable {
  canAcceptFocus(): boolean;
  onEnterFocus(): void;
  onExitFocus(): void;
  getFocusId(): string;
}

// Check if timeline item supports focus
export function canTimelineItemAcceptFocus(item: TimelineItem): boolean {
  // Check if item is delegate tool call with active thread
  return item.type === 'tool_call' && 
         item.tool_name === 'delegate' &&
         item.status === 'completed' &&
         isDelegateToolCallResult(item.result);
}

// Get focus ID for timeline item
export function getTimelineItemFocusId(item: TimelineItem): string | null {
  if (item.type === 'tool_call' && item.tool_name === 'delegate') {
    const threadId = extractDelegateThreadId(item.result);
    return threadId ? FocusRegions.delegate(threadId) : null;
  }
  return null;
}
```

### 4. Update DelegationToolRenderer

**Why**: Make delegation renderer focusable and handle keyboard input when focused.

**Files to Change**:
- `src/interfaces/terminal/components/tools/delegate-tool-renderer.tsx` (UPDATE)

**Add Focus State Management**:
```typescript
export function DelegateToolRenderer({ toolCall, result, isExpanded, isSelected }) {
  const delegateThreadId = extractDelegateThreadId(result);
  const [isEntered, setIsEntered] = useState(false);
  const { isFocused } = useLaceFocus(delegateThreadId ? FocusRegions.delegate(delegateThreadId) : 'none');

  // Handle keyboard input when focused
  useInput((input, key) => {
    if (!isFocused) return;
    
    if (key.escape) {
      setIsEntered(false); // Will trigger focus pop via FocusLifecycleWrapper
    }
    // Forward other keys to embedded timeline if needed
  }, { isActive: isFocused });

  // Public interface for timeline to trigger focus entry
  useImperativeHandle(ref, () => ({
    enterFocus: () => setIsEntered(true),
  }), []);

  return (
    <FocusLifecycleWrapper
      focusId={delegateThreadId ? FocusRegions.delegate(delegateThreadId) : 'none'}
      isActive={isEntered}
      renderWhenInactive={true}
      onFocusRestored={() => setIsEntered(false)}
    >
      <DelegationBox isFocused={isFocused} isSelected={isSelected}>
        {/* existing content */}
      </DelegationBox>
    </FocusLifecycleWrapper>
  );
}
```

### 5. Update Timeline Item Integration

**Why**: Timeline needs way to trigger focus entry on specific items.

**Files to Change**:
- `src/interfaces/terminal/components/timeline-item.tsx` (UPDATE)
- `src/interfaces/terminal/components/timeline-display.tsx` (UPDATE)

**Add Ref Forwarding to TimelineItem**:
```typescript
export const TimelineItem = forwardRef<TimelineItemRef, TimelineItemProps>((props, ref) => {
  const toolRendererRef = useRef<{ enterFocus?: () => void }>(null);
  
  useImperativeHandle(ref, () => ({
    enterFocus: () => {
      toolRendererRef.current?.enterFocus?.();
    },
  }), []);

  return (
    <Box>
      {/* Pass ref to tool renderer */}
      {getToolRenderer(props.item, { ref: toolRendererRef, ...otherProps })}
    </Box>
  );
});
```

**Update TimelineDisplay to Use Refs**:
```typescript
const timelineItemRefs = useRef<(TimelineItemRef | null)[]>([]);

const enterTimelineItem = useCallback((itemIndex: number) => {
  const itemRef = timelineItemRefs.current[itemIndex];
  itemRef?.enterFocus?.();
}, []);
```

### 6. Add Visual Focus Indicators

**Why**: Users need clear visual feedback about focus state vs selection state.

**Files to Change**:
- `src/interfaces/terminal/components/tools/delegation-box.tsx` (UPDATE)

**Update DelegationBox Props**:
```typescript
interface DelegationBoxProps {
  isFocused?: boolean;  // NEW: True when component has keyboard focus
  isSelected?: boolean; // Existing: True when timeline cursor is on this item
  // ... other props
}

export function DelegationBox({ isFocused, isSelected, children, ...props }) {
  // Different visual states:
  // - Selected but not focused: dim border
  // - Focused: bright border + different color
  // - Neither: no border
  
  const borderColor = isFocused ? 'yellow' : (isSelected ? 'dim' : 'gray');
  const borderStyle = isFocused ? 'double' : 'single';
  
  return (
    <Box borderStyle={borderStyle} borderColor={borderColor}>
      {children}
    </Box>
  );
}
```

## Testing Strategy

### Unit Tests

**New Test Files**:
- `src/interfaces/terminal/focus/focus-lifecycle-wrapper.test.tsx`
- `src/interfaces/terminal/components/timeline-item-focus.test.ts`

**Updated Test Files**:
- `src/interfaces/terminal/focus/modal-wrapper.test.tsx` (verify no regression)
- `src/interfaces/terminal/components/tools/delegate-tool-renderer.test.tsx`
- `src/interfaces/terminal/components/timeline-display.test.tsx`

**Test Cases**:

1. **FocusLifecycleWrapper**:
   ```typescript
   test('pushes focus when isActive becomes true', () => {
     const { pushFocus } = mockLaceFocusContext();
     render(<FocusLifecycleWrapper focusId="test" isActive={true}>content</FocusLifecycleWrapper>);
     expect(pushFocus).toHaveBeenCalledWith('test');
   });

   test('pops focus when isActive becomes false', () => {
     const { popFocus } = mockLaceFocusContext();
     const { rerender } = render(
       <FocusLifecycleWrapper focusId="test" isActive={true}>content</FocusLifecycleWrapper>
     );
     rerender(<FocusLifecycleWrapper focusId="test" isActive={false}>content</FocusLifecycleWrapper>);
     expect(popFocus).toHaveBeenCalled();
   });

   test('renders children when renderWhenInactive=true and isActive=false', () => {
     const { getByText } = render(
       <FocusLifecycleWrapper focusId="test" isActive={false} renderWhenInactive={true}>
         test content
       </FocusLifecycleWrapper>
     );
     expect(getByText('test content')).toBeInTheDocument();
   });
   ```

2. **Timeline Item Focus Detection**:
   ```typescript
   test('identifies delegate tool calls as focusable', () => {
     const delegateToolCall = createMockDelegateToolCall();
     expect(canTimelineItemAcceptFocus(delegateToolCall)).toBe(true);
   });

   test('non-delegate items are not focusable', () => {
     const bashToolCall = createMockBashToolCall();
     expect(canTimelineItemAcceptFocus(bashToolCall)).toBe(false);
   });
   ```

3. **DelegationToolRenderer Focus**:
   ```typescript
   test('enters focus when enterFocus called', () => {
     const ref = createRef();
     render(<DelegateToolRenderer ref={ref} {...mockProps} />);
     
     act(() => {
       ref.current.enterFocus();
     });
     
     expect(mockPushFocus).toHaveBeenCalledWith(expect.stringContaining('delegate-'));
   });

   test('exits focus on escape key', () => {
     const { mockInput } = render(<DelegateToolRenderer {...mockProps} />);
     
     // Enter focus first
     act(() => ref.current.enterFocus());
     
     // Press escape
     mockInput('', { escape: true });
     
     expect(mockPopFocus).toHaveBeenCalled();
   });
   ```

### Integration Tests

**Test Files**:
- `src/interfaces/terminal/components/timeline-display.integration.test.tsx`

**Test Cases**:
```typescript
test('return key enters focusable timeline item', async () => {
  const { mockInput, getByTestId } = renderTimelineWithDelegateItem();
  
  // Navigate to delegate item
  mockInput('', { downArrow: true });
  
  // Press return to enter
  mockInput('', { return: true });
  
  // Verify focus was pushed
  expect(mockPushFocus).toHaveBeenCalledWith(expect.stringContaining('delegate-'));
  
  // Verify visual focus indicator
  expect(getByTestId('delegation-box')).toHaveClass('focused');
});

test('escape exits timeline item focus', async () => {
  const { mockInput } = renderTimelineWithFocusedDelegateItem();
  
  // Press escape
  mockInput('', { escape: true });
  
  // Verify focus was popped
  expect(mockPopFocus).toHaveBeenCalled();
});
```

### E2E Tests

**Test Files**:
- `src/interfaces/terminal/terminal-interface.e2e.test.ts`

**Test Cases**:
```typescript
test('user can enter and exit delegate timeline items', async () => {
  const { sendInput, waitForText } = createE2ETerminal();
  
  // Create delegate task
  await sendInput('delegate "test task"');
  await waitForText('Delegate task created');
  
  // Navigate to timeline
  await sendInput('\u001b'); // Escape to timeline
  
  // Navigate to delegate item
  await sendInput('\u001b[B'); // Down arrow
  
  // Enter delegate item
  await sendInput('\r'); // Return key
  
  // Verify we're in delegate focus (escape works differently)
  await sendInput('\u001b'); // Escape should pop focus, not go to shell
  
  // Should be back in timeline, not shell
  await sendInput('\u001b'); // This escape should go to shell
  await waitForText('What can I help with?');
});
```

## Implementation Task List

### Phase 1: Generalize Focus Pattern
1. [ ] Create `FocusLifecycleWrapper` component with full interface
2. [ ] Add comprehensive unit tests for `FocusLifecycleWrapper`
3. [ ] Refactor `ModalWrapper` to use `FocusLifecycleWrapper`
4. [ ] Run existing modal tests to ensure no regression
5. [ ] Update focus index exports

### Phase 2: Timeline Item Focus Infrastructure
6. [ ] Create `timeline-item-focus.ts` with detection utilities
7. [ ] Add unit tests for focus detection functions
8. [ ] Update `TimelineDisplay` to handle Return key
9. [ ] Add `TimelineItem` ref forwarding system
10. [ ] Add integration tests for timeline Return key handling

### Phase 3: Delegation Renderer Focus
11. [ ] Update `DelegationToolRenderer` with focus lifecycle
12. [ ] Add keyboard handling for focused delegation renderer
13. [ ] Update `DelegationBox` visual states
14. [ ] Add unit tests for delegation renderer focus behavior
15. [ ] Test delegation renderer keyboard interactions

### Phase 4: Visual and UX Polish
16. [ ] Ensure focus indicators are visually distinct from selection
17. [ ] Test focus behavior with expanded/collapsed states
18. [ ] Verify focus works with timeline scrolling
19. [ ] Add accessibility labels for screen readers

### Phase 5: Integration and E2E
20. [ ] Add timeline focus integration tests
21. [ ] Add E2E tests for complete user workflows
22. [ ] Test edge cases (rapid key presses, unmounting, etc.)
23. [ ] Performance test with large timelines

## Naming Conventions

- **Components**: `FocusLifecycleWrapper`, `TimelineItem`, `DelegationBox`
- **Props**: `isActive` (not `isOpen`), `isFocused` (not `hasFocus`), `renderWhenInactive`
- **Functions**: `canTimelineItemAcceptFocus()`, `getTimelineItemFocusId()`, `enterTimelineItem()`
- **Types**: `TimelineItemFocusable`, `TimelineItemRef`
- **Test Files**: `*.test.tsx` for components, `*.integration.test.tsx` for multi-component, `*.e2e.test.ts` for full workflows

## Code That Can Be Removed

**Nothing should be removed** - this is purely additive to avoid breaking changes:
- `ModalWrapper` becomes a thin wrapper, but keeps same interface
- All existing focus functionality remains unchanged
- Timeline keeps all existing keyboard behavior, just adds Return handling

## Pitfalls and Risks

### 1. Focus Stack Corruption
**Risk**: Improper cleanup could leave focus stack in bad state
**Prevention**: 
- Always use `FocusLifecycleWrapper` for automatic cleanup
- Add focus stack validation in development mode
- Test focus cleanup on component unmount

### 2. Keyboard Event Conflicts
**Risk**: Multiple components trying to handle same keys
**Prevention**:
- Always gate `useInput` with `{ isActive: isFocused }`
- Clear hierarchy: timeline handles navigation, items handle interaction
- Document which component handles which keys

### 3. Visual State Confusion
**Risk**: Users confused between "selected" vs "focused" items
**Prevention**:
- Clearly distinct visual styles (selection = dim, focus = bright)
- Consistent terminology in code and UI
- User testing with clear expectations

### 4. Performance with Large Timelines
**Risk**: Too many refs/focus handlers slow down rendering
**Prevention**:
- Only create refs for currently visible timeline items
- Virtualize timeline if needed (future enhancement)
- Profile timeline rendering with 100+ items

### 5. Ref Forwarding Complexity
**Risk**: Complex ref chains hard to debug
**Prevention**:
- Keep ref interface minimal (`{ enterFocus?: () => void }`)
- Add ref validation in development mode
- Clear documentation of ref flow

### 6. Focus vs Expansion State Conflicts
**Risk**: Focus and expansion getting out of sync
**Prevention**:
- Keep focus and expansion as separate concerns
- Focus works regardless of expansion state
- Test all combinations of focus/expansion/selection

## Success Criteria

1. [ ] User can press Return on delegate timeline items to enter focus
2. [ ] User can press Escape to exit timeline item focus
3. [ ] Visual distinction between selected vs focused timeline items
4. [ ] No regression in existing modal focus behavior
5. [ ] No performance degradation in timeline rendering
6. [ ] All existing tests continue to pass
7. [ ] New functionality has >95% test coverage
8. [ ] E2E test demonstrates complete user workflow

## Documentation Updates

After implementation:
- Update focus system docs with new `FocusLifecycleWrapper` pattern
- Add timeline interaction guide with Return/Escape keys
- Update keyboard shortcuts reference
- Add examples of making timeline items focusable

This plan provides a clean, incremental path to timeline entry focus while maintaining the existing architecture's strengths and avoiding breaking changes.