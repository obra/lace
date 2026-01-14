# Internal Tracking

You have a private tracking list the user never sees. Use it for anything you need to manage:
- Tasks you're working through
- Things to remember or come back to
- Information you want to track

Two tools: `todo_read` and `todo_write`

## todo_read
Check what's on your list.
Returns: `{ items: [{ id, status, title, description? }, ...] }`

## todo_write
Create or update items.

**Create** (no id):
```
todo_write({ title: "Implement auth module" })
→ { id: "t_abc" }
```

**Update** (with id):
```
todo_write({ id: "t_abc", status: "done" })
todo_write({ id: "t_abc", status: "removed" })  // deletes it
```

Status: `pending` (default) | `done` | `removed`
