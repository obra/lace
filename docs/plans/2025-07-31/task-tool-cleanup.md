# Task Tool Data Flow Cleanup

## Problem Statement

Task tool renderers in the web UI are showing raw task IDs instead of meaningful information like task titles. The issue is that task tools return plain text messages, but the UI expects structured metadata containing complete Task objects.

## Architecture Overview

### Task Tool Data Flow
```
Task Tool → ToolResult with Task Metadata → Event System → Timeline Renderer → Rich UI Display
```

**Key Principle:** Task tools capture complete Task state at event-time in structured metadata, enabling rich UI displays without additional API calls.

### Key Components

1. **Task Tools** (`src/tools/implementations/task-manager/tools.ts`)
   - Backend tools that perform task operations
   - Must return structured metadata with complete Task objects

2. **Timeline Converter** (`packages/web/lib/timeline-converter.ts`)
   - Processes events and passes metadata to renderers
   - Already handles metadata flow correctly

3. **Task Renderers** (`packages/web/components/timeline/tool/task.tsx`)
   - UI components that display task operations
   - Should use structured metadata, not parse text

4. **Task Type** (`src/tools/implementations/task-manager/types.ts`)
   - Defines the complete Task interface
   - Contains all fields needed for rich UI display

## Implementation Plan

### Prerequisites

**Required Reading:**
- `src/tools/implementations/task-manager/types.ts` - Task interface definition
- `src/tools/tool.ts` - Base Tool class and ToolResult interface
- `packages/web/components/timeline/tool/types.ts` - ToolRenderer interface
- `CLAUDE.md` - Project coding standards and test requirements

**Key Rules:**
- NEVER use `any` types - use proper TypeScript interfaces
- NEVER mock the functionality under test - use real codepaths
- Follow TDD: write failing test first, implement minimal code to pass
- Make frequent commits after each working increment
- YAGNI: implement only what's needed, don't over-engineer

### Task 1: Add Metadata to TaskCreateTool

**Goal:** TaskCreateTool returns complete Task object in metadata

**Files to modify:**
- `src/tools/implementations/task-manager/tools.ts` (TaskCreateTool class)
- `src/tools/implementations/task-manager/tools.test.ts` (add/update tests)

**Implementation:**

1. **Write failing test first:**
```typescript
// In tools.test.ts
it('should return complete Task object in result metadata', async () => {
  const tool = new TaskCreateTool();
  const result = await tool.execute({
    title: 'Test Task',
    description: 'Test description',
    prompt: 'Test prompt',
    priority: 'high' as const
  }, mockContext);
  
  expect(result.metadata).toBeDefined();
  expect(result.metadata.task).toBeDefined();
  
  const task = result.metadata.task as Task;
  expect(task.id).toMatch(/^task_\d{8}_[a-z0-9]{6}$/);
  expect(task.title).toBe('Test Task');
  expect(task.status).toBe('pending');
  expect(task.priority).toBe('high');
  // ... validate all Task fields
});
```

2. **Run test to see it fail:** `npm test -- tools.test.ts`

3. **Implement minimal fix in TaskCreateTool.executeValidated():**
```typescript
// After task creation, before return
const taskMetadata = {
  task: task, // Complete Task object
  operation: 'create' as const
};

return this.createResult(message, taskMetadata);
```

4. **Run test to see it pass**

5. **Commit:** "feat: add Task metadata to TaskCreateTool result"

**Testing:**
- Unit test: `npm test -- tools.test.ts`
- Integration test: Create a task via CLI and verify metadata flows through

### Task 2: Add Metadata to TaskUpdateTool

**Goal:** TaskUpdateTool returns complete Task object plus change tracking

**Files to modify:**
- `src/tools/implementations/task-manager/tools.ts` (TaskUpdateTool class)
- `src/tools/implementations/task-manager/tools.test.ts`

**Implementation:**

1. **Write failing test:**
```typescript
it('should return Task metadata with change tracking for updates', async () => {
  // First create a task
  const createTool = new TaskCreateTool();
  const createResult = await createTool.execute({
    title: 'Original Title',
    prompt: 'test',
    priority: 'medium' as const
  }, mockContext);
  
  const taskId = (createResult.metadata.task as Task).id;
  
  // Then update it
  const updateTool = new TaskUpdateTool();
  const result = await updateTool.execute({
    taskId: taskId,
    status: 'in_progress' as const,
    priority: 'high' as const
  }, mockContext);
  
  expect(result.metadata.task).toBeDefined();
  expect(result.metadata.changes).toBeDefined();
  
  const task = result.metadata.task as Task;
  const changes = result.metadata.changes as Record<string, {from: unknown, to: unknown}>;
  
  expect(task.status).toBe('in_progress');
  expect(task.priority).toBe('high');
  expect(changes.status.from).toBe('pending');
  expect(changes.status.to).toBe('in_progress');
  expect(changes.priority.from).toBe('medium');
  expect(changes.priority.to).toBe('high');
});
```

2. **Run test to see it fail**

3. **Implement in TaskUpdateTool.executeValidated():**
```typescript
// Load existing task BEFORE making changes
const existingTask = this.getTaskManager 
  ? await taskManager.getTask(args.taskId, taskContext)
  : persistence.loadTask(args.taskId);

if (!existingTask) {
  return this.createError(`Task ${args.taskId} not found`);
}

// Track what's changing
const changes: Record<string, {from: unknown, to: unknown}> = {};
if (args.status && args.status !== existingTask.status) {
  changes.status = { from: existingTask.status, to: args.status };
}
if (args.priority && args.priority !== existingTask.priority) {
  changes.priority = { from: existingTask.priority, to: args.priority };
}
// ... handle other fields

// Apply the update
const updatedTask = await taskManager.updateTask(args.taskId, updates, taskContext);

// Return with metadata
const metadata = {
  task: updatedTask,
  changes: Object.keys(changes).length > 0 ? changes : undefined,
  operation: 'update' as const
};

return this.createResult(message, metadata);
```

4. **Run test to see it pass**

5. **Commit:** "feat: add Task metadata with change tracking to TaskUpdateTool"

### Task 3: Add Metadata to TaskCompleteTool

**Goal:** TaskCompleteTool returns Task object with status change tracking

**Files to modify:**
- `src/tools/implementations/task-manager/tools.ts` (TaskCompleteTool class)
- `src/tools/implementations/task-manager/tools.test.ts`

**Implementation:**

1. **Write failing test:**
```typescript
it('should return Task metadata with status change for completion', async () => {
  // Create task in pending state
  const createTool = new TaskCreateTool();
  const createResult = await createTool.execute({
    title: 'Task to Complete',
    prompt: 'test'
  }, mockContext);
  
  const taskId = (createResult.metadata.task as Task).id;
  
  // Complete it
  const completeTool = new TaskCompleteTool();
  const result = await completeTool.execute({
    id: taskId
  }, mockContext);
  
  expect(result.metadata.task).toBeDefined();
  expect(result.metadata.changes).toBeDefined();
  
  const task = result.metadata.task as Task;
  const changes = result.metadata.changes as Record<string, {from: unknown, to: unknown}>;
  
  expect(task.status).toBe('completed');
  expect(changes.status.from).toBe('pending');
  expect(changes.status.to).toBe('completed');
});
```

2. **Implement similar pattern to TaskUpdateTool**
3. **Test and commit**

### Task 4: Add Metadata to TaskAddNoteTool

**Goal:** TaskAddNoteTool returns Task object with updated notes

**Files to modify:**
- `src/tools/implementations/task-manager/tools.ts` (TaskAddNoteTool class)
- `src/tools/implementations/task-manager/tools.test.ts`

**Implementation:**

1. **Write failing test** - verify task metadata includes the new note
2. **Load existing task, add note, return updated task in metadata**
3. **Test and commit**

### Task 5: Add Metadata to TaskViewTool

**Goal:** TaskViewTool returns complete Task object

**Files to modify:**
- `src/tools/implementations/task-manager/tools.ts` (TaskViewTool class)
- `src/tools/implementations/task-manager/tools.test.ts`

**Implementation:**

1. **Write failing test** - verify complete task data in metadata
2. **Return the loaded task in metadata**
3. **Test and commit**

### Task 6: Add Metadata to TaskListTool

**Goal:** TaskListTool returns array of complete Task objects

**Files to modify:**
- `src/tools/implementations/task-manager/tools.ts` (TaskListTool class)
- `src/tools/implementations/task-manager/tools.test.ts`

**Implementation:**

1. **Write failing test:**
```typescript
it('should return complete Task objects in metadata', async () => {
  // Create a few tasks first
  const createTool = new TaskCreateTool();
  await createTool.execute({title: 'Task 1', prompt: 'test'}, mockContext);
  await createTool.execute({title: 'Task 2', prompt: 'test'}, mockContext);
  
  const listTool = new TaskListTool();
  const result = await listTool.execute({
    filter: 'all' as const
  }, mockContext);
  
  expect(result.metadata.tasks).toBeDefined();
  expect(Array.isArray(result.metadata.tasks)).toBe(true);
  
  const tasks = result.metadata.tasks as Task[];
  expect(tasks.length).toBeGreaterThan(0);
  
  // Verify each task has complete Task interface
  tasks.forEach(task => {
    expect(task.id).toBeDefined();
    expect(task.title).toBeDefined();
    expect(task.status).toBeDefined();
    // ... validate all Task fields
  });
});
```

2. **Implement metadata return:**
```typescript
const metadata = {
  tasks: tasks, // Array of complete Task objects
  totalCount: tasks.length,
  filter: args.filter,
  operation: 'list' as const
};

return this.createResult(headerText, metadata);
```

3. **Test and commit**

### Task 7: Update Task Renderers to Use Metadata

**Goal:** Task renderers use structured metadata instead of parsing text

**Files to modify:**
- `packages/web/components/timeline/tool/task.tsx` (all task renderers)
- `packages/web/components/timeline/tool/task.test.ts`

**Implementation:**

1. **Update TaskCompleteRenderer:**
```typescript
renderResult: (result: ToolResult, metadata?: ToolAggregatedEventData): React.ReactNode => {
  if (result.isError) {
    // ... error handling
  }
  
  // Use structured metadata
  const task = result.metadata?.task as Task | undefined;
  const changes = result.metadata?.changes as Record<string, {from: unknown, to: unknown}> | undefined;
  
  if (task) {
    return (
      <div className="p-3">
        <div className="flex items-center gap-2 text-sm text-success">
          <FontAwesomeIcon icon={faCheck} className="w-4 h-4" />
          <span className="font-medium">
            {task.title} completed
          </span>
        </div>
      </div>
    );
  }
  
  return <div></div>;
},
```

2. **Update TaskUpdateRenderer to show changes:**
```typescript
if (task && changes) {
  const changeMessages: string[] = [];
  if (changes.status) {
    changeMessages.push(`status: ${changes.status.from} → ${changes.status.to}`);
  }
  if (changes.priority) {
    changeMessages.push(`priority: ${changes.priority.from} → ${changes.priority.to}`);
  }
  // ... other changes
  
  return (
    <div className="p-3">
      <div className="flex items-center gap-2 text-sm text-primary">
        <FontAwesomeIcon icon={faEdit} className="w-4 h-4" />
        <span className="font-medium">
          {task.title} updated
          {changeMessages.length > 0 && ` (${changeMessages.join(', ')})`}
        </span>
      </div>
    </div>
  );
}
```

3. **Update all other renderers similarly**

4. **Write/update renderer tests:**
```typescript
test('should display task title from metadata', () => {
  const mockResult: ToolResult = {
    content: [{ type: 'text', text: 'Task completed' }],
    isError: false,
    metadata: {
      task: {
        id: 'task_123',
        title: 'Fix authentication bug',
        status: 'completed',
        // ... other Task fields
      } as Task
    }
  };
  
  const resultNode = taskRenderers.task_complete.renderResult?.(mockResult);
  // Test that it shows "Fix authentication bug completed"
});
```

5. **Test all renderers work with new metadata**

6. **Commit:** "feat: update task renderers to use structured Task metadata"

### Task 8: Integration Testing

**Goal:** Verify complete data flow from tool execution to UI display

**Files to check:**
- End-to-end flow test
- Manual testing via web UI

**Testing Process:**

1. **Create integration test:**
```typescript
// In a new integration test file
it('should show meaningful task updates in timeline', async () => {
  // Create task
  const createResult = await executeTaskTool('task_add', {
    title: 'Integration Test Task',
    prompt: 'test'
  });
  
  const taskId = createResult.metadata?.task?.id;
  expect(taskId).toBeDefined();
  
  // Update task
  const updateResult = await executeTaskTool('task_update', {
    taskId: taskId,
    status: 'in_progress',
    priority: 'high'
  });
  
  // Verify metadata structure
  expect(updateResult.metadata?.task?.title).toBe('Integration Test Task');
  expect(updateResult.metadata?.changes?.status).toEqual({
    from: 'pending',
    to: 'in_progress'
  });
});
```

2. **Manual testing:**
   - Start web UI: `npm run dev`
   - Create a task via chat
   - Update the task
   - Verify timeline shows "Task Name updated (status: pending → in_progress)"

3. **Fix any issues found**

4. **Commit:** "test: add integration tests for task metadata flow"

### Task 9: Clean Up and Documentation

**Goal:** Remove dead code, update documentation

**Files to modify:**
- Remove any unused parsing logic from renderers
- Update type definitions if needed
- Add code comments explaining metadata structure

**Implementation:**

1. **Remove old text parsing code from renderers**
2. **Add JSDoc comments to key interfaces**
3. **Update this document with any lessons learned**
4. **Commit:** "docs: clean up task renderer code and add documentation"

## Testing Strategy

### Unit Tests
- Each task tool has comprehensive tests for metadata structure
- Each renderer has tests for displaying metadata correctly
- Focus on edge cases: missing metadata, malformed data, errors

### Integration Tests  
- Test complete flow from tool execution to UI rendering
- Verify metadata flows through event system correctly
- Test with real TaskManager vs fallback persistence

### Manual Testing
- Use web UI to perform various task operations
- Verify meaningful messages appear in timeline
- Test error cases (task not found, invalid operations)

## Success Criteria

1. **Task timeline entries show meaningful information:**
   - "Fix authentication bug completed" instead of "task_20250730_yk2p41"
   - "User dashboard updated (status: pending → in_progress)" with change details

2. **All task tools return structured metadata:**
   - Complete Task objects in `result.metadata.task`
   - Change tracking in `result.metadata.changes` where applicable
   - Consistent metadata structure across all tools

3. **Type safety maintained:**
   - No `any` types used
   - Proper Task interface usage throughout
   - Full TypeScript compilation without warnings

4. **Performance maintained:**
   - No API calls during rendering
   - Event-time snapshots preserve historical accuracy
   - Timeline renders instantly with cached metadata

## Rollback Plan

If issues arise:
1. Revert to previous commit: `git revert <commit-hash>`
2. Task renderers fall back to text parsing (already implemented)
3. Fix metadata issues in task tools
4. Re-deploy with proper metadata

The current fallback behavior ensures the UI remains functional even with incomplete metadata implementation.