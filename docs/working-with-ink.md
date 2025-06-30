# Working with Ink Components

This document captures key learnings and patterns for working with Ink (React for CLI) components in the Lace codebase.

## Ink Fundamentals

Ink is React for the command line - it renders React components to terminal output instead of DOM. This creates unique patterns and considerations different from regular React development.

### Key Differences from Regular React

1. **No DOM**: Components render to terminal output, not HTML elements
2. **Measurement API**: Use `measureElement()` from Ink instead of DOM APIs
3. **Focus System**: Terminal focus works differently than web focus
4. **Layout**: Uses Flexbox-like layout but optimized for terminal constraints

## Component Architecture Patterns

### Ref Management for Measurement

One of the most critical patterns in Lace is proper ref management for height measurement:

```typescript
// ❌ WRONG: Missing refs mean measureElement() fails
<Box>
  <TimelineItem />
</Box>

// ✅ CORRECT: Proper ref assignment for measurement
<Box
  ref={(ref) => {
    if (ref) {
      itemRefs.current.set(index, ref);
    } else {
      itemRefs.current.delete(index);
    }
  }}
>
  <TimelineItem />
</Box>
```

**Why this matters:**
- `measureElement()` requires valid Ink element references
- Without refs, measurement falls back to default/incorrect heights
- This breaks viewport calculations and cursor positioning

### State Management in Ink Components

Ink components require careful state coordination:

```typescript
// Track expansion state changes to trigger remeasurement
useEffect(() => {
  const prevExpanded = prevExpandedRef.current;
  const currentExpanded = isExpanded;

  // Only trigger on actual changes, not initial mount
  if (prevExpanded !== undefined && prevExpanded !== currentExpanded) {
    onToggle?.(); // Trigger viewport remeasurement
  }

  prevExpandedRef.current = currentExpanded;
}, [isExpanded, onToggle]);
```

**Key principles:**
- Use refs to track previous state for change detection
- Trigger measurement updates only on actual state changes
- Coordinate between components using callback props

## Timeline Measurement System

The timeline uses a sophisticated measurement system to handle dynamic content heights:

### Flow Overview

1. **User Action**: Expand/collapse timeline item
2. **State Change**: Component expansion state updates
3. **Change Detection**: `useEffect` detects expansion state change
4. **Trigger**: Calls `triggerRemeasurement()` callback
5. **Measurement**: `useTimelineViewport` remeasures all items
6. **Position Update**: Updates item positions and total height
7. **Cursor Adjustment**: Repositions cursor to maintain context

### Measurement Hook Pattern

```typescript
export function useTimelineViewport({ timeline, itemRefs }: Options) {
  const [itemPositions, setItemPositions] = useState<number[]>([]);
  const [measurementTrigger, setMeasurementTrigger] = useState(0);

  // Measure actual heights after DOM updates
  useEffect(() => {
    const positions: number[] = [];
    let currentPosition = 0;

    for (let i = 0; i < timeline.items.length; i++) {
      positions[i] = currentPosition;
      
      const itemRef = itemRefs.current.get(i);
      if (itemRef && typeof itemRef === 'object' && 'nodeName' in itemRef) {
        const { height } = measureElement(itemRef as DOMElement);
        currentPosition += height;
      } else {
        // Fallback height when ref not available
        currentPosition += 3;
      }
    }

    setItemPositions(positions);
  }, [timeline.items, itemRefs, measurementTrigger]);

  const triggerRemeasurement = useCallback(() => {
    setMeasurementTrigger(prev => prev + 1);
  }, []);

  return { itemPositions, triggerRemeasurement };
}
```

## Debug Panel Integration

### Shell Command Pattern

Debug panels should be controlled via shell commands rather than keyboard shortcuts:

```typescript
// ❌ WRONG: Keyboard shortcut in component
useInput((input) => {
  if (input === 'D') {
    setShowDebugPanel(prev => !prev);
  }
});

// ✅ CORRECT: Shell command integration
export const debugTimelineLayoutCommand: Command = {
  name: 'debug-timeline-layout',
  description: 'Toggle timeline layout debug panel',
  async execute(args: string, ui: UserInterface): Promise<void> {
    if ('toggleTimelineLayoutDebugPanel' in ui) {
      const isVisible = (ui as any).toggleTimelineLayoutDebugPanel();
      ui.displayMessage(`Timeline layout debug panel ${isVisible ? 'enabled' : 'disabled'}`);
    }
  },
};
```

### Debug Panel Props

Debug panels should be stateless and receive all data via props:

```typescript
interface RenderDebugPanelProps {
  isVisible: boolean;
  timeline: Timeline;
  viewportState: ViewportState;
  onClose: () => void; // Usually empty for command-controlled panels
}
```

## Focus Management

Lace uses a custom focus system (`useLaceFocus`) that coordinates with Ink's focus system:

```typescript
const { isFocused } = useLaceFocus('timeline', { autoFocus: false });

useInput((input, key) => {
  // Handle keyboard input only when focused
}, { isActive: isFocused });
```

**Key patterns:**
- Use `useLaceFocus` instead of Ink's `useFocus`
- Check `isActive: isFocused` for input handlers
- Coordinate focus between multiple timeline instances (main vs delegate)

## Testing Ink Components

### Mock Strategy

```typescript
// Mock Ink's measureElement for tests
const mockMeasureElement = vi.fn();
vi.mock('ink', () => ({
  measureElement: mockMeasureElement,
}));

// Return predictable heights for testing
mockMeasureElement
  .mockReturnValueOnce({ height: 20, width: 100 })
  .mockReturnValueOnce({ height: 30, width: 100 });
```

### Component Testing

Test the logic, not the rendering:

```typescript
it('should populate itemRefs map with DOM elements', () => {
  const component = TimelineContent({
    timeline,
    viewportState,
    viewportActions,
    itemRefs,
  });

  // Test component structure, not visual output
  expect(React.isValidElement(component)).toBe(true);
});
```

## Common Pitfalls

### 1. Missing Refs for Measurement
**Problem**: Components render but `measureElement()` fails
**Solution**: Always assign refs to containers that need measurement

### 2. Timing Issues with State Updates
**Problem**: Measurements happen before DOM updates complete
**Solution**: Use `useEffect` dependencies to coordinate timing

### 3. Infinite Re-render Loops
**Problem**: State updates trigger measurements which trigger more state updates
**Solution**: Use previous state refs to detect actual changes

### 4. Focus System Conflicts
**Problem**: Multiple components fighting for keyboard input
**Solution**: Use Lace focus system and check `isFocused` before handling input

### 5. Hard-coded Heights
**Problem**: Using fixed heights instead of measuring actual content
**Solution**: Always use `measureElement()` for dynamic content

## Best Practices

1. **Always Provide Fallbacks**: Measurement can fail, provide sensible defaults
2. **Coordinate State Changes**: Use callbacks to trigger remeasurement after content changes
3. **Test Incrementally**: Complex Ink layouts are hard to debug, test each piece separately
4. **Use Debug Panels**: Create debug panels to visualize state during development
5. **Follow React Patterns**: Ink is still React - use hooks, effects, and callbacks properly
6. **Minimize Renders**: Ink renders to terminal, excessive renders cause flicker

## Performance Considerations

- **Debounce Measurements**: Don't measure on every state change
- **Cache Results**: Store measurement results when content doesn't change
- **Lazy Evaluation**: Only measure visible/expanded content when possible
- **Clean Up Refs**: Remove refs when components unmount to prevent memory leaks

## Debugging Tips

1. **Add Debug Panels**: Create debug panels to visualize state in real-time
2. **Log Measurement Data**: Log heights, positions, and triggers to understand flow
3. **Use React DevTools**: Still works with Ink for component tree inspection
4. **Test in Isolation**: Extract complex logic into testable hooks
5. **Check Ref Population**: Ensure refs are actually being set before measurement

This document should be updated as we discover new patterns and solutions for Ink development.