# Task Management & Delegation Tool Improvements

**Date**: 2025-07-25  
**Author**: Implementation Team  
**Status**: Ready for Implementation  

## Overview

This plan improves Lace's task management and delegation systems by:
1. Removing dead fallback code that bypasses session architecture
2. Adding bulk task creation for efficient work breakdown  
3. Updating model references to latest versions
4. Improving tool descriptions and prompting

## Prerequisites

### Required Knowledge
- **TypeScript**: Basic syntax, interfaces, union types, generics
- **Zod**: Schema validation library used for tool parameters
- **Testing**: Unit tests with Vitest, integration patterns
- **Git**: Commits, branching, basic workflow

### Key Architecture Concepts
- **Session**: Top-level container managing agents and shared TaskManager
- **TaskManager**: Session-scoped service handling task CRUD and agent spawning
- **Tools**: Schema-validated functions that agents can call
- **Agent Delegation**: Spawning subagents to handle specific tasks

### Critical Rules
- **NEVER use `any` types** - Use proper TypeScript typing or `unknown` with type guards
- **NEVER mock functionality under test** - Use real codepaths, mock only external dependencies
- **TDD Required** - Write failing tests first, implement to pass, refactor
- **Session TaskManager Only** - Never use `getPersistence()` directly in tools
- **Frequent Commits** - Commit after each working test/implementation pair

## Task 1: Remove Fallback Code from Task Tools

**Objective**: Remove ~200 lines of dead backward compatibility code that bypasses session architecture.

### Files to Modify
- `src/tools/implementations/task-manager/tools.ts` (primary)
- Test files may need updating if they test fallback paths

### Background
Each task tool has an `if/else` pattern:
```typescript
if (this.getTaskManager) {
  // Use session's TaskManager - KEEP THIS
} else {
  // Fallback using getPersistence() - REMOVE THIS ENTIRE BRANCH
}
```

The fallback code is problematic because:
- Uses `getPersistence()` instead of session's TaskManager
- Bypasses agent creation callbacks needed for delegation
- Duplicates TaskManager logic
- No longer needed since TaskManager injection is guaranteed

### Implementation Steps

#### 1.1 Write Tests to Verify TaskManager Usage
**File**: `src/tools/implementations/task-manager/tools.test.ts` (create if needed)

Create tests that verify tools fail gracefully when TaskManager is missing:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { TaskCreateTool, TaskListTool, TaskCompleteTool, TaskUpdateTool, TaskAddNoteTool, TaskViewTool } from './tools';

describe('Task Tools TaskManager Requirements', () => {
  it('task_add should require TaskManager', async () => {
    const tool = new TaskCreateTool();
    // Don't inject getTaskManager - should fail
    
    const result = await tool.execute({
      title: 'Test Task',
      prompt: 'Test prompt'
    }, { threadId: 'test-thread' });
    
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('TaskManager is required');
  });
  
  // Repeat for each tool class...
});
```

**Test Command**: `npm test -- src/tools/implementations/task-manager/tools.test.ts`

#### 1.2 Remove Fallback Code from TaskCreateTool
**File**: `src/tools/implementations/task-manager/tools.ts`

Remove lines 78-104 (the entire `else` branch). Keep the existing logic structure since Task 2 will update the schema and implementation together.

**Important**: This step only removes the fallback `else` branch. The main logic stays the same until Task 2 updates it for bulk creation.

Find this pattern in `TaskCreateTool.executeValidated()`:
```typescript
if (this.getTaskManager) {
  // Use session's TaskManager - KEEP ALL THIS CODE
  const taskManager = this.getTaskManager();
  // ... existing implementation
} else {
  // DELETE: Remove this entire else block (lines ~78-104)
  // This includes the fallback persistence code
}
```

After removal, ensure the method ends with just the TaskManager path and proper error handling.

**Run Tests**: Ensure your new test passes and existing tests still work.

#### 1.3 Remove Fallback Code from Remaining Tools
Apply the same pattern to all remaining task tools. For each tool, find the `if/else` pattern and remove the fallback branch:

**TaskListTool** - Look for the `if (this.getTaskManager)` block around line 140-150, remove the `else` block
**TaskCompleteTool** - Look for the `if (this.getTaskManager)` block around line 265-275, remove the `else` block  
**TaskUpdateTool** - Look for the `if (this.getTaskManager)` block around line 350-360, remove the `else` block
**TaskAddNoteTool** - Look for the `if (this.getTaskManager)` block around line 440-450, remove the `else` block
**TaskViewTool** - Look for the `if (this.getTaskManager)` block around line 495-505, remove the `else` block

**Pattern for each tool**:
1. Add `if (!this.getTaskManager)` check with appropriate error message
2. Remove entire `else` branch that uses `getPersistence()` 
3. Update any comments referencing "fallback"
4. Test the tool individually after each change

**Note**: Line numbers are approximate since they will shift as changes are made. Use the `if (this.getTaskManager)` pattern to locate the correct sections.

#### 1.4 Remove Unused Imports
After removing fallback code, you may be able to remove:
```typescript
import { getPersistence } from '~/persistence/database';
```

Only remove if no longer used anywhere in the file.

#### 1.5 Test Integration
**File**: `src/tools/implementations/task-manager/integration.test.ts` (create)

Test that tools work correctly with real session TaskManager:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

describe('Task Tools Integration', () => {
  beforeEach(() => {
    setupTestPersistence();
  });

  afterEach(() => {
    teardownTestPersistence();
  });

  it('should create and complete tasks through session TaskManager', async () => {
    // Create test project
    const project = Project.create(
      'Test Project',
      '/tmp/test'
    );

    // Create session 
    const session = Session.create({
      name: 'Test Session',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      projectId: project.getId(),
    });

    const agent = session.getAgent(session.getId());
    expect(agent).toBeTruthy();

    // Test task creation through agent's tool executor
    const toolExecutor = agent!.toolExecutor;
    
    const createResult = await toolExecutor.executeTool({
      id: 'test-call-1',
      name: 'task_add',
      arguments: {
        title: 'Test Integration Task',
        prompt: 'Test that task creation works end-to-end',
        priority: 'medium'
      }
    }, { threadId: session.getId() });

    expect(createResult.isError).toBe(false);
    expect(createResult.content[0].text).toContain('Created task');
    
    // Extract task ID from result and complete it
    const taskId = extractTaskId(createResult.content[0].text);
    
    const completeResult = await toolExecutor.executeTool({
      id: 'test-call-2', 
      name: 'task_complete',
      arguments: {
        id: taskId,
        message: 'Integration test completed successfully'
      }
    }, { threadId: session.getId() });

    expect(completeResult.isError).toBe(false);
  });
});

function extractTaskId(message: string): string {
  const match = message.match(/Created task (task_\w+):/);
  if (!match) throw new Error('Could not extract task ID from: ' + message);
  return match[1];
}
```

**Commit Point**: `git add . && git commit -m "feat: remove task tool fallback code bypassing session architecture"`

## Task 2: Add Bulk Task Creation

**Objective**: Allow creating multiple tasks in a single `task_add` call for efficient work breakdown.

### Files to Modify
- `src/tools/implementations/task-manager/tools.ts` 
- Add tests for bulk creation

### Implementation Steps

#### 2.1 Write Failing Tests for Bulk Creation
**File**: `src/tools/implementations/task-manager/bulk-tasks.test.ts` (create)

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskCreateTool } from './tools';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { asThreadId } from '~/threads/types';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

describe('Bulk Task Creation', () => {
  let tool: TaskCreateTool;
  let session: Session;
  let project: Project;

  beforeEach(() => {
    setupTestPersistence();
    
    // Create session with TaskManager like real usage
    project = Project.create(
      'Test Project',
      '/tmp/test-bulk-tasks'
    );

    session = Session.create({
      name: 'Bulk Test Session',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      projectId: project.getId(),
    });

    // Get tool with proper TaskManager injection
    tool = new TaskCreateTool();
    const taskManager = session.getTaskManager();
    (tool as any).getTaskManager = () => taskManager;
  });

  afterEach(() => {
    teardownTestPersistence();
  });

  it('should create multiple tasks from tasks array', async () => {
    const result = await tool.execute({
      tasks: [
        {
          title: 'Task 1',
          prompt: 'First task prompt',
          priority: 'high' as const
        },
        {
          title: 'Task 2', 
          prompt: 'Second task prompt',
          priority: 'medium' as const
        },
        {
          title: 'Task 3',
          prompt: 'Third task prompt', 
          priority: 'low' as const
        }
      ]
    }, { threadId: session.getId() });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('Created 3 tasks');
    expect(result.content[0].text).toContain('Task 1');
    expect(result.content[0].text).toContain('Task 2'); 
    expect(result.content[0].text).toContain('Task 3');
  });

  it('should validate minimum 1 task in array', async () => {
    const result = await tool.execute({
      tasks: []
    }, { threadId: session.getId() });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('at least 1');
  });

  it('should validate maximum 20 tasks in array', async () => {
    const tasks = Array.from({ length: 21 }, (_, i) => ({
      title: `Task ${i + 1}`,
      prompt: `Prompt ${i + 1}`,
      priority: 'medium' as const
    }));

    const result = await tool.execute({
      tasks
    }, { threadId: session.getId() });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('maximum');
  });

  it('should handle single task object (backward compatibility)', async () => {
    const result = await tool.execute({
      title: 'Single Task',
      prompt: 'Single task prompt',
      priority: 'medium' as const
    }, { threadId: session.getId() });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('Created task');
    expect(result.content[0].text).toContain('Single Task');
  });
});
```

**Test Command**: `npm test -- src/tools/implementations/task-manager/bulk-tasks.test.ts`  
**Expected**: Tests should fail since bulk creation not implemented yet.

#### 2.2 Update Schema for Union Type
**File**: `src/tools/implementations/task-manager/tools.ts`

**Step 1**: Find the existing `createTaskSchema` (around line 19-26) and replace it with:

```typescript
// Single task schema - extracted for reuse
const singleTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  prompt: z.string().min(1),
  priority: z.enum(['high', 'medium', 'low'] as const).default('medium'),
  assignedTo: z.string().optional().describe('Thread ID or "new:provider/model"'),
});

// Bulk tasks schema  
const bulkTasksSchema = z.object({
  tasks: z.array(singleTaskSchema).min(1, 'Must provide at least 1 task').max(20, 'Cannot create more than 20 tasks at once'),
});

// Union schema supporting both formats
const createTaskSchema = z.union([
  singleTaskSchema,
  bulkTasksSchema
]);
```

**Step 2**: Update the TaskCreateTool class schema property:
```typescript
export class TaskCreateTool extends Tool {
  name = 'task_add';
  description = '...'; // Will be updated in step 2.3
  schema = createTaskSchema; // Now supports both single and bulk
  // ... rest of class
}
```

**Test**: Run the existing tests to ensure schema validation still works for single tasks:
```bash
npm test -- --testNamePattern="TaskCreateTool"
```

#### 2.3 Update Tool Description
Update `TaskCreateTool.description`:

```typescript
description = `Create tasks to track work - your primary planning tool.

TASK SIZING STRATEGY:
- Each task = one logical commit (atomic, testable change)
- Break down until you can clearly see the implementation path
- If you can't describe specific acceptance criteria, break it down further
- Include enough context for independent work (files, approach, constraints)

WHEN TO BREAK DOWN FURTHER:
- Success criteria contain "and" statements (probably multiple commits)
- You're unsure of the technical approach (create investigation task first)
- Multiple files/systems need coordinating changes
- Task feels overwhelming or vague

WHEN TO ASK FOR HELP:
- Requirements/context unclear (can't write good acceptance criteria)
- Uncertain about technical approach (need validation before proceeding)
- Tried approach isn't working and no clear alternative visible
- Discovered scope is different than initially understood
- Need information/access/decisions you can't get yourself

COMMUNICATION PATTERNS:
- Creating task = claiming responsibility to track it to completion
- Task exists = others will ask "what's the status?"
- Good tasks enable clear progress tracking and independent work
- Poor tasks create confusion, scope creep, and rework

EXAMPLES:
Single atomic task: task_add({
  title: "Add failing test for bulk task creation", 
  prompt: "Create test in bulk-tasks.test.ts that expects task_add to accept {tasks: []} format. Test should fail initially. Files: src/tools/implementations/task-manager/bulk-tasks.test.ts",
  priority: "high"
})

Investigation task: task_add({
  title: "Investigate auth timeout root cause",
  prompt: "Users report 5min logout instead of 30min. Debug token expiration, session storage, renewal logic. Output: specific root cause + recommended fix approach. Context: blocking beta release",
  priority: "high"
})

Bulk planning: task_add({ tasks: [
  {title: "Write failing test for union schema", prompt: "Test that createTaskSchema accepts both single task and {tasks: array} formats"},
  {title: "Update schema to union type", prompt: "Change createTaskSchema to z.union([singleTaskSchema, bulkTasksSchema])"},  
  {title: "Implement bulk creation logic", prompt: "Handle both formats in executeValidated, validate all before creating any"},
  {title: "Update tool description", prompt: "Add bulk examples and task sizing guidance to description"}
]})`;
```

#### 2.4 Implement Bulk Creation Logic
Update `TaskCreateTool.executeValidated()` method:

```typescript
protected async executeValidated(
  args: z.infer<typeof createTaskSchema>,
  context?: ToolContext
): Promise<ToolResult> {
  if (!context?.threadId) {
    return this.createError('No thread context available');
  }

  if (!this.getTaskManager) {
    return this.createError('TaskManager is required for task creation');
  }

  try {
    const taskManager = this.getTaskManager();
    const taskContext = {
      actor: context.threadId,
      isHuman: false,
    };

    // Determine if single task or bulk tasks
    const tasksToCreate = 'tasks' in args ? args.tasks : [args];
    
    // Validate all assignees before creating any tasks
    for (const taskData of tasksToCreate) {
      if (taskData.assignedTo && !isAssigneeId(taskData.assignedTo)) {
        return this.createError(`Invalid assignee format: ${taskData.assignedTo}`);
      }
    }

    // Create all tasks atomically (all succeed or all fail)
    const createdTasks = [];
    try {
      for (const taskData of tasksToCreate) {
        const task = await taskManager.createTask(
          {
            title: taskData.title,
            description: taskData.description,
            prompt: taskData.prompt,
            priority: taskData.priority,
            assignedTo: taskData.assignedTo,
          },
          taskContext
        );
        createdTasks.push(task);
      }
    } catch (error) {
      // If any task creation fails, we don't need explicit rollback
      // since TaskManager.createTask is atomic per task
      // and we haven't committed any partial state
      throw new Error(`Failed to create task ${createdTasks.length + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Format response
    if (createdTasks.length === 1) {
      const task = createdTasks[0];
      let message = `Created task ${task.id}: ${task.title}`;
      if (task.assignedTo) {
        message += ` (assigned to ${task.assignedTo})`;
      }
      return this.createResult(message);
    } else {
      const taskSummaries = createdTasks.map(task => {
        let summary = `${task.id}: ${task.title}`;
        if (task.assignedTo) summary += ` → ${task.assignedTo}`;
        return summary;
      });
      
      return this.createResult(
        `Created ${createdTasks.length} tasks:\n${taskSummaries.join('\n')}`
      );
    }
  } catch (error) {
    return this.createError(
      `Failed to create task(s): ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
```

**Test Command**: `npm test -- src/tools/implementations/task-manager/bulk-tasks.test.ts`  
**Expected**: Tests should now pass.

**Commit Point**: `git add . && git commit -m "feat: add bulk task creation to task_add tool"`

## Task 3: Update Model References

**Objective**: Update outdated model names to latest versions (Sonnet 4, Haiku 3.5).

### Files to Modify
- `src/tools/implementations/delegate.ts`
- Documentation and examples mentioning models

### Implementation Steps

#### 3.1 Update Delegate Tool Default Model
**File**: `src/tools/implementations/delegate.ts`

Update line 32 (the default model):
```typescript
// OLD
model: ModelFormat.default('anthropic:claude-3-5-haiku-latest').describe(

// NEW  
model: ModelFormat.default('anthropic:claude-3-5-haiku-20241022').describe(
```

Update line 20 (the example):
```typescript
// OLD
'Invalid model format. Use "provider:model" (e.g., "anthropic:claude-3-5-haiku-latest")',

// NEW
'Invalid model format. Use "provider:model" (e.g., "anthropic:claude-3-5-haiku-20241022")',
```

#### 3.2 Update Delegate Tool Examples
Update the description examples to use correct models:

```typescript
description = `Delegate a specific task to a subagent using a more cost-effective model.
Ideal for research, data extraction, log analysis, or any focused task with clear outputs.
The subagent starts fresh with only your instructions - no conversation history.

Examples:
- title: "Analyze test failures", prompt: "Review the test output and identify the root cause of failures", expected_response: "List of failing tests with specific error reasons", model: "anthropic:claude-3-5-haiku-20241022"
- title: "Search authentication logs", prompt: "grep through the application logs for authentication errors in the last hour", expected_response: "Timestamps and error messages for each auth failure", model: "anthropic:claude-3-5-haiku-20241022"  
- title: "Complex code review", prompt: "Review this PR for architecture issues and suggest improvements", expected_response: "Detailed analysis with specific recommendations", model: "anthropic:claude-sonnet-4-20250514"`;
```

#### 3.3 Update Tests Using Old Models
**Files**: Search for and update any test files mentioning old models

```bash
# Search for old model patterns that need updating
grep -r "claude-3-5-haiku-latest" src/
grep -r "claude-.*-latest" src/
grep -r "anthropic:claude-3-5-sonnet-" src/

# Verify no old patterns remain after updates
grep -r "haiku-latest" src/ && echo "Found old haiku references to fix"
grep -r "sonnet-latest" src/ && echo "Found old sonnet references to fix"
```

Update any test files to use:
- `claude-3-5-haiku-20241022` for simple tasks
- `claude-sonnet-4-20250514` for complex tasks

#### 3.4 Test Model References
**File**: `src/tools/implementations/delegate.test.ts`

Verify existing tests still pass with new default model. Add test for model validation:

```typescript
it('should accept valid model formats', async () => {
  // Test various valid model formats
  const validModels = [
    'anthropic:claude-3-5-haiku-20241022',
    'anthropic:claude-sonnet-4-20250514', 
    'openai:gpt-4'
  ];

  for (const model of validModels) {
    const result = await tool.execute({
      title: 'Test Task',
      prompt: 'Test prompt', 
      expected_response: 'Test response',
      model
    });
    
    // Should not fail on model validation
    expect(result.isError).toBe(false);
  }
});
```

**Commit Point**: `git add . && git commit -m "feat: update delegate tool to use latest model versions"`

## Task 4: Improve Tool Descriptions

**Objective**: Enhance tool descriptions with workflow guidance and best practices.

### Files to Modify
- `src/tools/implementations/task-manager/tools.ts` (all tool descriptions)
- `src/config/prompts/sections/tools.md`

### Implementation Steps

#### 4.1 Update Task Tool Descriptions
**File**: `src/tools/implementations/task-manager/tools.ts`

Update each tool's description property:

**TaskCreateTool** (updated with better guidance in Task 2 - reference that implementation)

**TaskListTool**:
```typescript
description = `List tasks filtered by assignment, creation, or thread context.

Filters:
- 'thread' (default): All tasks in current conversation
- 'mine': Tasks assigned to me  
- 'created': Tasks I created
- 'all': All tasks I can see (assigned to me or in my thread)

Options:
- includeCompleted: false (default) | true to show completed tasks

Use regularly to:
- Check your current workload before starting new tasks
- See what tasks are assigned to subagents
- Track overall progress on complex requests

Example: task_list({ filter: "mine", includeCompleted: false })`;
```

**TaskCompleteTool**:
```typescript
description = `Mark a task as completed with your results or findings.

Required:
- id: Task ID to complete
- message: Description of what was accomplished, findings, or results

The message becomes part of the permanent task record and helps others understand what was done.

Always include:
- What you accomplished or discovered
- Key results or outputs
- Any issues encountered  
- Next steps if applicable

Example: task_complete({ id: "task_123", message: "Fixed authentication bug in auth.js line 45. Token validation was checking wrong expiration field. All tests now pass. Updated documentation." })`;
```

**TaskUpdateTool**:
```typescript
description = `Update task properties like status, assignment, priority, or content.

Use for:
- Marking tasks in progress: task_update({ taskId: "task_123", status: "in_progress" })
- Changing priority: task_update({ taskId: "task_123", priority: "high" })
- Reassigning work: task_update({ taskId: "task_123", assignTo: "new:anthropic/claude-3-5-haiku-20241022" })
- Updating requirements: task_update({ taskId: "task_123", prompt: "Updated requirements..." })

Status options: pending, in_progress, completed, blocked
Priority options: high, medium, low

Example: task_update({ taskId: "task_123", status: "blocked", prompt: "Blocked on API access - need credentials" })`;
```

**TaskAddNoteTool**:
```typescript
description = `Add a note to a task for communication between agents or progress updates.

COMMUNICATION STRATEGY:
- Each note = specific progress update or finding (not just "working on it")
- Include what you discovered, decided, or need
- Help others understand current state without reading your mind
- Good notes enable handoffs and collaboration

WHEN TO ADD NOTES:
- Found something significant (root cause, key insight, blocker)
- Made a technical decision that affects the approach
- Need input/clarification on requirements or constraints
- Completed a meaningful subtask within larger work
- Hit a blocker and need specific help

EFFECTIVE NOTE PATTERNS:
- Status: "Implemented user validation. Next: password hashing middleware"
- Finding: "Root cause: database connection timeout after 30s. Need to tune connection pool"
- Decision: "Using JWT over sessions for better API scalability. Refs: RFC 7519"
- Blocker: "Need staging database credentials to test migration. Who can provide?"
- Question: "Should user deletion be soft delete or hard delete? Affects audit requirements"

EXAMPLES:
- Progress: task_add_note({ taskId: "task_123", note: "Auth endpoints implemented and tested. Working on middleware integration. ETA: 2 hours" })
- Technical finding: task_add_note({ taskId: "task_123", note: "Performance issue found: N+1 query in user.getPermissions(). Switching to eager loading. 40ms -> 4ms improvement" })
- Blocker: task_add_note({ taskId: "task_123", note: "Blocked: staging API returns 403 for all requests. Need to verify API key configuration. @jesse can you check?" })

Notes become part of permanent task history - write for future readers.`;
```

**TaskViewTool**:
```typescript
description = `View detailed information about a specific task including notes and history.

Shows:
- Task metadata (title, status, priority, assignments)  
- Full prompt and description
- All notes and communications
- Creation and update timestamps

Use for:
- Understanding task requirements before starting work
- Reviewing progress and decisions made
- Getting context on tasks assigned to you
- Checking task status and notes

Example: task_view({ taskId: "task_123" })`;
```

#### 4.2 Update tools.md Section
**File**: `src/config/prompts/sections/tools.md`

**Step 1**: Locate the "Workflow Tools (MANDATORY USE)" section (around lines 34-41) and replace it with the new content below.

**Step 2**: The existing content to replace looks like:
```markdown
### Workflow Tools (MANDATORY USE)

- **task_add**: Add tasks to track progress - YOU MUST use this to track all work
- **task_list**: View current tasks regularly
- **task_complete**: Mark tasks as done when finished

**Critical**: You MUST use task tools to track what you're doing. NEVER discard tasks without explicit approval.
```

**Step 3**: Replace with this expanded guidance:

```markdown
### Task Management (MANDATORY USE)

You MUST use task tools to track all work. Follow this workflow:

#### Planning Phase  
- **task_add**: Break complex requests into specific, actionable tasks
  - Use bulk creation for efficient planning: `task_add({ tasks: [...] })`
  - Set clear priorities based on user needs and dependencies
  - Include detailed prompts with acceptance criteria
  - Use assignedTo for delegation: `"new:provider:model"`

#### Execution Phase
- **task_list**: Check current tasks before starting new work  
- **task_update**: Mark tasks in-progress when you begin work
- **task_add**: Create new tasks as you discover additional work
- **task_add_note**: Provide progress updates and communicate findings
- **delegate**: Assign focused, well-scoped tasks to subagents

#### Completion Phase
- **task_complete**: Always include results, findings, or outputs
- **task_add**: Create follow-up tasks based on your findings

#### Delegation Best Practices

**delegate** is for creating focused, independent work assignments with complete context. Think of it like writing an implementation plan for a colleague who knows nothing about your project.

DELEGATION STRATEGY:
- Each delegation = complete work package (problem + context + constraints + expected output)
- Include enough background for independent execution
- Specify exact success criteria and output format
- Choose appropriate model based on complexity

WHEN TO DELEGATE:
- Task can be completed independently with clear instructions
- Specialized expertise needed (analysis, research, data extraction)
- Work can be parallelized while you focus on other tasks
- Clear, measurable output expected (not exploratory/creative work)

DELEGATION CHECKLIST:
Before delegating, ensure you can answer:
- What exactly needs to be done? (specific, actionable task)
- What context/background does the agent need? (files, requirements, constraints)
- What does success look like? (specific deliverable format)
- What model complexity is needed? (simple extraction vs complex analysis)

MODEL SELECTION GUIDE:
- `claude-3-5-haiku-20241022`: Data extraction, log analysis, simple code changes, straightforward research
- `claude-sonnet-4-20250514`: Complex analysis, architecture decisions, detailed code reviews, multi-step reasoning

EFFECTIVE DELEGATION PATTERNS:
- Analysis: "Review error logs from last 24 hours. Context: users report slow logins. Output: list of specific error patterns with frequency counts and proposed fixes"
- Research: "Find React testing libraries that support component snapshots. Context: migrating from Jest to Vitest. Output: comparison table with pros/cons and migration effort estimates"
- Implementation: "Add input validation to user registration form. Context: currently accepts any input, need email/password validation. Files: src/forms/register.js. Output: working validation with error messages"

BAD DELEGATION (too vague):
❌ delegate({ title: "Fix the auth issue", prompt: "Something's wrong with login", expected_response: "Fix it" })

GOOD DELEGATION (complete context):
✅ delegate({ 
  title: "Debug authentication timeout errors", 
  prompt: "Users report getting logged out after 5 minutes instead of expected 30 minutes. Check token expiration logic in src/auth/jwt.js and session management in src/middleware/auth.js. Look for hardcoded timeouts or misconfigured constants. Context: this started after yesterday's deployment of commit abc123.",
  expected_response: "Root cause analysis with specific code locations and recommended fix. Include before/after configuration values.",
  model: "anthropic:claude-sonnet-4-20250514"
})

#### Integration Pattern
```
User Request → task_add (break down) → delegate (parallel work) → task_complete (with results)
```

**Critical Rules:**
- Never abandon tasks without completing them
- If blocked, use task_update with blocker details and ask for guidance  
- Use task_list regularly to stay aware of your workload
- Include meaningful results in task_complete messages
```

#### 4.3 Test Description Clarity
**File**: `src/tools/implementations/task-manager/description.test.ts` (create)

Write tests that verify tool descriptions contain key information:

```typescript
import { describe, it, expect } from 'vitest';
import { TaskCreateTool, TaskListTool, TaskCompleteTool, TaskUpdateTool, TaskAddNoteTool, TaskViewTool } from './tools';

describe('Tool Descriptions', () => {
  it('should include usage examples in descriptions', () => {
    const tools = [
      new TaskCreateTool(),
      new TaskListTool(), 
      new TaskCompleteTool(),
      new TaskUpdateTool(),
      new TaskAddNoteTool(),
      new TaskViewTool()
    ];

    for (const tool of tools) {
      expect(tool.description).toContain('Example');
      expect(tool.description.length).toBeGreaterThan(100); // Substantial description
      expect(tool.description).not.toContain('TODO'); // No placeholder text
    }
  });

  it('should explain when to use each tool', () => {
    const taskCreateTool = new TaskCreateTool();
    expect(taskCreateTool.description).toContain('Use for:');
    
    const taskCompleteTool = new TaskCompleteTool();
    expect(taskCompleteTool.description).toContain('Always include:');
  });

  it('delegate tool should reference latest models', () => {
    const delegateTool = new (require('~/tools/implementations/delegate').DelegateTool)();
    expect(delegateTool.description).toContain('claude-3-5-haiku-20241022');
    expect(delegateTool.description).toContain('claude-sonnet-4-20250514');
    expect(delegateTool.description).not.toContain('claude-3-5-haiku-latest');
  });
});
```

**Commit Point**: `git add . && git commit -m "docs: improve task and delegation tool descriptions with workflow guidance"`

## Task 5: Integration Testing

**Objective**: Comprehensive end-to-end testing of the improved task management system.

### Files to Create
- `src/tools/implementations/task-manager/workflow.integration.test.ts`

### Implementation Steps

#### 5.1 Write Complete Workflow Tests
**File**: `src/tools/implementations/task-manager/workflow.integration.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

describe('Task Management Workflow Integration', () => {
  let session: Session;
  let project: Project;

  beforeEach(() => {
    setupTestPersistence();
    
    project = Project.create(
      'Test Project',
      '/tmp/test-project'
    );

    session = Session.create({
      name: 'Test Session',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      projectId: project.getId(),
    });
  });

  afterEach(() => {
    teardownTestPersistence();
  });

  it('should support complete task workflow: create → update → note → complete', async () => {
    const agent = session.getAgent(session.getId())!;
    const toolExecutor = agent.toolExecutor;

    // 1. Create a task
    const createResult = await toolExecutor.executeTool({
      id: 'call-1',
      name: 'task_add',
      arguments: {
        title: 'Implement user authentication',
        prompt: 'Add JWT-based authentication to the API endpoints',
        priority: 'high',
        description: 'Security requirement for v1.0 release'
      }
    }, { threadId: session.getId() });

    expect(createResult.isError).toBe(false);
    const taskId = extractTaskId(createResult.content[0].text);

    // 2. Mark task as in progress
    const updateResult = await toolExecutor.executeTool({
      id: 'call-2',
      name: 'task_update',
      arguments: {
        taskId,
        status: 'in_progress'
      }
    }, { threadId: session.getId() });

    expect(updateResult.isError).toBe(false);

    // 3. Add progress note
    const noteResult = await toolExecutor.executeTool({
      id: 'call-3',
      name: 'task_add_note',
      arguments: {
        taskId,
        note: 'Implemented JWT token generation. Working on middleware validation.'
      }
    }, { threadId: session.getId() });

    expect(noteResult.isError).toBe(false);

    // 4. View task details
    const viewResult = await toolExecutor.executeTool({
      id: 'call-4',
      name: 'task_view',
      arguments: { taskId }
    }, { threadId: session.getId() });

    expect(viewResult.isError).toBe(false);
    expect(viewResult.content[0].text).toContain('Implement user authentication');
    expect(viewResult.content[0].text).toContain('in_progress');
    expect(viewResult.content[0].text).toContain('JWT token generation');

    // 5. Complete task
    const completeResult = await toolExecutor.executeTool({
      id: 'call-5',
      name: 'task_complete',
      arguments: {
        id: taskId,
        message: 'Authentication system complete. Added JWT middleware, login/logout endpoints, and password hashing. All tests pass.'
      }
    }, { threadId: session.getId() });

    expect(completeResult.isError).toBe(false);

    // 6. Verify task appears in completed list
    const listResult = await toolExecutor.executeTool({
      id: 'call-6',
      name: 'task_list',
      arguments: {
        filter: 'thread',
        includeCompleted: true
      }
    }, { threadId: session.getId() });

    expect(listResult.isError).toBe(false);
    expect(listResult.content[0].text).toContain('✓'); // Completed indicator
    expect(listResult.content[0].text).toContain('Implement user authentication');
  });

  it('should support bulk task creation and assignment', async () => {
    const agent = session.getAgent(session.getId())!;
    const toolExecutor = agent.toolExecutor;

    // Create multiple related tasks
    const bulkResult = await toolExecutor.executeTool({
      id: 'call-1',
      name: 'task_add',
      arguments: {
        tasks: [
          {
            title: 'Design API schema',
            prompt: 'Define OpenAPI specification for user management endpoints',
            priority: 'high'
          },
          {
            title: 'Implement user model',  
            prompt: 'Create User entity with validation and database mapping',
            priority: 'medium'
          },
          {
            title: 'Add authentication middleware',
            prompt: 'JWT validation middleware for protected routes',
            priority: 'high'
          },
          {
            title: 'Write integration tests',
            prompt: 'End-to-end tests for authentication flow',
            priority: 'medium',
            assignedTo: 'new:anthropic/claude-3-5-haiku-20241022'
          }
        ]
      }
    }, { threadId: session.getId() });

    expect(bulkResult.isError).toBe(false);
    expect(bulkResult.content[0].text).toContain('Created 4 tasks');
    expect(bulkResult.content[0].text).toContain('Design API schema');
    expect(bulkResult.content[0].text).toContain('Write integration tests');
    expect(bulkResult.content[0].text).toContain('new:anthropic/claude-3-5-haiku-20241022');

    // Verify all tasks appear in list
    const listResult = await toolExecutor.executeTool({
      id: 'call-2',
      name: 'task_list',
      arguments: { filter: 'thread' }
    }, { threadId: session.getId() });

    expect(listResult.isError).toBe(false);
    expect(listResult.content[0].text).toContain('4 found');
  });

  it('should maintain task relationships and context', async () => {
    const agent = session.getAgent(session.getId())!;
    const toolExecutor = agent.toolExecutor;

    // Create parent task
    const parentResult = await toolExecutor.executeTool({
      id: 'call-1', 
      name: 'task_add',
      arguments: {
        title: 'Implement user management system',
        prompt: 'Complete user CRUD operations with authentication',
        priority: 'high'
      }
    }, { threadId: session.getId() });

    const parentTaskId = extractTaskId(parentResult.content[0].text);

    // Create related subtasks
    const subtaskResult = await toolExecutor.executeTool({
      id: 'call-2',
      name: 'task_add',
      arguments: {
        tasks: [
          {
            title: 'Create user registration endpoint',
            prompt: `Implement POST /users endpoint for user registration. Related to parent task ${parentTaskId}`,
            priority: 'high'
          },
          {
            title: 'Add user profile updates',
            prompt: `Implement PUT /users/:id endpoint. Part of ${parentTaskId} user management system`,
            priority: 'medium'
          }
        ]
      }
    }, { threadId: session.getId() });

    expect(subtaskResult.isError).toBe(false);

    // Verify all tasks show in thread context
    const listResult = await toolExecutor.executeTool({
      id: 'call-3',
      name: 'task_list', 
      arguments: { filter: 'thread' }
    }, { threadId: session.getId() });

    expect(listResult.isError).toBe(false);
    expect(listResult.content[0].text).toContain('3 found'); // Parent + 2 subtasks
  });
});

function extractTaskId(message: string): string {
  const match = message.match(/Created task (task_\w+):/);
  if (!match) {
    // Try multi-task format
    const multiMatch = message.match(/(task_\w+):/);
    if (!multiMatch) throw new Error('Could not extract task ID from: ' + message);
    return multiMatch[1];
  }
  return match[1];
}
```

#### 5.2 Run Full Test Suite
```bash
npm test -- src/tools/implementations/task-manager/
```

All tests should pass, including:
- Unit tests for individual tools
- Integration tests for session TaskManager usage  
- Workflow tests for complete task lifecycle
- Bulk creation tests
- Model reference validation

#### 5.3 Manual Testing Checklist

Test the following scenarios manually (or write additional automated tests):

1. **Create session and verify task tools work**:
   - Start Lace with test project
   - Create tasks using both single and bulk formats
   - Verify tasks appear in database and task_list

2. **Test delegation with task completion**:
   - Use delegate tool to assign task to subagent
   - Verify subagent completes task with result message
   - Check that result appears in task notes

3. **Test error handling**:
   - Try to use task tools without session (should fail gracefully)
   - Test invalid model formats in delegation
   - Test bulk creation with empty/oversized arrays

**Final Commit**: `git add . && git commit -m "test: add comprehensive integration tests for improved task management"`

## Validation & Cleanup

### Pre-Merge Checklist

- [ ] All tests pass: `npm test`
- [ ] Build succeeds: `npm run build`  
- [ ] No TypeScript errors: `npm run lint`
- [ ] No `any` types introduced (check with grep)
- [ ] No `getPersistence()` calls in task tools (check with grep)
- [ ] All model references use latest versions
- [ ] Task tool descriptions include examples and guidance
- [ ] Bulk task creation works for 1-20 tasks
- [ ] Integration tests cover complete workflows


### Documentation Updates

After implementation, consider updating:
- README.md with task management workflow examples
- API documentation for task tools
- User guide with delegation best practices

## Summary

This implementation plan removes architectural debt, improves usability, and enhances the task management experience. The key improvements are:

1. **Architectural**: Removed fallback code bypassing session TaskManager
2. **Usability**: Added bulk task creation for efficient planning  
3. **Accuracy**: Updated model references to latest versions
4. **Guidance**: Enhanced tool descriptions with workflows and examples

The result should be a more reliable, efficient, and user-friendly task management system that better supports complex multi-agent workflows.