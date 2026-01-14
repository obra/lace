# Lace Agent Todo List Tools - Specification

## Overview

Internal task management tools for the Lace agent to track its own work during sessions. These are NOT user-facing todo apps - they're for the agent's self-organization.

## Design Decisions

### Single List (Not Multiple)
- One todo list per session stored as `todo.md` in the session directory
- Punted on multiple named lists (e.g., "failed-approaches") - can add later if needed

### Unique IDs (Not Indices)
- Each item gets a stable ID like `t_a1b` (3 alphanumeric chars)
- IDs don't shift when items are removed (unlike array indices)
- Agent references items by ID for updates/removes

### Atomic Operations (Not Full Replacement)
- `todo_add` - add single item
- `todo_update` - update single item by ID
- `todo_remove` - remove single item by ID
- `todo_read` - read all items
- No full-list replacement needed - simpler for the agent

### Safe Internal Tools
- All four tools marked `safeInternal: true`
- No permission prompts - these are pure internal control flow
- Don't touch filesystem or external systems (beyond the todo.md file)

## Storage Format

Location: `<sessionDir>/todo.md`

```markdown
- [ ] **Task title here** `t_a1b`
  Optional description that can span
  multiple lines with details.

- [x] **Completed task** `t_c2d`
  This one is done.
```

- Checkbox: `[ ]` = incomplete, `[x]` = complete
- Title in bold: `**Title**`
- ID in backticks: `` `t_xxx` ``
- Description: 2-space indented lines after title

## API

### todo_read()
- Parameters: none
- Returns: `{ items: [{ id, done, title, description? }, ...] }`
- Purpose: Check current tasks, find IDs for updates

### todo_add(title, description?)
- Parameters:
  - `title`: string (required) - action-oriented, 3-10 words
  - `description`: string (optional) - details, acceptance criteria
- Returns: `{ id: "t_xxx" }`
- Purpose: Add new task when starting multi-step work

### todo_update(id, { done?, title?, description? })
- Parameters:
  - `id`: string (required) - the task's unique ID
  - `done`: boolean (optional) - true=complete, false=incomplete
  - `title`: string (optional) - replace title
  - `description`: string (optional) - replace description
- Returns: `{ updated: true }`
- Purpose: Mark tasks done, rarely update text

### todo_remove(id)
- Parameters:
  - `id`: string (required) - the task's unique ID
- Returns: `{ removed: true }`
- Purpose: Remove mistaken or irrelevant tasks (prefer marking done)

## Implementation Structure

```
packages/agent/src/
├── todo/
│   ├── types.ts              # TodoItem interface, generateTodoId()
│   ├── markdown.ts           # parseTodoMarkdown(), serializeTodoMarkdown()
│   ├── todo-tools.ts         # executeTodoRead/Add/Update/Remove()
│   └── __tests__/
│       ├── markdown.test.ts  # 14 unit tests for parsing/serialization
│       ├── todo-tools.test.ts # 15 unit tests for execution logic
│       └── haiku-tool-test.ts # 10 prompt engineering tests with Haiku 4.5
├── tools/implementations/
│   ├── todo_read.ts          # Tool stub (schema + description)
│   ├── todo_add.ts           # Tool stub
│   ├── todo_update.ts        # Tool stub
│   └── todo_remove.ts        # Tool stub
└── core/conversation/
    └── runner.ts             # Wired in alongside job tools
```

## Tool Descriptions (Prompt Engineered)

### todo_read
```
Read your current task list to see what work is pending or completed.

This is YOUR personal task list for tracking your own work during this session.
Use it to check progress, find task IDs for updates, or review what's left to do.

Returns JSON: { items: [{ id, done, title, description? }, ...] }

Example response:
{
  "items": [
    { "id": "t_a1b", "done": false, "title": "Implement auth module" },
    { "id": "t_c2d", "done": true, "title": "Write database schema" }
  ]
}
```

### todo_add
```
Add a task to YOUR internal task list for tracking YOUR work in this session.

IMPORTANT: This is for tracking work YOU are doing, not for building todo apps for users.
If the user asks you to "build a todo app" or "create a task manager", that's a coding
request - don't use this tool for that.

Use this when:
- Breaking down a multi-step coding task you're about to do
- Planning implementation work the user requested
- Tracking progress on complex changes

Parameters:
- title: Action-oriented task name, 3-10 words (e.g., "Implement user login endpoint")
- description: Optional details, acceptance criteria, or notes

Good titles: "Fix null pointer in parser", "Add validation to signup form"
Bad titles: "Work on stuff", "The thing we discussed", "TODO"

Returns JSON: { id: "t_xxx" } - Save this ID to mark the task done later.
```

### todo_update
```
Update a task in your list - most commonly to mark it done.

IMPORTANT: You must provide the task's ID (from todo_read or todo_add response).

Common usage - mark task complete:
  todo_update({ id: "t_a1b", done: true })

Parameters:
- id: The task's unique ID like "t_a1b" (required - get from todo_read)
- done: true = completed, false = incomplete (optional)
- title: Replace the title text (optional, rarely needed)
- description: Replace the description (optional, rarely needed)

Only fields you provide are changed; others stay the same.
```

### todo_remove
```
Remove a task from your list entirely.

Use sparingly - usually you should mark tasks done rather than removing them.
Remove when: task was added by mistake, task is no longer relevant, cleaning up.

Parameters:
- id: The task's unique ID like "t_a1b" (required - get from todo_read)

Note: Completed tasks can stay in the list as a record. Only remove if the task
should never have existed or is cluttering your list.
```

## Testing Results

### Unit Tests (29 total)
- `markdown.test.ts`: 14 tests - parsing/serialization round-trips
- `todo-tools.test.ts`: 15 tests - execution logic CRUD operations

### Prompt Engineering Tests (Haiku 4.5)
All 10/10 pass:
1. ✅ Uses todo_add when asked to plan a task
2. ✅ Uses todo_read when asked about current tasks
3. ✅ Uses todo_update with correct ID and done:true
4. ✅ Uses todo_remove with correct ID
5. ✅ Creates specific (not vague) task titles
6. ✅ Uses todo_read first when needing to find IDs
7. ✅ Does NOT use todo tools for unrelated questions
8. ✅ Uses todo_add for multi-step plans
9. ✅ Uses todo_update with done:false to mark incomplete
10. ✅ Prefers marking done over removing

## Integration Points

### Runner (runner.ts)
Tools are handled as special tools alongside job tools:
```typescript
if (toolName === 'todo_read' || toolName === 'todo_add' ||
    toolName === 'todo_update' || toolName === 'todo_remove') {
  const todoContext = { sessionDir: this.config.sessionDir };
  // dispatch to appropriate execute function
}
```

### Tool Executor (executor.ts)
Tools registered in `registerAllAvailableTools()`:
```typescript
new TodoReadTool(),
new TodoAddTool(),
new TodoUpdateTool(),
new TodoRemoveTool(),
```

### Permission System (rpc/utils.ts)
All todo tools have `safeInternal: true` annotation, which bypasses permission checks via `shouldAskPermission()`.

## Current Status

**IMPLEMENTED:**
- [x] Types and ID generation
- [x] Markdown parsing/serialization
- [x] All four tool stubs with prompt-engineered descriptions
- [x] Execution logic for all operations
- [x] Wired into runner
- [x] Registered in tool executor
- [x] Unit tests (29 passing)
- [x] Haiku prompt engineering tests (10 passing)
- [x] All 349 existing tests still pass

**NOT YET DONE:**
- [ ] E2E test with actual agent session
- [ ] Integration with system prompt (telling agent to use todo tools)
- [ ] UI display of todo list (if desired)
- [ ] Multiple named lists (punted)
