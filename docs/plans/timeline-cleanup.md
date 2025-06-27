# Timeline Component Cleanup Plan

## Current State Analysis

After extracting `TimelineViewport`, the `TimelineDisplay.tsx` is still **325 lines** with these responsibilities:

1. **Item interaction handling** (lines 30-72) - keyboard navigation for expand/collapse
2. **Timeline content rendering** (lines 82-114) - renders items with TimelineViewport  
3. **Individual item rendering** (lines 116-290) - `TimelineItemDisplay` function with complex switch
4. **Delegate thread extraction** (lines 292-324) - complex logic for finding delegate threads

## 🎯 Three Planned Extractions

### 1. Extract `useDelegateThreadExtraction` Hook

**Current location**: Lines 292-324 (`extractDelegateThreadId` function)  
**Complexity**: ~35 lines of complex logic with multiple strategies  
**Target file**: `src/interfaces/terminal/components/events/hooks/useDelegateThreadExtraction.ts`

**Responsibilities**:
- Strategy 1: Extract thread ID from tool result regex matching
- Strategy 2: Find delegate thread by temporal proximity (within 5 seconds)
- Caching and memoization to avoid re-computation
- Debug logging for thread extraction process

**Interface**:
```typescript
function useDelegateThreadExtraction(
  delegateTimelines?: Map<string, Timeline>
) {
  return {
    extractDelegateThreadId: (item: ToolExecutionItem) => string | null
  };
}
```

**Benefits**:
- Moves complex extraction logic out of render
- Enables proper memoization and caching
- Makes testing of extraction logic easier
- Reduces TimelineDisplay complexity

---

### 2. Extract `TimelineItem` Component

**Current location**: Lines 116-290 (`TimelineItemDisplay` function)  
**Complexity**: ~175 lines with complex switch statement and delegate rendering  
**Target file**: `src/interfaces/terminal/components/events/TimelineItem.tsx`

**Responsibilities**:
- Determine item type and delegate to appropriate display component
- Handle delegate tool call rendering with DelegationBox
- Manage tool execution expansion state display
- Convert timeline items to event format for EventDisplay
- Complex delegate timeline rendering logic

**Interface**:
```typescript
interface TimelineItemProps {
  item: TimelineItem;
  delegateTimelines?: Map<string, Timeline>;
  isFocused: boolean;
  focusedLine: number;
  itemStartLine: number;
  onToggle?: () => void;
  delegationExpandState: Map<string, boolean>;
  toolExpandState: Map<string, boolean>;
  currentFocusId?: string;
}

function TimelineItem(props: TimelineItemProps): JSX.Element
```

**Benefits**:
- Single responsibility for item rendering
- Easier testing of individual item types
- Better separation of concerns
- Reusable for other timeline contexts

---

### 3. Extract `TimelineContent` Component

**Current location**: Lines 82-114 (render prop content inside TimelineViewport)  
**Complexity**: ~30 lines but high coupling with TimelineDisplay state  
**Target file**: `src/interfaces/terminal/components/events/TimelineContent.tsx`

**Responsibilities**:
- Pure rendering of timeline items list
- Manage item refs for measurement
- Handle item positioning and key generation
- Coordinate between viewport state and item rendering

**Interface**:
```typescript
interface TimelineContentProps {
  timeline: Timeline;
  viewportState: ViewportState;
  viewportActions: ViewportActions;
  itemRefs: React.MutableRefObject<Map<number, unknown>>;
  delegateTimelines?: Map<string, Timeline>;
  delegationExpandState: Map<string, boolean>;
  toolExpandState: Map<string, boolean>;
  currentFocusId?: string;
  onToggle?: () => void;
}

function TimelineContent(props: TimelineContentProps): JSX.Element
```

**Benefits**:
- Pure rendering component (easier to test)
- Clean separation from interaction logic
- Reusable timeline content renderer
- Cleaner TimelineDisplay coordination

---

## 🚀 Implementation Strategy

### Phase 1: Extract `useDelegateThreadExtraction` Hook
**Target**: Reduce TimelineDisplay by ~35 lines, improve extraction logic

**Steps**:
1. Create hook with memoized extraction logic
2. Add comprehensive tests for both extraction strategies
3. Update TimelineDisplay to use hook
4. Verify delegate thread extraction still works correctly

### Phase 2: Extract `TimelineItem` Component  
**Target**: Reduce TimelineDisplay by ~175 lines, isolate item rendering

**Steps**:
1. Create TimelineItem component with full type switching
2. Move delegate timeline rendering logic to component
3. Add tests for each timeline item type rendering
4. Update TimelineDisplay to use TimelineItem
5. Verify all item types render correctly

### Phase 3: Extract `TimelineContent` Component
**Target**: Reduce TimelineDisplay by ~30 lines, pure rendering separation

**Steps**:
1. Create pure TimelineContent rendering component
2. Move item mapping and ref management to component
3. Add tests for content rendering and ref handling
4. Update TimelineDisplay to use TimelineContent
5. Verify viewport integration still works

---

## 📊 Expected Final State

**Before**: 325 lines in TimelineDisplay.tsx  
**After**: ~80 lines in TimelineDisplay.tsx

**Final TimelineDisplay responsibilities**:
- Manage expand/collapse state (delegationExpandState, toolExpandState)
- Handle item interaction events (handleItemInteraction)
- Coordinate between TimelineViewport and TimelineContent
- Focus management and escape handling

**New component structure**:
```
TimelineDisplay (80 lines)
├── TimelineViewport (existing)
│   └── TimelineContent (30 lines)
│       └── TimelineItem[] (175 lines)
└── useDelegateThreadExtraction (35 lines)
```

**Benefits of final state**:
- Each component has single, clear responsibility
- Much easier testing of individual concerns
- Better performance (targeted re-renders)
- Reusable components for other timeline uses
- Cleaner data flow and state management

---

## 🧪 Testing Strategy

Each extraction will follow this pattern:
1. **Write baseline tests** before extraction
2. **Extract with tests** for new component
3. **Integration tests** to verify nothing broke
4. **Refactor tests** to remove duplication

**Test focus areas**:
- Delegate thread extraction edge cases
- All timeline item type rendering
- Expand/collapse state management
- Focus and keyboard interaction
- Viewport integration

---

## ✅ Success Criteria

- [ ] TimelineDisplay reduced from 325 to ~80 lines
- [ ] All existing functionality preserved
- [ ] Comprehensive test coverage for extracted components
- [ ] No performance regressions
- [ ] Clean, focused component responsibilities
- [ ] Better developer experience for timeline modifications