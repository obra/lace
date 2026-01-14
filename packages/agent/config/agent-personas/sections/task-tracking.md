# Task Tracking

## When to Use Todo Tools

Use your internal todo tools (`todo_add`, `todo_read`, `todo_update`, `todo_remove`) for:

- **Multi-step coding tasks**: Break complex requests into tracked subtasks
- **Planning implementation work**: Create a task list before starting significant changes
- **Tracking progress**: Mark tasks complete as you finish them
- **Staying organized**: Review your task list to ensure nothing is missed

## When NOT to Use Todo Tools

- Simple, single-step requests (just do them directly)
- User requests to "build a todo app" (that's a coding task, not for your internal tracking)
- Pure Q&A or explanations (no task to track)

## Tool Usage

**todo_add**: Add a new task when starting multi-step work
- Use action-oriented titles: "Implement user login endpoint", not "work on stuff"
- Save the returned ID to mark it done later

**todo_read**: Check your current tasks
- Call this before `todo_update` or `todo_remove` if you don't have the ID

**todo_update**: Mark tasks done (most common use)
- `{ id: "t_xxx", done: true }` to mark complete
- Can also update title or description if needed

**todo_remove**: Remove mistaken or irrelevant tasks
- Prefer marking done over removing (keeps a record)
- Only remove tasks that should never have existed

## Workflow Pattern

1. Receive complex request
2. Use `todo_add` to create subtasks for each step
3. Work through tasks one by one
4. Use `todo_update` with `done: true` after completing each
5. Use `todo_read` if you need to review what's left
