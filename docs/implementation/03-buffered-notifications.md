# Buffered Notifications Implementation Specification

## Overview
Add message queueing to agents so they can receive notifications (task assignments, status updates) while busy processing. Messages queue up and are delivered when the agent returns to idle state.

## Background for Engineers

### Current Message Flow
1. User types message in terminal
2. UI blocks if agent is busy (shows warning)
3. User must wait and retry
4. No way to queue messages

### Agent States
- `idle` - Ready for messages
- `thinking` - Processing/planning response  
- `streaming` - Outputting response
- `tool_execution` - Running tools

### Key Files to Understand
- `src/agents/agent.ts` - Agent class and state machine
- `src/interfaces/terminal-interface.tsx` - React terminal UI (uses Ink)
- `src/threads/types.ts` - Message/event types
- `src/agents/__tests__/agent.test.ts` - Agent tests

## Implementation Plan

### Phase 1: Add Message Queue to Agent

**Task 1.1: Define queue types**

File: `src/agents/types.ts` (update)

```typescript
export interface QueuedMessage {
  id: string;
  type: 'user' | 'system' | 'task_notification';
  content: string;
  timestamp: Date;
  metadata?: {
    taskId?: string;
    fromAgent?: string;
    priority?: 'normal' | 'high';
    source?: 'task_system' | 'user_input' | 'agent_message';
  };
}

export interface MessageQueueStats {
  queueLength: number;
  oldestMessageAge?: number;
  highPriorityCount: number;
}
```

Tests:
- Type validation tests
- Queue message creation

**Commit**: "feat: define message queue types"

**Task 1.2: Add queue to Agent class**

File: `src/agents/agent.ts`

Add to Agent class:
```typescript
class Agent {
  private messageQueue: QueuedMessage[] = [];
  private isProcessingQueue = false;
  
  // Queue a message (public API)
  queueMessage(
    content: string, 
    type: QueuedMessage['type'] = 'user',
    metadata?: QueuedMessage['metadata']
  ): string // returns message ID
  
  // Get queue statistics
  getQueueStats(): MessageQueueStats
  
  // Clear queue (with optional filter)
  clearQueue(filter?: (msg: QueuedMessage) => boolean): number
  
  // Process queued messages when idle
  private async processQueuedMessages(): Promise<void>
}
```

Implementation notes:
- Only queue when state !== 'idle'
- Process queue when returning to idle
- High priority messages go to front
- Emit events for queue changes

Tests:
- Test queueing while busy
- Test immediate processing when idle
- Test priority ordering
- Test queue clearing

**Commit**: "feat: add message queue to Agent class"

### Phase 2: Integrate Queue Processing

**Task 2.1: Hook into state transitions**

File: `src/agents/agent.ts`

Modify `setState()` method:
```typescript
private setState(newState: AgentState): void {
  const oldState = this.state;
  this.state = newState;
  this.emit('state_change', { from: oldState, to: newState });
  
  // Process queue when returning to idle
  if (newState === 'idle' && !this.isProcessingQueue) {
    this.processQueuedMessages();
  }
}
```

Tests:
- Test queue processing triggers on idle
- Test no recursive processing
- Test state transitions during queue processing

**Commit**: "feat: auto-process queue on idle"

**Task 2.2: Update sendMessage to support queueing**

Current `sendMessage()` throws if not idle. Update to:

```typescript
async sendMessage(
  content: string, 
  options?: { 
    queue?: boolean;
    metadata?: QueuedMessage['metadata'];
  }
): Promise<void> {
  if (this.state === 'idle') {
    // Process immediately
    return this.processMessage(content);
  }
  
  if (options?.queue) {
    // Queue for later
    const id = this.queueMessage(content, 'user', options.metadata);
    this.emit('message_queued', { id, queueLength: this.messageQueue.length });
    return;
  }
  
  // Current behavior - throw error
  throw new Error(`Agent is ${this.state}, cannot accept messages`);
}
```

Tests:
- Test queue option works
- Test backwards compatibility
- Test events emitted

**Commit**: "feat: add queue option to sendMessage"

### Phase 3: Add System Notifications

**Task 3.1: Create notification formatter**

File: `src/agents/notifications.ts` (new)

```typescript
export class NotificationFormatter {
  static formatTaskAssignment(task: {
    title: string;
    prompt: string;
    priority: string;
    createdBy: string;
  }): string {
    return `[LACE TASK SYSTEM] You have been assigned a new task:
Title: "${task.title}"
Created by: ${task.createdBy}
Priority: ${task.priority}

--- TASK DETAILS ---
${task.prompt}
--- END TASK DETAILS ---`;
  }
  
  static formatTaskCompletion(task: {
    title: string;
    assignedTo: string;
    notes: Array<{ content: string; author: string }>;
  }): string {
    // Format completion notification
  }
}
```

Tests:
- Test formatting produces expected output
- Test escaping/sanitization
- Test empty fields handled

**Commit**: "feat: add notification formatters"

### Phase 4: UI Integration

**Task 4.1: Show queue status in terminal**

File: `src/interfaces/terminal-interface.tsx`

Add queue indicator to status bar:

```typescript
const QueueIndicator: React.FC<{ stats: MessageQueueStats }> = ({ stats }) => {
  if (stats.queueLength === 0) return null;
  
  return (
    <Box>
      <Text color="yellow">
        📬 {stats.queueLength} queued
        {stats.highPriorityCount > 0 && ` (${stats.highPriorityCount} high)`}
      </Text>
    </Box>
  );
};
```

Note for React devs:
- Ink uses React but renders to terminal
- No DOM, uses Box/Text components
- Flexbox layout works similarly

Tests:
- Test indicator shows/hides correctly
- Test count updates
- Test priority indication

**Commit**: "feat: add queue indicator to UI"

**Task 4.2: Update input handling**

Allow queueing when agent busy:

```typescript
const handleSubmit = (input: string) => {
  if (agentState === 'idle') {
    // Normal send
    agent.sendMessage(input);
  } else {
    // Offer to queue
    setPrompt({
      message: 'Agent is busy. Queue message? (y/n)',
      onResponse: (response) => {
        if (response.toLowerCase() === 'y') {
          agent.sendMessage(input, { queue: true });
          addMessage({
            type: 'system',
            content: '📬 Message queued',
          });
        }
      }
    });
  }
};
```

Tests:
- Test queue prompt appears
- Test message queued on 'y'
- Test cancelled on 'n'

**Commit**: "feat: add UI queue controls"

### Phase 5: Event Integration

**Task 5.1: Emit queue events**

Add events to Agent:
- `message_queued` - When message added to queue
- `queue_processing_start` - Starting to process queue
- `queue_processing_complete` - Finished processing
- `queue_cleared` - Queue was cleared

File: `src/agents/agent.ts`

Tests:
- Test all events emitted
- Test event data correct
- Test event ordering

**Commit**: "feat: add queue events"

### Phase 6: Testing & Polish

**Task 6.1: End-to-end tests**

File: `src/agents/__tests__/agent-queue-e2e.test.ts`

Scenarios:
1. User queues multiple messages during long operation
2. Task notifications queue while agent busy
3. High priority messages processed first
4. Queue survives errors in processing

**Task 6.2: Add queue management commands**

Add commands to clear/inspect queue:
- `/queue` - Show queue contents
- `/queue clear` - Clear all queued user messages (not system messages)

## Testing Strategy

### Unit Tests
- Queue operations (add, remove)
- State transition hooks
- Event emissions
- Priority handling

### Integration Tests
- Full message flow with queueing
- UI updates with queue
- Multiple agents with separate queues

### Manual Testing
1. Start long-running task
2. Try to send message (should offer queue)
3. Queue several messages
4. Watch them process when agent idle
5. Test high-priority interruption

## React/Ink Considerations

### For React Developers
- Ink renders React to terminal
- Use Box for layout (like div)
- Use Text for content (like span)
- No CSS - use props like color, bold
- Hooks work normally
- No onClick - keyboard input only

### Example Ink Component
```typescript
const MyComponent: React.FC = () => {
  const [count, setCount] = useState(0);
  
  useInput((input) => {
    if (input === '+') setCount(c => c + 1);
  });
  
  return (
    <Box flexDirection="column">
      <Text bold>Count: {count}</Text>
      <Text dim>Press + to increment</Text>
    </Box>
  );
};
```

## Performance Considerations

- Limit queue size (e.g., 100 messages)
- Process in batches for efficiency
- Don't block UI updates during processing
- Consider queue persistence for crashes

## Error Handling

- Failed message processing shouldn't stop queue
- Log errors but continue with next message
- Provide way to retry failed messages
- Never lose queued messages

## Future Enhancements

- Edit queued messages
- Cancel specific queued messages
