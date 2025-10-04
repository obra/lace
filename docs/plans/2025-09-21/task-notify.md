# Task Notification System Implementation Plan

## Overview

Implement a system where agents automatically receive notifications when tasks they created are updated by other agents. This prevents "orphaned" tasks where creators never know when their delegated work is completed.

## Problem Statement

Currently when Agent A creates a task and Agent B completes it, Agent A never knows about the completion. The conversation just stops after task creation, leaving the user wondering what happened to their delegated work.

## Solution Architecture

**Design Pattern**: Static utility functions handle notification routing, called by Session as orchestrator.

**Key Insight**: Session already manages both TaskManager and Agents, making it the natural coordination point. Pure functions keep the logic testable and Session's responsibilities clean.

## Implementation Tasks

### Phase 1: Core Infrastructure (TDD Approach)

#### Task 1.1: Create notification types and interfaces

**File**: `packages/core/src/utils/task-notifications.ts` (new file)

**What to do:**
1. Create the file with TypeScript interfaces for notifications
2. Define notification target types and priorities
3. NO implementation logic yet - just type definitions

**Code to write:**
```typescript
// ABOUTME: Type definitions for task notification routing system
// ABOUTME: Defines interfaces and types used by notification utilities

export interface TaskNotification {
  threadId: ThreadId;
  message: string;
  notificationType: 'completion' | 'assignment' | 'status_change' | 'note_added';
  taskId: string;
  priority: 'immediate' | 'background';
}

export interface TaskNotificationContext {
  getAgent: (threadId: ThreadId) => Agent | null;
  sessionId: ThreadId;
}

export type NotificationTarget =
  | 'creator'                    // Always notify task creator
  | 'assignee'                   // Always notify current assignee
  | 'old_assignee'              // Notify previous assignee (reassignments)
  | 'creator_unless_actor'      // Notify creator if they didn't cause the update
  | 'assignee_unless_actor'     // Notify assignee if they didn't cause the update
  | 'creator_unless_author';    // Notify creator if they didn't author the change

// Re-export core types this utility needs
export type { Task, TaskNote, TaskContext } from '@lace/core/tasks/types';
export type { ThreadId } from '@lace/core/threads/types';
```

**Imports needed:**
```typescript
import type { ThreadId } from '@lace/core/threads/types';
import type { Task, TaskNote, TaskContext } from '@lace/core/tasks/types';
import type { Agent } from '@lace/core/agents/agent';
```

**How to test**: Create a simple test file that imports these types and verifies they compile. No runtime tests yet.

**Test file**: `packages/core/src/utils/task-notifications.test.ts`
```typescript
import { describe, it, expect } from 'vitest';
import type { TaskNotification, TaskNotificationContext, NotificationTarget } from './task-notifications';

describe('Task Notification Types', () => {
  it('should compile notification types correctly', () => {
    // Just test that types compile - no runtime logic yet
    const notification: TaskNotification = {
      threadId: 'lace_20250922_test01' as any,
      message: 'test',
      notificationType: 'completion',
      taskId: 'task_123',
      priority: 'immediate'
    };
    expect(notification).toBeDefined();
  });
});
```

**Commit message**: `feat: add task notification type definitions`

#### Task 1.2: Create failing test for task completion notification

**File**: `packages/core/src/utils/task-notifications.test.ts` (expand existing)

**What to do:**
1. Add a comprehensive test that verifies the core functionality
2. This test WILL FAIL because we haven't implemented the function yet
3. Follow TDD - write the test that describes exactly what we want

**Test to add:**
```typescript
import { vi } from 'vitest';
import { routeTaskNotifications } from './task-notifications';
import { asThreadId } from '@lace/core/threads/types';

describe('Task Notification Routing', () => {
  const sessionId = asThreadId('lace_20250922_test01');
  const creatorAgent = asThreadId('lace_20250922_test01.1');
  const assigneeAgent = asThreadId('lace_20250922_test01.2');

  it('should notify creator when task completed by different agent', async () => {
    const mockAgent = {
      sendMessage: vi.fn().mockResolvedValue(undefined)
    };
    const mockGetAgent = vi.fn().mockReturnValue(mockAgent);

    const taskEvent = {
      type: 'task:updated' as const,
      task: {
        id: 'task_123',
        title: 'Test Task',
        status: 'completed' as const,
        createdBy: creatorAgent,
        assignedTo: assigneeAgent,
        prompt: 'Do something important',
        priority: 'medium' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: []
      },
      previousTask: {
        id: 'task_123',
        title: 'Test Task',
        status: 'in_progress' as const,
        createdBy: creatorAgent,
        assignedTo: assigneeAgent,
        prompt: 'Do something important',
        priority: 'medium' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: []
      },
      context: { actor: assigneeAgent }
    };

    await routeTaskNotifications(taskEvent, {
      getAgent: mockGetAgent,
      sessionId
    });

    // Verify creator was notified
    expect(mockGetAgent).toHaveBeenCalledWith(creatorAgent);
    expect(mockAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('completed')
    );
    expect(mockAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining(taskEvent.task.title)
    );
  });
});
```

**Key learning points for engineer:**
- `asThreadId()` creates properly formatted thread IDs
- `vi.fn().mockResolvedValue()` mocks async functions
- `expect.stringContaining()` checks partial string matches
- Test describes behavior before implementation (TDD)

**Expected result**: Test fails with "routeTaskNotifications is not defined"

**Commit message**: `test: add failing test for task completion notifications`

#### Task 1.3: Implement minimal routing function

**File**: `packages/core/src/utils/task-notifications.ts` (expand existing)

**What to do:**
1. Implement ONLY enough to make the test pass
2. Focus on task completion notifications only
3. Hard-code the logic - no fancy rules engine yet

**Code to add:**
```typescript
export async function routeTaskNotifications(
  event: TaskManagerEvent,
  context: TaskNotificationContext
): Promise<void> {
  if (event.type !== 'task:updated') {
    return; // Only handle updates for now
  }

  const { task, previousTask, context: taskContext } = event;

  // Only handle completion notifications for now
  if (task.status === 'completed' &&
      previousTask &&
      previousTask.status !== 'completed' &&
      task.createdBy !== taskContext.actor) {

    const creatorAgent = context.getAgent(task.createdBy);
    if (creatorAgent) {
      const message = `Task '${task.id}' that you created has been completed by ${taskContext.actor}:
Title: "${task.title}"
Status: completed ✅

You can now review the results or create follow-up tasks.`;

      await creatorAgent.sendMessage(message);
    }
  }
}

// Type for TaskManager events (this might need to be defined)
export interface TaskManagerEvent {
  type: 'task:updated' | 'task:created' | 'task:note_added';
  task: Task;
  previousTask?: Task;  // For updates only
  context: TaskContext;
}
```

**Imports needed:**
```typescript
import type { Agent } from '@lace/core/agents/agent';
```

**Expected result**: Test passes

**Commit message**: `feat: implement basic task completion notifications`

#### Task 1.4: Add test and implementation for assignment notifications

**Test to add** (in same test file):
```typescript
it('should notify assignee when task is assigned to them', async () => {
  const mockAgent = {
    sendMessage: vi.fn().mockResolvedValue(undefined)
  };
  const mockGetAgent = vi.fn().mockReturnValue(mockAgent);

  const taskEvent = {
    type: 'task:created' as const,
    task: {
      id: 'task_456',
      title: 'New Assignment',
      status: 'pending' as const,
      createdBy: creatorAgent,
      assignedTo: assigneeAgent,
      prompt: 'Please work on this',
      priority: 'high' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: []
    },
    context: { actor: creatorAgent }
  };

  await routeTaskNotifications(taskEvent, {
    getAgent: mockGetAgent,
    sessionId
  });

  // Verify assignee was notified
  expect(mockGetAgent).toHaveBeenCalledWith(assigneeAgent);
  expect(mockAgent.sendMessage).toHaveBeenCalledWith(
    expect.stringContaining('[LACE TASK SYSTEM]')
  );
  expect(mockAgent.sendMessage).toHaveBeenCalledWith(
    expect.stringContaining('assigned')
  );
});
```

**Implementation to add**:
```typescript
export async function routeTaskNotifications(
  event: TaskManagerEvent,
  context: TaskNotificationContext
): Promise<void> {
  // Handle task creation with assignment
  if (event.type === 'task:created') {
    const { task, context: taskContext } = event;

    if (task.assignedTo && task.assignedTo !== taskContext.actor) {
      const assigneeAgent = context.getAgent(task.assignedTo);
      if (assigneeAgent) {
        const message = `[LACE TASK SYSTEM] You have been assigned task '${task.id}':
Title: "${task.title}"
Created by: ${task.createdBy}
Priority: ${task.priority}

--- TASK DETAILS ---
${task.prompt}
--- END TASK DETAILS ---

Use your task_add_note tool to record progress and task_complete when done.`;

        await assigneeAgent.sendMessage(message);
      }
    }
    return;
  }

  // Handle task updates (existing completion logic)
  if (event.type === 'task:updated') {
    // ... existing completion notification code ...
  }
}
```

**Commit message**: `feat: add task assignment notifications`

### Phase 2: Integration with Session

#### Task 2.1: Integrate with Session class - setup only

**File**: `packages/core/src/sessions/session.ts`

**What to do:**
1. Add event listener setup in Session constructor
2. Create handler methods that call the utility
3. NO new dependencies yet - make it compile but don't test integration

**Code changes:**

Add to constructor (after TaskManager creation):
```typescript
// Set up task notification routing
this.setupTaskNotificationRouting();
```

Add private methods:
```typescript
private setupTaskNotificationRouting(): void {
  this._taskManager.on('task:updated', this.handleTaskUpdate.bind(this));
  this._taskManager.on('task:created', this.handleTaskCreated.bind(this));
}

private async handleTaskUpdate(event: any): Promise<void> {
  // TODO: Call utility function - placeholder for now
  const { routeTaskNotifications } = await import('~/utils/task-notifications');
  await routeTaskNotifications(event, {
    getAgent: (id: ThreadId) => this._agents.get(id) || null,
    sessionId: this._sessionId
  });
}

private async handleTaskCreated(event: any): Promise<void> {
  // TODO: Call utility function - placeholder for now
  const { routeTaskNotifications } = await import('~/utils/task-notifications');
  await routeTaskNotifications(event, {
    getAgent: (id: ThreadId) => this._agents.get(id) || null,
    sessionId: this._sessionId
  });
}
```

**Key points for engineer:**
- Use dynamic import to avoid circular dependencies
- Bind methods to preserve `this` context in event listeners
- Event data structure matches what TaskManager emits

**Commit message**: `feat: add task notification setup to Session`

#### Task 2.2: Fix TaskManager event types

**File**: `packages/core/src/utils/task-notifications.ts`

**What to do:**
1. Check what TaskManager actually emits for events
2. Update the `TaskManagerEvent` interface to match reality
3. Handle the mismatch between our design and existing code

**How to investigate:**
1. Look at `packages/core/src/tasks/task-manager.ts` around line 164
2. See what object structure is passed to `this.emit('task:updated', ...)`
3. Update interface to match

**Expected findings:**
```typescript
// TaskManager actually emits:
this.emit('task:updated', {
  type: 'task:updated',
  task: updatedTask,
  context,
  timestamp: new Date(),
});
```

**Interface fix:**
```typescript
export interface TaskManagerEvent {
  type: 'task:updated' | 'task:created' | 'task:note_added';
  task: Task;
  context: TaskContext;
  timestamp: Date;
  // Note: no previousTask - we'll need to handle this differently
}
```

**Problem discovered**: TaskManager doesn't provide `previousTask` in events. We need a different approach for detecting changes.

**Commit message**: `fix: align TaskManagerEvent interface with reality`

#### Task 2.3: Implement change detection strategy

**File**: `packages/core/src/utils/task-notifications.ts`

**Problem**: We need previous task state to detect what changed, but TaskManager events don't include it.

**Solution Options:**
1. **Session maintains task snapshots** (recommended)
2. **Modify TaskManager to include previousTask** (breaks existing code)
3. **Query database for previous state** (expensive)

**Recommended approach**: Session tracks task snapshots

**Implementation:**

Update Session to track previous states:
```typescript
// Add to Session class
private _previousTaskStates = new Map<string, Task>();

private async handleTaskUpdate(event: TaskManagerEvent): Promise<void> {
  const previousTask = this._previousTaskStates.get(event.task.id) || null;

  await routeTaskNotifications(event, {
    getAgent: (id: ThreadId) => this._agents.get(id) || null,
    sessionId: this._sessionId,
    previousTask // Add this to context
  });

  // Update snapshot for next time
  this._previousTaskStates.set(event.task.id, { ...event.task });
}
```

Update utility function signature:
```typescript
export interface TaskNotificationContext {
  getAgent: (threadId: ThreadId) => Agent | null;
  sessionId: ThreadId;
  previousTask?: Task; // Add this
}
```

**Commit message**: `feat: add task state tracking for change detection`

### Phase 3: Comprehensive Notification Logic

#### Task 3.1: Write tests for all notification types

**File**: `packages/core/src/utils/task-notifications.test.ts` (expand)

**What to do**: Add test cases for every notification scenario. Write all tests first, then implement.

**Critical test cases to add:**

1. **Assignment notifications**:
```typescript
it('should notify new assignee when task is assigned', async () => { /* test task creation with assignedTo */ });
it('should notify both agents when task is reassigned', async () => { /* test assignedTo change */ });
```

2. **Status change notifications**:
```typescript
it('should notify creator when assignee starts working', async () => { /* pending → in_progress */ });
it('should notify creator when task becomes blocked', async () => { /* * → blocked */ });
```

3. **Edge cases**:
```typescript
it('should not notify creator when they complete their own task', async () => { /* creator === actor */ });
it('should handle missing agents gracefully', async () => { /* getAgent returns null */ });
it('should not notify for trivial status changes', async () => { /* pending → pending */ });
```

**Testing patterns to teach engineer:**
- Create mock agents with `sendMessage: vi.fn().mockResolvedValue(undefined)`
- Use `expect.stringContaining()` for message content verification
- Test negative cases (should NOT notify) with `expect().not.toHaveBeenCalled()`
- Create helper functions for common test data setup

**Expected result**: All tests fail because functions don't exist

**Commit message**: `test: add comprehensive test suite for task notifications`

#### Task 3.2: Implement notification analysis logic

**File**: `packages/core/src/utils/task-notifications.ts`

**What to do**: Implement the core logic to make tests pass, one notification type at a time.

**Implementation strategy**:
1. Start with task completion (already working)
2. Add assignment notifications
3. Add status change notifications
4. Add edge case handling

**Key functions to implement:**
```typescript
function analyzeTaskEventForNotifications(
  event: TaskManagerEvent,
  previousTask?: Task
): TaskNotification[] {
  switch (event.type) {
    case 'task:created':
      return analyzeTaskCreation(event.task, event.context);
    case 'task:updated':
      return analyzeTaskUpdate(event.task, previousTask, event.context);
    default:
      return [];
  }
}

function analyzeTaskCreation(task: Task, context: TaskContext): TaskNotification[] {
  // Handle assignment notifications for newly created tasks
}

function analyzeTaskUpdate(task: Task, previousTask: Task | null, context: TaskContext): TaskNotification[] {
  // Handle completion, status changes, reassignments
}
```

**Implementation tips for engineer:**
- Implement one notification type at a time
- Run tests after each type to ensure it works
- Use helper functions to avoid repetition
- Focus on the business logic first, optimize later

**Commit after each type**:
- `feat: implement task assignment notifications`
- `feat: implement task status change notifications`
- `feat: implement task completion notifications`

#### Task 3.3: Add message formatting functions

**File**: `packages/core/src/utils/task-notifications.ts`

**What to do**: Extract message formatting into pure functions for consistency and testing.

**Functions to create:**
```typescript
function formatCompletionNotification(task: Task, completedBy: ThreadId): string {
  return `Task '${task.id}' that you created has been completed by ${completedBy}:
Title: "${task.title}"
Status: completed ✅

You can now review the results or create follow-up tasks.`;
}

function formatTaskAssignment(task: Task): string {
  return `[LACE TASK SYSTEM] You have been assigned task '${task.id}':
Title: "${task.title}"
Created by: ${task.createdBy}
Priority: ${task.priority}

--- TASK DETAILS ---
${task.prompt}
--- END TASK DETAILS ---

Use your task_add_note tool to record progress and task_complete when done.`;
}

function formatStatusChangeNotification(task: Task, newStatus: string, changedBy: ThreadId): string {
  return `Task '${task.id}' status changed to ${newStatus} by ${changedBy}:
Title: "${task.title}"`;
}
```

**Testing approach**: Add unit tests for each formatter function to verify message content.

**Refactor existing code**: Replace inline message strings with formatter function calls.

**Commit message**: `refactor: extract message formatting functions`

### Phase 4: Integration Testing

#### Task 4.1: Create integration test

**File**: `packages/core/src/tasks/task-notification-integration.test.ts` (new)

**What to do**: Test the entire flow from task update through to agent receiving message.

**Test setup needed**:
```typescript
import { Session } from '@lace/core/sessions/session';
import { Agent } from '@lace/core/agents/agent';
import { setupCoreTest } from '@lace/core/test-utils/core-test-setup';

describe('Task Notification Integration', () => {
  let session: Session;
  let creatorAgent: Agent;
  let assigneeAgent: Agent;

  beforeEach(async () => {
    // Create real session with real agents
    // This tests the full integration
  });

  it('should deliver completion notification through full system', async () => {
    // 1. Creator agent creates task
    // 2. Task gets assigned to assignee
    // 3. Assignee completes task
    // 4. Verify creator receives notification message
  });
});
```

**Key integration testing concepts:**
- Use real Session and Agent objects, not mocks
- Test the actual message delivery pipeline
- Verify events appear in thread history
- Test with real TaskManager events

**Expected challenges**:
- Need to set up full agent infrastructure
- May need to mock provider responses
- Threading and async timing issues

**Commit message**: `test: add task notification integration tests`

#### Task 4.2: Fix integration issues discovered by tests

**Files**: Various (determined by test failures)

**What to do**: Run integration tests and fix whatever breaks. Common issues:

1. **Circular import problems**: Session imports utility, utility imports Session types
   - **Fix**: Create shared types file or use dynamic imports

2. **Agent.sendMessage() doesn't exist or works differently**:
   - **Fix**: Check Agent class API and use correct method

3. **Event listener timing issues**: Listeners not set up before events fire
   - **Fix**: Ensure setupTaskNotificationRouting() called at right time

4. **Event data structure mismatches**: Our interface doesn't match reality
   - **Fix**: Update interfaces to match actual TaskManager events

**Debugging approach for engineer:**
- Add extensive logging to see what events are actually emitted
- Use debugger to step through event flow
- Check that event listeners are actually registered
- Verify agent.sendMessage() is being called with correct parameters

**Commit messages**: Individual commits for each fix discovered

### Phase 5: Note Notifications (Optional Extension)

#### Task 5.1: Add note notification tests

**Test scenarios**:
- Significant notes (>50 chars) notify creator
- Trivial notes ("started working") don't notify
- Creator's own notes don't notify themselves

#### Task 5.2: Implement note notifications

**Implementation location**: Add to `analyzeTaskEventForNotifications()` function

### Phase 6: Polish and Documentation

#### Task 6.1: Add configuration options

**File**: Create `packages/core/src/utils/task-notification-config.ts`

**What to add**:
```typescript
export interface TaskNotificationConfig {
  enableCompletionNotifications: boolean;
  enableAssignmentNotifications: boolean;
  enableStatusChangeNotifications: boolean;
  enableNoteNotifications: boolean;
  noteNotificationMinLength: number;
}

export const DEFAULT_NOTIFICATION_CONFIG: TaskNotificationConfig = {
  enableCompletionNotifications: true,
  enableAssignmentNotifications: true,
  enableStatusChangeNotifications: true,
  enableNoteNotifications: false, // Start conservative
  noteNotificationMinLength: 50
};
```

#### Task 6.2: Add performance considerations

**Potential issues**:
- Lots of agents × lots of tasks = lots of events
- Message injection could be slow
- Need to handle agent unavailability gracefully

**Solutions to implement**:
- Async message delivery with error handling
- Handle agent unavailability gracefully

#### Task 6.3: Update documentation

**Files to update**:
- `docs/architecture/CODE-MAP.md` - Add task notification utilities
- Add ABOUTME comments to new files
- Update Session class documentation

## Testing Strategy

### Unit Tests
- Test utility functions in isolation with mocked dependencies
- Focus on business logic: who gets notified when
- Test message formatting functions separately

### Integration Tests
- Test full flow: TaskManager event → Session coordination → Agent message delivery
- Use real components but controlled scenarios
- Verify events appear in thread history correctly

### Manual Testing
- Create tasks through web UI
- Complete them with different agents
- Verify notifications appear in creator's conversation

## Success Criteria

1. **Functional**: When Agent A creates a task and Agent B completes it, Agent A gets notified
2. **Non-disruptive**: Existing task functionality continues to work unchanged
3. **Testable**: >90% test coverage on notification logic
4. **Performant**: No noticeable delay in task operations
5. **Maintainable**: Clear separation between notification logic and core Session concerns


## Implementation Notes

- **Follow TDD strictly**: Write failing test → implement minimum → refactor → repeat
- **Commit frequently**: After each test passes, commit the change
- **Start simple**: Implement only completion notifications first, add others incrementally
- **Use existing patterns**: Study how Session currently coordinates between TaskManager and Agents
- **Watch for coupling**: If notification logic starts polluting Session, extract to separate coordinator class

This plan gets the engineer from zero to fully functional task notifications while maintaining code quality and testability.