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

## Terminal Rendering and Width Calculations

### The Terminal Wrapping Issue

One critical issue when building status bars and full-width components is **terminal boundary wrapping**. Even when content mathematically fits within terminal width, Ink/terminals require a small buffer to prevent unwanted line wrapping.

#### The Problem

```typescript
// ❌ PROBLEMATIC: Content exactly matches terminal width
const terminalWidth = 120;
const availableSpace = terminalWidth - 2; // Only account for leading/trailing spaces
const content = buildStatusBar(leftContent, rightContent, availableSpace); // Results in 120 chars
```

**Result**: The last character (often a space) wraps to the next line, creating a "black blank square" or unwanted line break.

#### Root Cause

Terminals wrap text when content reaches **exactly** the terminal width. This happens because:
1. Terminals don't distinguish between "fits exactly" and "overflows by 1"
2. The cursor position after the last character can trigger wrapping
3. Some terminals have edge cases with Unicode characters at boundaries

#### The Solution

```typescript
// ✅ CORRECT: Account for terminal wrapping buffer
const terminalWidth = useStdoutDimensions()[0];
const availableSpace = terminalWidth - 3; // Leading space + trailing space + wrapping buffer

const totalContentLength = leftContent.length + rightContent.length;
let finalLeftContent = leftContent;
let finalRightContent = rightContent;

// Truncate if needed
if (totalContentLength > availableSpace) {
  // Truncation logic...
}

const finalContentLength = finalLeftContent.length + finalRightContent.length;
const paddingNeeded = Math.max(0, availableSpace - finalContentLength);
const padding = ' '.repeat(paddingNeeded);

// This will be terminalWidth - 1 characters, preventing wrapping
const statusBarContent = ' ' + finalLeftContent + padding + finalRightContent + ' ';
```

#### Why the Buffer Works

- **Terminal width**: 120 characters
- **Available space**: 117 characters (120 - 3)
- **Final content**: 119 characters maximum (including leading/trailing spaces)
- **Result**: Always 1 character shorter than terminal width, preventing wrap

#### Debugging Terminal Wrapping

When debugging wrapping issues:

1. **Check actual vs expected length**:
   ```typescript
   console.log(`Terminal width: ${terminalWidth}`);
   console.log(`Content length: ${content.length}`);
   console.log(`Content: "${content}"`);
   ```

2. **Character-by-character analysis**:
   ```typescript
   for (let i = 0; i < content.length; i++) {
     const char = content[i];
     const code = char.charCodeAt(0);
     console.log(`${i}: "${char}" (${code})`);
   }
   ```

3. **Check for exact width matching**:
   ```typescript
   if (content.length >= terminalWidth) {
     console.log('🚨 Content may wrap - exactly matches or exceeds terminal width');
   }
   ```

#### Common Scenarios

**Status Bars**: Always use 3-character buffer (`terminalWidth - 3`)

**Full-Width Components**: Leave at least 1 character margin

**Dynamic Content**: Account for Unicode character width variations

**Testing**: Mock terminal width and verify content is always `< terminalWidth`

#### Real-World Example: StatusBar Fix

The Lace status bar was experiencing single-character wrapping during processing state. The fix:

```typescript
// Before: Wrapping occurred at exactly terminal width
const availableSpace = currentWidth - 2;

// After: Added buffer to prevent wrapping
const availableSpace = currentWidth - 3; // Account for leading/trailing spaces + terminal wrapping buffer
```

This prevented the space character before "Processing" from wrapping to the next line as a "black blank square."

## Text Rendering and ANSI Codes

### Safe String Construction

When building complex status bars with colors and formatting:

```typescript
// ✅ Build strings first, then apply formatting
const plainContent = `${leftContent}${padding}${rightContent}`;
console.log(`Plain content length: ${plainContent.length}`); // Accurate length

return (
  <Text backgroundColor="blueBright" color="black">
    {plainContent}
  </Text>
);
```

**Key insight**: Always calculate lengths on plain strings before applying Ink formatting to avoid ANSI code interference.

## Testing Terminal Rendering

### Critical Testing Failure: Environment Mismatches

**The Problem We Encountered**: Comprehensive tests were written to reproduce terminal wrapping issues, but they **completely failed to catch the bug** that was happening in the real application.

#### Why The Tests Failed

1. **Mock Environment vs Real Environment**:
   ```typescript
   // ❌ WRONG: Tests mocked useStdoutDimensions but Ink used different dimensions
   vi.mock('../../../utils/use-stdout-dimensions.js', () => ({
     default: vi.fn(() => [80, 24]), // Mocked to 80 columns
   }));
   
   // But ink-test-utils.ts set process.stdout.columns = 130 (line 195)
   // Creating a mismatch between what component thinks vs what Ink renders
   ```

2. **Test Environment Terminal Handling**:
   - The `renderInkComponent` test utility creates its own stdout environment
   - It sets `process.stdout.columns = 130` for consistent test rendering
   - But mocked hooks returned different values (e.g., 80, 120)
   - **Result**: Component calculated for one width, Ink rendered for another

3. **Missing Real Terminal Simulation**:
   ```typescript
   // ❌ Tests that passed but didn't catch the bug
   it('should reproduce single character wrapping during processing in wide terminal', () => {
     mockUseStdoutDimensions.mockReturnValue([120, 24]);
     
     const { lastFrame } = renderInkComponent(<StatusBar {...props} />);
     const frame = lastFrame();
     
     expect(frame).toBeDefined();
     // This passed! But the real app was still broken
   });
   ```

#### What We Learned About Test Design

**Key Insight**: **Tests that mock the wrong things can give false confidence**

1. **Environment Consistency is Critical**:
   - If you mock `useStdoutDimensions`, ensure test environment matches
   - Or don't mock it and let tests use actual terminal dimensions
   - **Mocking terminal behavior is extremely difficult to get right**

2. **Test the Real Integration**:
   ```typescript
   // ✅ Better approach: Test actual terminal rendering without mocks
   it('should not wrap in real terminal environment', () => {
     // Don't mock useStdoutDimensions - let it use real terminal
     const { lastFrame } = renderInkComponent(<StatusBar {...props} />);
     const frame = lastFrame();
     const lines = frame.split('\n');
     
     // This would have caught the bug!
     expect(lines.length).toBe(1);
   });
   ```

3. **Reproducing User Experience**:
   - The bug only manifested in **real terminal usage**
   - Tests should simulate user's actual environment as closely as possible
   - **Terminal rendering is fundamentally different from test rendering**

#### Effective Testing Strategies for Terminal Issues

1. **Manual Testing is Essential**:
   ```bash
   # Always test in actual terminal, not just automated tests
   npm start
   # Trigger the problematic state and visually inspect
   ```

2. **Minimal Reproductions Outside Test Framework**:
   ```typescript
   // Create standalone reproduction scripts
   // src/debug/minimal-repro.tsx - runs in real terminal
   npx tsx src/debug/minimal-repro.tsx
   ```

3. **Test Multiple Terminal Widths in Real Environment**:
   ```bash
   # Test at different terminal widths
   printf '\e[8;24;80t'  # Resize to 80 columns
   npm start
   printf '\e[8;24;120t' # Resize to 120 columns  
   npm start
   ```

4. **Visual Verification Tools**:
   ```typescript
   // Debug tools that show actual measurements vs expected
   function StatusBarDebugView() {
     const [width] = useStdoutDimensions();
     const content = buildStatusBarContent();
     
     console.log(`Terminal: ${width}, Content: ${content.length}`);
     if (content.length >= width) {
       console.log('🚨 POTENTIAL WRAPPING');
     }
     
     return <Text>{content}</Text>;
   }
   ```

#### The False Security of Comprehensive Tests

Our status bar tests were **extensive and detailed**:
- Multiple terminal width scenarios (40, 60, 80, 118, 120 columns)
- Character-by-character analysis 
- Comparison of processing vs non-processing states
- Padding calculation verification
- Visual output inspection

**But they all passed while the real app was broken!**

This taught us that **comprehensive ≠ correct** when testing terminal applications.

### Reproducing Wrapping Issues

Create minimal reproductions that match real component logic:

```typescript
// Test exact component behavior in isolation
function MinimalStatusBarTest() {
  const terminalWidth = 120;
  const leftContent = "◉ anthropic:claude-sonnet-4-20250514 • ▣ thread-abc123def456";
  const rightContent = "⏱ 12s • ↑250 ↓150 • . Processing";
  
  // Use same calculation as real component
  const availableSpace = terminalWidth - 3;
  const contentLength = leftContent.length + rightContent.length;
  const padding = ' '.repeat(Math.max(0, availableSpace - contentLength));
  
  const content = ` ${leftContent}${padding}${rightContent} `;
  
  return <Text backgroundColor="blueBright" color="black">{content}</Text>;
}
```

**Key lesson**: This minimal reproduction **immediately** showed the wrapping issue when run in a real terminal, while comprehensive mocked tests missed it entirely.

### Testing Guidelines for Terminal Applications

1. **Always test manually in real terminals** - automated tests can miss critical rendering issues
2. **Be very careful with mocking terminal dimensions** - mismatches between mocked and real environments cause false positives
3. **Create debug tools and minimal reproductions** that run outside the test framework
4. **Test visual output at different terminal sizes** manually
5. **When tests pass but users report issues**, suspect environment mismatches in tests
6. **Terminal rendering behavior is complex** - don't trust mocked environments for layout issues

This document should be updated as we discover new patterns and solutions for Ink development.