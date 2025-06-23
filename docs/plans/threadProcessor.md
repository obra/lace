# ThreadProcessor Multi-Thread Architecture Plan

## Problem Statement

The current ThreadProcessor was designed for single-thread conversations but needs to handle multi-thread scenarios with delegation while:
- Maintaining tool call pairing within each thread
- Supporting incremental caching for performance
- Allowing different UIs to display threads differently
- Supporting unlimited sub-delegation depth

## Current Issues

1. **Tool Pairing**: Tool calls and results can be separated by delegate events, breaking pairing logic
2. **Caching**: Incremental processing assumes single timeline, but delegation creates multiple timelines
3. **UI Coupling**: ThreadProcessor shouldn't know about "delegation boxes" - that's UI-specific
4. **Sub-delegations**: Current approach doesn't handle `main.1` → `main.1.1` → `main.1.1.1` cleanly

## Proposed Architecture

### ThreadProcessor API

```typescript
interface ProcessedThreads {
  mainTimeline: Timeline;
  delegateTimelines: Map<string, Timeline>;
}

class ThreadProcessor {
  // New primary method
  processThreads(events: ThreadEvent[]): ProcessedThreads;
  
  // Keep existing methods for backward compatibility
  processEvents(events: ThreadEvent[]): ProcessedThreadItems;
  processThread(events: ThreadEvent[], ephemeralMessages?: EphemeralMessage[]): Timeline;
}
```

### Implementation Strategy

#### Phase 1: Thread Separation
```typescript
processThreads(events: ThreadEvent[]): ProcessedThreads {
  // 1. Group events by threadId
  const threadGroups = this._groupEventsByThread(events);
  
  // 2. Separate main thread from delegates
  const mainEvents = threadGroups.find(g => !g.threadId.includes('.'))?.events || [];
  const delegateGroups = threadGroups.filter(g => g.threadId.includes('.'));
  
  // 3. Process each thread independently
  const mainTimeline = this.processThread(mainEvents);
  const delegateTimelines = new Map();
  
  for (const group of delegateGroups) {
    delegateTimelines.set(group.threadId, this.processThread(group.events));
  }
  
  return { mainTimeline, delegateTimelines };
}
```

#### Phase 2: Caching Strategy
- **Per-thread caching**: Cache processed results separately for each threadId
- **Incremental updates**: When new events arrive, only reprocess affected threads
- **Cache key format**: `threadId:eventCount:lastEventId`

```typescript
private _threadCaches = new Map<string, {
  processedItems: ProcessedThreadItems;
  eventIds: Set<string>;
}>();

private _processThreadIncremental(threadId: string, events: ThreadEvent[]): ProcessedThreadItems {
  const cache = this._threadCaches.get(threadId);
  const currentEventIds = new Set(events.map(e => e.id));
  
  if (cache && this._isSuperset(currentEventIds, cache.eventIds)) {
    // Incremental processing for this thread
    const newEvents = events.filter(e => !cache.eventIds.has(e.id));
    if (newEvents.length === 0) return cache.processedItems;
    
    const newItems = this._processEventGroup(newEvents);
    const combined = [...cache.processedItems, ...newItems]
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    this._threadCaches.set(threadId, {
      processedItems: combined,
      eventIds: currentEventIds
    });
    
    return combined;
  }
  
  // Full reprocess for this thread
  const processed = this._processEventGroup(events);
  this._threadCaches.set(threadId, {
    processedItems: processed,
    eventIds: currentEventIds
  });
  
  return processed;
}
```

### UI Integration

#### ConversationDisplay Changes
```typescript
export function ConversationDisplay({ events, ephemeralMessages }: ConversationDisplayProps) {
  const threadProcessor = useThreadProcessor();
  
  // Process all threads
  const processedThreads = useMemo(() => {
    return threadProcessor.processThreads(events);
  }, [events, threadProcessor]);
  
  // Process ephemeral messages (main thread only)
  const ephemeralItems = useMemo(() => {
    return threadProcessor.processEphemeralEvents(ephemeralMessages);
  }, [ephemeralMessages, threadProcessor]);
  
  // Build main timeline with ephemeral messages
  const mainTimeline = useMemo(() => {
    return threadProcessor.buildTimeline(
      processedThreads.mainTimeline.items as ProcessedThreadItems,
      ephemeralItems
    );
  }, [processedThreads.mainTimeline, ephemeralItems, threadProcessor]);
  
  return (
    <Box flexDirection="column" flexGrow={1} paddingY={1}>
      <TimelineDisplay 
        timeline={mainTimeline} 
        delegateTimelines={processedThreads.delegateTimelines}
      />
    </Box>
  );
}
```

#### TimelineDisplay Changes
```typescript
interface TimelineDisplayProps {
  timeline: Timeline;
  delegateTimelines?: Map<string, Timeline>;
}

function TimelineItemDisplay({ item, delegateTimelines }: { 
  item: TimelineItem; 
  delegateTimelines?: Map<string, Timeline>;
}) {
  switch (item.type) {
    case 'tool_execution':
      // Render tool execution normally
      const toolDisplay = <ToolExecutionDisplay callEvent={callEvent} resultEvent={resultEvent} />;
      
      // Check if this is a delegate tool call
      if (item.call.toolName === 'delegate' && delegateTimelines) {
        const delegateThreadId = extractDelegateThreadId(item);
        const delegateTimeline = delegateTimelines.get(delegateThreadId);
        
        if (delegateTimeline) {
          return (
            <Box flexDirection="column">
              {toolDisplay}
              <DelegationBox 
                threadId={delegateThreadId}
                timeline={delegateTimeline}
                // Pass down delegate timelines for sub-delegations
                delegateTimelines={delegateTimelines}
              />
            </Box>
          );
        }
      }
      
      return toolDisplay;
    
    // ... other cases unchanged
  }
}
```

#### DelegationBox Updates
```typescript
interface DelegationBoxProps {
  threadId: string;
  timeline: Timeline;
  delegateTimelines?: Map<string, Timeline>;
}

export function DelegationBox({ threadId, timeline, delegateTimelines }: DelegationBoxProps) {
  const [expanded, setExpanded] = useState(true);
  
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" padding={1} marginY={1}>
      <Box justifyContent="space-between">
        <Text color="blue">🤖 {threadId}</Text>
        <Text color="cyan" onClick={() => setExpanded(!expanded)}>
          {expanded ? '[▼ Collapse]' : '[▶ Expand]'}
        </Text>
      </Box>
      
      {expanded && (
        <Box flexDirection="column" paddingLeft={2}>
          <TimelineDisplay 
            timeline={timeline} 
            delegateTimelines={delegateTimelines} // Enable sub-delegations
          />
        </Box>
      )}
    </Box>
  );
}
```

### Delegate Thread ID Extraction

Multiple strategies for linking delegate tool calls to delegate threads:

#### Strategy 1: System Message Parsing
Look for system messages like "Starting delegation: Title (Thread: main.1)" in main thread.

#### Strategy 2: Temporal Proximity
Match delegate tool calls to delegate threads that started within a small time window.

#### Strategy 3: Enhanced Tool Result
Modify delegate tool to include thread ID in tool result data.

```typescript
function extractDelegateThreadId(
  toolExecution: ToolExecutionItem, 
  delegateTimelines: Map<string, Timeline>
): string | null {
  // Strategy 1: Look for thread ID in tool call input or result
  const input = toolExecution.call.input as any;
  if (input.delegateThreadId) return input.delegateThreadId;
  
  // Strategy 2: Find delegate thread that started near this tool call
  for (const [threadId, timeline] of delegateTimelines.entries()) {
    const firstItem = timeline.items[0];
    if (firstItem && Math.abs(
      firstItem.timestamp.getTime() - toolExecution.timestamp.getTime()
    ) < 5000) { // Within 5 seconds
      return threadId;
    }
  }
  
  return null;
}
```

## Migration Plan

### Phase 1: Add processThreads() method
- Implement new `processThreads()` method alongside existing methods
- No breaking changes to existing API
- Add comprehensive tests

### Phase 2: Update UI components
- Modify ConversationDisplay to use `processThreads()`
- Update TimelineDisplay to accept `delegateTimelines`
- Update DelegationBox to use Timeline instead of raw events

### Phase 3: Implement per-thread caching
- Add thread-specific caching logic
- Optimize incremental processing
- Performance testing

### Phase 4: Enhanced delegate linking
- Improve delegate thread ID extraction
- Consider modifying delegate tool to include thread ID in results
- Add fallback strategies

## Benefits

1. **Clean Separation**: ThreadProcessor focuses on processing, UI focuses on presentation
2. **Sub-delegation Support**: Recursive delegation boxes handle unlimited nesting
3. **Performance**: Per-thread caching avoids reprocessing unchanged threads
4. **Flexibility**: Different interfaces can display threads differently
5. **Tool Pairing**: Processing each thread separately maintains tool call pairing
6. **Scalability**: Handles complex delegation hierarchies efficiently

## Considerations

1. **Memory Usage**: Caching multiple threads increases memory usage
2. **Complexity**: More complex than single-timeline approach
3. **Thread Linking**: Heuristic matching between tool calls and delegate threads
4. **Testing**: Need comprehensive tests for multi-thread scenarios

## Future Enhancements

1. **Thread Relationships**: Explicit parent-child thread relationships
2. **Cross-thread Tool Calls**: Tools that operate across multiple threads
3. **Thread Lifecycle**: Events for thread creation, completion, termination
4. **UI Preferences**: User settings for delegation display (boxes, tabs, etc.)