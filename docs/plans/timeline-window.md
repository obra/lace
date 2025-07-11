# Timeline Window Virtualization Plan

## Problem Statement

The timeline component in Lace (an AI coding assistant) has severe scrolling issues:
- Cannot scroll to see full conversation history when resuming sessions
- Jump to top/bottom (g/G keys) is broken
- Only renders last ~35 items, making older content inaccessible
- Performance degrades with long conversations (target: 10k items)

## Current Architecture

### Technology Stack
- **Ink**: React-based terminal UI framework (renders to terminal, not DOM)
- **TypeScript**: Strict mode enabled
- **Testing**: Vitest with co-located test files

### Key Constraints
- Ink only allows height measurement AFTER rendering
- Terminal has limited viewport (typically 30-80 lines)
- Timeline items have unpredictable heights (code blocks, multi-line messages)
- Must maintain smooth scrolling performance with 10k+ items

### File Structure
```
src/interfaces/terminal/components/events/
├── TimelineViewport.tsx        # Viewport container, handles keyboard input
├── TimelineContent.tsx         # Renders timeline items (currently broken)
├── TimelineDisplay.tsx         # Orchestrates timeline rendering
├── TimelineItem.tsx            # Individual timeline item component
├── hooks/
│   └── useTimelineViewport.ts  # Viewport state management (needs rewrite)
└── __tests__/                  # Test files
```

## Solution Design

### Core Concept: Sliding Window

Instead of rendering all items or trying to predict heights, maintain a sliding window of rendered items that follows the cursor position.

### State Model
```typescript
interface TimelineWindowState {
  // Selection state
  selectedItemIndex: number;        // Which timeline item is selected
  selectedLineInItem: number;       // Which line within that item
  
  // Window state  
  windowStartIndex: number;         // First item index in render window
  windowSize: number;               // How many items to render (e.g., 50)
  
  // Measurements (only for rendered items)
  itemHeights: Map<number, number>; // Index -> measured height
  itemStartLines: Map<number, number>; // Index -> line where item starts in window
}
```

### Navigation Model
- **Item-based navigation**: Move between timeline items
- **Line-based navigation**: Move between lines within an item
- **Window sliding**: Continuously adjust window to keep cursor centered (smooth scrolling)
- **Page navigation**: PageUp/PageDown jump by viewport height

### Window Sliding Strategy
The window slides on EVERY item navigation to maintain smooth scrolling:
- Keep selected item near the center of the window when possible
- At timeline edges, window stops sliding (cursor moves to edge)
- This creates the illusion of scrolling through a fully-rendered timeline

## Implementation Tasks

### Task 1: Create Window State Hook
**File**: Create `src/interfaces/terminal/components/events/hooks/useTimelineWindow.ts`

```typescript
// ABOUTME: Sliding window state management for timeline virtualization
// ABOUTME: Replaces line-based navigation with item-based + window management

import { useState, useCallback, useEffect } from 'react';
import { Timeline } from '../../../../timeline-types.js';

export interface UseTimelineWindowOptions {
  timeline: Timeline;
  viewportHeight: number;  // Terminal lines available
  windowSize?: number;     // Items to render (default: 50)
  edgeThreshold?: number;  // Items from edge before sliding (default: 5)
}

export function useTimelineWindow(options: UseTimelineWindowOptions) {
  // Implementation here
}
```

**Test first** (`useTimelineWindow.test.ts`):
```typescript
describe('useTimelineWindow', () => {
  it('initializes window at bottom of timeline', () => {
    // Test window starts showing latest items
  });
  
  it('slides window up when navigating near top edge', () => {
    // Test window adjustment
  });
  
  it('handles jump to top by moving window to start', () => {
    // Test direct window repositioning
  });
});
```

**Commit**: "feat: Add useTimelineWindow hook for sliding window state"

### Task 2: Rewrite TimelineContent for Window Rendering
**File**: Modify `src/interfaces/terminal/components/events/TimelineContent.tsx`

Remove the artificial limiting logic and implement window-based rendering:

```typescript
export function TimelineContent({ timeline, windowState, ... }) {
  // Only render items in the window range
  const itemsToRender = timeline.items.slice(
    windowState.windowStartIndex,
    windowState.windowStartIndex + windowState.windowSize
  );
  
  // Render with refs for measurement
  return itemsToRender.map((item, localIndex) => {
    const globalIndex = windowState.windowStartIndex + localIndex;
    // ... render logic
  });
}
```

**Test first**: Update `TimelineContent.test.tsx` to verify window rendering

**Commit**: "refactor: Update TimelineContent to use window-based rendering"

### Task 3: Update TimelineViewport for New Navigation
**File**: Modify `src/interfaces/terminal/components/events/TimelineViewport.tsx`

Replace line-based navigation with item-based:

```typescript
// Handle keyboard input
if (key.upArrow) {
  windowState.navigateToPreviousLine();
} else if (key.downArrow) {
  windowState.navigateToNextLine();
} else if (key.pageUp) {
  windowState.navigatePageUp();
} else if (key.pageDown) {
  windowState.navigatePageDown();
} else if (input === 'g') {
  windowState.jumpToStart();
} else if (input === 'G') {
  windowState.jumpToEnd();
}
```

**Test**: Verify keyboard navigation in `TimelineViewport.test.tsx`

**Commit**: "feat: Implement item-based navigation in TimelineViewport"

### Task 4: Handle Measurement and Cursor Rendering
**File**: Update measurement logic in `useTimelineWindow.ts`

```typescript
// After items render, measure heights
useEffect(() => {
  const measurements = new Map<number, number>();
  let currentLine = 0;
  
  for (const [index, ref] of itemRefs.entries()) {
    const { height } = measureElement(ref);
    measurements.set(index, height);
    itemStartLines.set(index, currentLine);
    currentLine += height;
  }
  
  setItemHeights(measurements);
}, [itemRefs, windowStartIndex]);
```

**Commit**: "feat: Add height measurement for rendered window items"

### Task 5: Fix Resume Behavior
**File**: Update initialization in `src/interfaces/terminal/terminal-interface.tsx`

Ensure window starts at bottom when resuming:

```typescript
// In initializeStreamingSession
streamingTimelineProcessor.loadEvents(historicalEvents);

// Initialize window at bottom
if (timelineWindowRef.current) {
  timelineWindowRef.current.jumpToEnd();
}
```

**Test**: Add integration test for resume behavior

**Commit**: "fix: Ensure timeline jumps to bottom on session resume"

### Task 6: Optimize Window Sliding
**File**: Enhance `useTimelineWindow.ts` with smooth sliding

```typescript
// Update window position to keep selected item centered
const updateWindowForSelection = useCallback((newSelectedIndex: number) => {
  setWindowStartIndex(prev => {
    const windowCenter = Math.floor(windowSize / 2);
    const idealStart = newSelectedIndex - windowCenter;
    
    // Clamp to valid range
    const minStart = 0;
    const maxStart = Math.max(0, timeline.items.length - windowSize);
    
    return Math.max(minStart, Math.min(maxStart, idealStart));
  });
}, [timeline.items.length, windowSize]);

// Call this on EVERY selection change for smooth scrolling
const navigateToItem = useCallback((index: number) => {
  setSelectedItemIndex(index);
  updateWindowForSelection(index); // Always slide window
}, [updateWindowForSelection]);

// Page navigation
const navigatePageUp = useCallback(() => {
  const newIndex = Math.max(0, selectedItemIndex - viewportHeight);
  navigateToItem(newIndex);
}, [selectedItemIndex, viewportHeight, navigateToItem]);

const navigatePageDown = useCallback(() => {
  const newIndex = Math.min(timeline.items.length - 1, selectedItemIndex + viewportHeight);
  navigateToItem(newIndex);
}, [selectedItemIndex, viewportHeight, timeline.items.length, navigateToItem]);
```

**Commit**: "perf: Optimize window sliding for smooth scrolling"

### Task 7: Add Performance Tests
**File**: Create `src/interfaces/terminal/components/events/__tests__/timeline-performance.test.ts`

```typescript
describe('Timeline Performance', () => {
  it('handles 10k items with <100ms render time', () => {
    const hugeTimeline = generateTimelineItems(10000);
    // Measure render time
  });
  
  it('maintains smooth scrolling with large timeline', () => {
    // Test navigation performance
  });
});
```

**Commit**: "test: Add performance tests for large timelines"

## Testing Strategy

### Manual Testing
1. Run `npm start` and create a long conversation
2. Exit and resume with `npm start --continue`
3. Verify:
   - Timeline shows latest content
   - Can scroll to very beginning with repeated up arrows
   - G/g keys work correctly
   - No lag with scrolling

### Automated Testing
- Unit tests for each component (TDD approach)
- Integration test for full timeline behavior
- Performance tests with large datasets

### Test Commands
```bash
npm test                    # Run in watch mode
npm run test:run           # Single run
npm run test:unit -- timeline  # Just timeline tests
```

## Documentation to Review

1. **Ink Documentation**: https://github.com/vadimdemedes/ink
   - Focus on: measureElement, Box component, useInput hook
   
2. **Project Docs**:
   - `/docs/working-with-ink.md` - Ink-specific patterns
   - `/docs/development.md` - Development workflow
   - `/CLAUDE.md` - Project conventions

3. **Related Code**:
   - `src/interfaces/timeline-types.ts` - Type definitions
   - `src/interfaces/streaming-timeline-processor.ts` - Event processing

## Rollback Plan

If issues arise:
1. The old implementation is preserved in git history
2. Window-based approach is isolated to new hook
3. Can revert individual commits

## Success Criteria

- [x] Full timeline accessible via scrolling
- [x] Jump to start/end works correctly  
- [x] Resume shows latest content
- [x] Smooth performance with 10k items
- [x] No visible difference to user between rendered/non-rendered items

## Notes

- Keep commits small and focused
- Run tests before each commit
- Use `npm run lint` to check code style
- Follow YAGNI - don't add features not in this plan