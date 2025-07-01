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

## Advanced Patterns: Dynamic Content Measurement

### The Circular Measurement Problem

When building components that render differently based on measured content, you can encounter circular dependencies:

```typescript
// ❌ PROBLEMATIC: Measuring your own rendered output
function SideMarkerRenderer({ children }) {
  const [height, setHeight] = useState(1);
  const ref = useRef();
  
  useEffect(() => {
    if (ref.current) {
      // This measures the component INCLUDING the markers we just rendered
      const { height } = measureElement(ref.current);
      setHeight(height); // This changes the markers, changing the height!
    }
  }, [children]);
  
  // Renders markers based on measured height
  return (
    <Box ref={ref} flexDirection="row">
      <SideMarkers height={height} />
      {children}
    </Box>
  );
}
```

**Solution**: Measure only the content, not the entire component:

```typescript
// ✅ CORRECT: Measure only the content portion
function SideMarkerRenderer({ children, isExpanded }) {
  const [height, setHeight] = useState(1);
  const contentRef = useRef();
  
  useEffect(() => {
    // Reset height when expansion state changes to force re-measurement
    setHeight(1);
    
    const measureAfterDOMUpdate = () => {
      if (contentRef.current && typeof contentRef.current === 'object' && 'nodeName' in contentRef.current) {
        try {
          const { height } = measureElement(contentRef.current as DOMElement);
          setHeight(Math.max(1, height));
        } catch (error) {
          setHeight(1); // Fallback
        }
      }
    };
    
    // Defer measurement to ensure DOM has updated
    const timeoutId = setTimeout(measureAfterDOMUpdate, 1);
    return () => clearTimeout(timeoutId);
  }, [children, isExpanded]);
  
  return (
    <Box flexDirection="row">
      <SideMarkers height={height} />
      <Box ref={contentRef} flexGrow={1}>
        {children}
      </Box>
    </Box>
  );
}
```

### Measurement Timing and State Changes

One of the trickiest aspects of Ink development is getting measurement timing right, especially with collapsible content:

```typescript
// ❌ WRONG: Measuring immediately after state change
const [isExpanded, setIsExpanded] = useState(false);

useEffect(() => {
  // DOM hasn't updated yet!
  const { height } = measureElement(ref.current);
  updateMarkers(height);
}, [isExpanded]); // Fires immediately when state changes

// ✅ CORRECT: Deferring measurement after DOM updates
useEffect(() => {
  // Reset to default when expansion state changes
  setMeasuredHeight(1);
  
  const measureAfterDOMUpdate = () => {
    if (contentRef.current) {
      try {
        const { height } = measureElement(contentRef.current);
        setMeasuredHeight(Math.max(1, height));
      } catch (error) {
        setMeasuredHeight(1);
      }
    }
  };
  
  // Small delay ensures CollapsibleBox has re-rendered its content
  const timeoutId = setTimeout(measureAfterDOMUpdate, 1);
  return () => clearTimeout(timeoutId);
}, [children, isExpanded]);
```

### Managing Component Dependencies

When building components that depend on each other's measurements:

```typescript
// Parent component manages measurement coordination
function TimelineEntryCollapsibleBox({ isExpanded, onToggle }) {
  const prevExpandedRef = useRef();
  
  // Detect expansion state changes and trigger external remeasurement
  useEffect(() => {
    const prevExpanded = prevExpandedRef.current;
    const currentExpanded = isExpanded;

    // Only trigger on actual changes, not initial mount
    if (prevExpanded !== undefined && prevExpanded !== currentExpanded) {
      onToggle?.(); // Tells parent to remeasure the entire timeline
    }

    prevExpandedRef.current = currentExpanded;
  }, [isExpanded, onToggle]);
  
  return (
    <SideMarkerRenderer isExpanded={isExpanded}>
      <CollapsibleBox isExpanded={isExpanded}>
        {children}
      </CollapsibleBox>
    </SideMarkerRenderer>
  );
}
```

## Common Pitfalls

### 1. Missing Refs for Measurement
**Problem**: Components render but `measureElement()` fails
**Solution**: Always assign refs to containers that need measurement

### 2. Timing Issues with State Updates
**Problem**: Measurements happen before DOM updates complete
**Solution**: Use `setTimeout` or proper `useEffect` dependencies to defer measurement

### 3. Infinite Re-render Loops
**Problem**: State updates trigger measurements which trigger more state updates
**Solution**: Use previous state refs to detect actual changes, avoid `measuredHeight` in useEffect dependencies

### 4. Focus System Conflicts
**Problem**: Multiple components fighting for keyboard input
**Solution**: Use Lace focus system and check `isFocused` before handling input

### 5. Hard-coded Heights
**Problem**: Using fixed heights instead of measuring actual content
**Solution**: Always use `measureElement()` for dynamic content, but provide explicit overrides when needed

### 6. Circular Measurement Dependencies
**Problem**: Component measures its own rendered output, creating feedback loops
**Solution**: Measure only the content portion, not the entire component including decorations

### 7. Stale DOM Measurements
**Problem**: Measuring collapsed content returns expanded content height
**Solution**: Reset measurements when state changes, defer measurement to ensure DOM updates

## Best Practices

1. **Always Provide Fallbacks**: Measurement can fail, provide sensible defaults
2. **Coordinate State Changes**: Use callbacks to trigger remeasurement after content changes  
3. **Test Incrementally**: Complex Ink layouts are hard to debug, test each piece separately
4. **Use Debug Panels**: Create debug panels to visualize state during development
5. **Follow React Patterns**: Ink is still React - use hooks, effects, and callbacks properly
6. **Minimize Renders**: Ink renders to terminal, excessive renders cause flicker
7. **Measure Content, Not Decorations**: Only measure the variable content, not static UI elements
8. **Reset Before Re-measuring**: Clear stale measurements when state changes to avoid incorrect heights
9. **Defer Measurement**: Use `setTimeout` to ensure DOM updates complete before measuring
10. **Explicit Heights When Possible**: Provide explicit height hints in tests and known scenarios

## Toolbox-Style Marker Pattern

A successful pattern we developed for status-based visual indicators:

```typescript
// Status-based markers that replace traditional borders
type MarkerStatus = 'none' | 'pending' | 'success' | 'error';

function SideMarkerRenderer({ status, contentHeight, isExpanded, children }) {
  // Characters vary by content height
  const markers = getMarkerCharacters(contentHeight ?? measuredHeight);
  
  // Colors vary by status and selection state  
  const color = getMarkerColor(status, isSelected);
  
  if (markers.single) {
    return (
      <Box flexDirection="row">
        <Text color={color}>{markers.single} </Text>
        <Box ref={contentRef} flexGrow={1}>{children}</Box>
      </Box>
    );
  }
  
  // Multi-line with top/middle/bottom markers
  return (
    <Box flexDirection="row">
      <SideMarkers markers={markers} color={color} />
      <Box ref={contentRef} flexGrow={1}>{children}</Box>
    </Box>
  );
}

// Character selection based on height
function getMarkerCharacters(height: number) {
  if (height === 1) return { single: '⊂' };
  if (height === 2) return { top: '╭', bottom: '╰' };
  return { top: '╭', middle: '│', bottom: '╰' };
}
```

**Key insights:**
- Single character for single-line content (`⊂`)
- Top/bottom brackets for two-line content (`╭` `╰`)  
- Top/middle/bottom for multi-line content (`╭` `│` `╰`)
- Status-based colors (none=gray, pending=yellow, success=green, error=red)
- Bright variants when focused/selected

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
6. **Console.log Measurement Values**: Track `measuredHeight` vs `actualHeight` vs `contentHeight` 
7. **Test Collapse/Expand Cycles**: Many measurement bugs only show up during state transitions
8. **Check useEffect Dependencies**: Missing dependencies cause stale measurements
9. **Verify DOM Element Types**: `measureElement()` requires valid DOMElement, check with `'nodeName' in ref`
10. **Add Explicit Height Props**: For testing and debugging, pass known heights to bypass measurement

## Testing Strategies for Complex Ink Components

### Unit Test Patterns

```typescript
// Test logic separately from rendering
describe('measurement logic', () => {
  it('should calculate correct marker characters', () => {
    expect(getMarkerCharacters(1)).toEqual({ single: '⊂' });
    expect(getMarkerCharacters(3)).toEqual({ top: '╭', middle: '│', bottom: '╰' });
  });

  it('should apply correct colors based on status', () => {
    expect(getMarkerColor('success', false)).toBe('green');
    expect(getMarkerColor('success', true)).toBe('greenBright');
  });
});

// Test with explicit heights to avoid measurement issues
describe('component rendering', () => {
  it('should render correct markers for different heights', () => {
    const { lastFrame } = render(
      <SideMarkerRenderer status="success" contentHeight={3}>
        <Text>Multi-line content</Text>
      </SideMarkerRenderer>
    );
    
    expect(lastFrame()).toContain('╭');
    expect(lastFrame()).toContain('│');
    expect(lastFrame()).toContain('╰');
  });
});
```

### Integration Test Patterns

```typescript
// Test the coordination between components
it('should update markers when expansion state changes', () => {
  const { rerender, lastFrame } = render(
    <TimelineEntryCollapsibleBox 
      isExpanded={false} 
      status="success"
      contentHeight={1} // Explicit for collapsed
    >
      <Text>Summary</Text>
    </TimelineEntryCollapsibleBox>
  );

  expect(lastFrame()).toContain('⊂'); // Single line marker

  rerender(
    <TimelineEntryCollapsibleBox 
      isExpanded={true} 
      status="success"
      contentHeight={4} // Explicit for expanded
    >
      <Text>Line 1</Text>
      <Text>Line 2</Text>
      <Text>Line 3</Text>
      <Text>Line 4</Text>
    </TimelineEntryCollapsibleBox>
  );

  expect(lastFrame()).toContain('╭');
  expect(lastFrame()).toContain('╰');
});
```

This document should be updated as we discover new patterns and solutions for Ink development.