# Simplify Timeline Rendering Architecture

## Current Problem

The ThreadProcessor and delegation infrastructure is overly complex with lots of dead code:

1. **ThreadProcessor processes delegate threads that nobody uses**
2. **Legacy unused infrastructure**: `DelegateTimelineContext.tsx`, `useDelegateThreadExtraction.ts`
3. **DelegationBox shows empty placeholder instead of actual delegate thread data**
4. **Prop drilling attempts were abandoned** (see comment in `TimelineContent.test.tsx:170`)

## What ThreadProcessor Actually Does

### Useful Work:
- **Event caching** (`_eventCache`) - performance optimization to avoid re-parsing events
- **Event parsing** - converts raw `ThreadEvent[]` to `TimelineItem[]` with proper types
- **Tool call/result pairing** - matches TOOL_CALL events with TOOL_RESULT events 
- **Chronological sorting** - merges processed events with ephemeral messages by timestamp
- **Metadata calculation** - event counts, message counts, last activity timestamps

### Useless Work:
- **Delegate thread processing** - processes delegate threads into unused `delegateTimelines` Map
- **Thread separation logic** - splits main/delegate threads but delegates are never used
- **Incremental caching for delegates** - caches delegate data that's never accessed

## Plan: Simplify Architecture

### Phase 1: Make DelegationBox Self-Sufficient ✅ COMPLETED
1. **Add ThreadManager to context** - ✅ extend existing pattern
2. **DelegationBox fetches its own data** - ✅:
   ```tsx
   function DelegationBox({ delegateThreadId }) {
     const threadManager = useThreadManager();
     const threadProcessor = useThreadProcessor();
     
     const delegateTimeline = useMemo(() => {
       if (!delegateThreadId) return null;
       const events = threadManager.getEventsForThread(delegateThreadId);
       // Process as single thread (delegate becomes "main" when processed alone)
       return threadProcessor.processThreads(events).mainTimeline; 
     }, [delegateThreadId, threadManager, threadProcessor]);
   }
   ```

**Implementation Notes:**
- Added `ThreadManagerContext` and `useThreadManager()` hook to `terminal-interface.tsx`
- Updated `DelegationBox` to fetch real delegate thread data using `threadManager.getEvents()`
- Uses `useMemo()` for performance - only refetches when `delegateThreadId` changes  
- Added error handling for failed delegate thread loading
- **Status**: DelegationBox now loads actual delegate thread content instead of placeholder

### Phase 2: Remove Dead Code
1. **Delete unused files**:
   - `src/interfaces/terminal/components/events/context/DelegateTimelineContext.tsx`
   - `src/interfaces/terminal/components/events/hooks/useDelegateThreadExtraction.ts`

2. **Simplify ThreadProcessor**:
   - Remove delegate processing logic
   - Return only `mainTimeline` instead of `ProcessedThreads`
   - Remove `delegateTimelines` Map creation
   - Keep all the useful caching and parsing logic

3. **Update interface**:
   ```tsx
   // Before
   interface ProcessedThreads {
     mainTimeline: Timeline;
     delegateTimelines: Map<string, Timeline>; // REMOVE
   }

   // After  
   processThreads(events: ThreadEvent[]): Timeline // Just return main timeline
   ```

### Phase 3: Clean Up Tests
1. **Remove delegateTimelines from all test files**
2. **Update test mocks and expectations**
3. **Simplify test setup code**

## Performance Benefits
- **Faster main thread processing** - no time wasted processing unused delegates
- **Less memory usage** - no storing unused delegate timelines
- **Simpler mental model** - each component gets exactly what it needs
- **Better caching** - DelegationBox can cache its own delegate data

## Risk Analysis
- **Low risk** - delegate timeline processing is currently unused
- **DelegationBox currently shows placeholder** - so we're not breaking working functionality
- **Tests will need updates** - but they're testing unused code paths anyway

## Implementation Order
1. Fix DelegationBox to load real data (immediate user value)
2. Remove dead infrastructure (code cleanup)
3. Simplify ThreadProcessor (performance improvement)

This keeps the useful parts (event parsing, caching, tool pairing) while removing the complexity nobody asked for.