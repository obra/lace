# Timeline Auto-Scroll Implementation Plan

## Overview

Implement auto-scrolling to recent changes in the timeline view, with smooth line-by-line animation and focus-aware behavior. Never auto-scroll when timeline is focused.

## Prerequisites

### Understanding the Codebase

**Timeline Architecture (Event-Sourcing)**:
- Conversations are immutable event sequences
- Timeline displays processed events via `ThreadProcessor`
- Components: `TimelineDisplay` → `TimelineViewport` → `TimelineContent` → `TimelineItem`

**Key Files to Study**:
```
src/interfaces/terminal/components/events/
├── TimelineDisplay.tsx           # Top-level orchestrator
├── TimelineViewport.tsx          # Viewport + keyboard nav
├── TimelineContent.tsx           # Content rendering
├── hooks/useTimelineViewport.ts  # Viewport state management
└── __tests__/                    # Existing test suite
```

**Focus System**:
- Hierarchical focus with regions: `shell`, `timeline`, `delegate-{id}`
- Located in `src/interfaces/terminal/focus/`
- `useLaceFocus()` hook provides focus state per region

**Technology Stack**:
- **Ink**: React for terminal UIs (like React DOM but for CLI)
- **TypeScript**: Strict mode, no `any` types
- **Vitest**: Testing framework
- **Event-driven**: Components communicate via events, not direct calls

### Ink-Specific Concepts

**Key Differences from React DOM**:
- Uses `<Box>` instead of `<div>`, `<Text>` instead of `<span>`
- Layout via flexbox properties (`flexDirection`, `marginTop`)
- No CSS transitions - use `useState` + `setInterval` for animation
- `measureElement()` for getting actual rendered dimensions
- `useInput()` for keyboard handling instead of `onKeyDown`

**Performance Notes**:
- Every state change triggers re-render
- Terminal can handle ~20 FPS animation smoothly
- Use `useCallback` and `useMemo` for expensive operations

## Current Timeline Scrolling Behavior

**Existing Logic** (`src/interfaces/terminal/components/events/hooks/useTimelineViewport.ts`):

1. **Auto-scroll to selection**: Lines 106-118 - viewport follows selected line
2. **Bottom initialization**: Lines 125-144 - new content starts at bottom  
3. **Manual navigation**: Lines 147-181 - up/down/page/top/bottom navigation

**Focus Integration** (`src/interfaces/terminal/components/events/TimelineViewport.tsx`):

1. **Focus isolation**: Lines 89-104 - main timeline ignores keys during delegate focus
2. **Cursor display**: Lines 167-178 - white ">" cursor when focused
3. **Input handling**: Lines 78-135 - keyboard navigation with `useInput()`

## Implementation Plan

### Task 1: Add Auto-Scroll State to Viewport Hook

**File**: `src/interfaces/terminal/components/events/hooks/useTimelineViewport.ts`

**Test First**: Create `useTimelineViewport.auto-scroll.test.ts`

```typescript
// Test cases to write:
describe('useTimelineViewport auto-scroll', () => {
  it('should not auto-scroll when focused');
  it('should auto-scroll to bottom on startup when not focused');
  it('should auto-scroll to new content when not focused');
  it('should cancel auto-scroll when focus is gained');
  it('should animate line-by-line to target');
  it('should jump directly for small distances');
});
```

**Implementation**:

1. Add auto-scroll state interface:
```typescript
interface AutoScrollState {
  isAutoScrolling: boolean;
  targetLine: number;
  animationId: NodeJS.Timeout | null;
}
```

2. Add to hook parameters:
```typescript
export interface UseTimelineViewportOptions {
  timeline: Timeline;
  viewportLines: number;
  itemRefs: React.MutableRefObject<Map<number, unknown>>;
  isFocused: boolean; // NEW
}
```

3. Add auto-scroll state management
4. Add animation logic with `setInterval`
5. Export cancellation function

**Commit**: "Add auto-scroll state management to useTimelineViewport hook"

### Task 2: Implement Smooth Animation Logic

**File**: Continue in `src/interfaces/terminal/components/events/hooks/useTimelineViewport.ts`

**Test Cases**:
- Animation speed (50ms intervals)
- Direction handling (up/down)
- Target reaching
- Early termination

**Implementation**:

1. `smoothScrollToLine` function with focus check
2. Animation cleanup on unmount
3. Integration with existing scroll triggers
4. Distance-based animation vs. jump logic

**Commit**: "Implement smooth line-by-line auto-scroll animation"

### Task 3: Integrate Focus State from TimelineViewport

**File**: `src/interfaces/terminal/components/events/TimelineViewport.tsx`

**Test Cases**:
- Focus state passing
- Auto-scroll cancellation on input
- Delegate context isolation

**Implementation**:

1. Pass `isFocused` to viewport hook
2. Call cancellation on any `useInput` activity
3. Verify delegate focus isolation still works

**Test File**: Update existing `TimelineViewport.test.tsx`

**Commit**: "Connect auto-scroll to timeline focus state"

### Task 4: Add Auto-Scroll Triggers

**File**: Continue in `src/interfaces/terminal/components/events/hooks/useTimelineViewport.ts`

**Test Cases**:
- Startup behavior (empty → content)
- New content behavior (content addition)
- Content expansion behavior (height changes)
- Focus state respect in all scenarios

**Implementation**:

1. Modify startup scroll logic (lines 125-144)
2. Add trigger for new content detection
3. Add trigger for content height changes
4. Ensure all triggers check focus state

**Commit**: "Add auto-scroll triggers for startup and new content"

### Task 5: Handle Edge Cases and Cleanup

**Files**: Both viewport hook and component

**Test Cases**:
- Rapid focus changes
- Timeline unmounting during animation
- Zero content height
- Measurement delays
- Multiple rapid content additions

**Implementation**:

1. Cleanup intervals on unmount
2. Handle edge cases in animation logic
3. Add defensive programming for timing issues
4. Performance optimization for rapid changes

**Commit**: "Add auto-scroll edge case handling and cleanup"

### Task 6: Integration Testing

**File**: Create `src/interfaces/terminal/components/events/__tests__/auto-scroll-integration.test.tsx`

**Test Scenarios**:
- Full timeline interaction with focus changes
- Agent response simulation with auto-scroll
- Manual navigation interrupting auto-scroll
- Delegate focus interaction
- Multiple timeline instances (if applicable)

**Implementation**:
1. Mock agent responses
2. Simulate user interactions
3. Test focus transitions
4. Verify smooth animation behavior

**Commit**: "Add comprehensive auto-scroll integration tests"

## Testing Strategy

### Unit Tests (TDD Approach)

1. **Hook Tests**: `useTimelineViewport.auto-scroll.test.ts`
   - Test auto-scroll state management
   - Test animation logic
   - Test focus integration
   - Mock `setInterval`/`clearInterval`

2. **Component Tests**: Update `TimelineViewport.test.tsx`
   - Test focus state passing
   - Test input cancellation
   - Test visual behavior

### Integration Tests

1. **Focus Integration**: Extend `timeline-focus-integration.test.tsx`
   - Auto-scroll during focus transitions
   - Delegate context isolation

2. **End-to-End**: New `auto-scroll-integration.test.tsx`
   - Full user interaction scenarios
   - Agent response handling

### Manual Testing

**Setup**:
```bash
npm run build
npm start
```

**Test Scenarios**:
1. Start conversation → should auto-scroll to bottom
2. Type message → focus timeline → verify no auto-scroll on response
3. Unfocus timeline → send message → verify smooth auto-scroll
4. Focus timeline during animation → verify cancellation
5. Test with delegate tools that create sub-timelines

## Implementation Details

### Animation Configuration

```typescript
const ANIMATION_INTERVAL_MS = 50; // 20 FPS
const JUMP_THRESHOLD = 1; // Lines - jump if closer than this
```

### Focus Detection Logic

```typescript
const shouldAutoScroll = useCallback((isFocused: boolean, currentFocus: string) => {
  // Don't auto-scroll if timeline is focused
  if (isFocused) return false;
  
  // Don't auto-scroll if in delegate context (for main timeline)
  const isMainTimeline = focusRegion === FocusRegions.timeline;
  const isInDelegateContext = currentFocus.startsWith('delegate-');
  if (isMainTimeline && isInDelegateContext) return false;
  
  return true;
}, [focusRegion]);
```

### Animation State Management

```typescript
const animateToLine = useCallback((targetLine: number) => {
  if (!shouldAutoScroll()) return;
  
  const distance = Math.abs(targetLine - selectedLine);
  if (distance <= JUMP_THRESHOLD) {
    setSelectedLine(targetLine);
    return;
  }
  
  // Start animation
  const animationId = setInterval(() => {
    setSelectedLine(current => {
      const diff = targetLine - current;
      if (Math.abs(diff) <= 1) {
        clearInterval(animationId);
        return targetLine;
      }
      return current + Math.sign(diff);
    });
  }, ANIMATION_INTERVAL_MS);
  
  setAutoScrollState(prev => ({ ...prev, animationId }));
}, [selectedLine, shouldAutoScroll]);
```

## Documentation Updates

### Files to Update

1. **Component Documentation**: Update JSDoc in modified files
2. **Architecture Documentation**: Update any existing timeline docs
3. **CLAUDE.md**: Add auto-scroll behavior notes if timeline section exists

### Key Points to Document

- Auto-scroll respects focus state
- Animation can be interrupted by user input
- Performance characteristics (20 FPS)
- Focus isolation behavior

## Deployment Considerations

### Performance Impact

- Minimal - only animates when not focused
- 50ms intervals acceptable for terminal rendering
- Animation stops during user interaction

### Backward Compatibility

- No breaking changes to existing API
- All changes are additive
- Existing navigation behavior unchanged

### Rollback Plan

- Auto-scroll is isolated in viewport hook
- Can disable by not passing `isFocused` parameter
- Existing manual navigation remains functional

## Success Criteria

1. **Startup**: Timeline auto-scrolls to bottom when loaded (unfocused)
2. **Agent Responses**: Timeline auto-scrolls to new content (unfocused)
3. **Focus Respect**: No auto-scroll when timeline is focused
4. **Smooth Animation**: Line-by-line scrolling, not jumps
5. **Interruption**: User input cancels auto-scroll immediately
6. **Performance**: No noticeable performance degradation
7. **Tests**: 100% test coverage for new functionality
8. **Integration**: Works with existing focus isolation system

## Risk Mitigation

### Technical Risks

1. **Animation Performance**: Monitor terminal performance, add configuration if needed
2. **Focus Edge Cases**: Comprehensive testing of focus transitions
3. **Timing Issues**: Defensive programming for measurement delays

### UX Risks

1. **Motion Sensitivity**: Consider making animation speed configurable
2. **Unexpected Behavior**: Clear documentation of when auto-scroll occurs
3. **Focus Confusion**: Ensure focus indicators remain clear

### Testing Risks

1. **Timing-Dependent Tests**: Use proper mocking for intervals
2. **Terminal Environment**: Test in various terminal configurations
3. **Focus State Complexity**: Comprehensive focus state combinations