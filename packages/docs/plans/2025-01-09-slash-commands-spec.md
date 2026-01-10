# Slash Commands Specification

Slash commands provide quick access to agent operations. They're invoked by
typing `/command` in the input.

## Two Types of Commands

1. **Built-in commands** - Core operations provided by the agent
2. **User commands** - Custom commands defined in `~/.lace/commands/`

## Schema

```typescript
interface SlashCommand {
  name: string; // Command name without the leading /
  description: string; // Shown in picker
  inputHint?: string; // Placeholder text for argument (e.g., "<file path>")
  source?: 'builtin' | 'user'; // Where command comes from
}
```

---

## Built-in Commands

### Context Management

| Command    | Description                     | Input Hint | Notes                            |
| ---------- | ------------------------------- | ---------- | -------------------------------- |
| `/compact` | Summarize and compress context  | -          | Triggers `ent/session/compact`   |
| `/clear`   | Clear conversation, start fresh | -          | Resets messages but keeps config |

### Mode Switching

| Command | Description          | Input Hint | Notes                        |
| ------- | -------------------- | ---------- | ---------------------------- |
| `/mode` | Switch approval mode | `<mode>`   | Shows current mode if no arg |

Modes control tool approval behavior:

- `ask` - Ask permission for each tool use (default)
- `approveReads` - Auto-approve read/search operations
- `approveEdits` - Auto-approve reads + file edits
- `approve` - Auto-approve everything (yolo mode)
- `deny` - Deny all tool use (read-only)

### Agent Control

| Command  | Description             | Input Hint  | Notes                        |
| -------- | ----------------------- | ----------- | ---------------------------- |
| `/abort` | Abort current operation | -           | Cancels running request      |
| `/help`  | Show available commands | `<command>` | Details for specific command |

---

## User Commands (`~/.lace/commands/`)

Users can define custom slash commands as markdown files with YAML frontmatter.

### Directory Structure

```
~/.lace/
└── commands/
    ├── review.md        # /review command
    ├── commit.md        # /commit command
    ├── test.md          # /test command
    └── project/         # Project-specific commands
        └── deploy.md    # /project/deploy or /deploy if unique
```

### Command File Format

```markdown
---
name: review
description: Review code changes
inputHint: <file or PR>
---

Review the following code changes. Focus on:

- Potential bugs or edge cases
- Code style and readability
- Performance implications
- Security concerns

If a file path is provided, review that file. If a PR number is provided, review
that PR. Otherwise, review staged git changes.
```

The markdown body becomes the prompt sent to the agent. User arguments (text
after the command) are appended to the prompt.

### Frontmatter Fields

| Field         | Required | Description                                     |
| ------------- | -------- | ----------------------------------------------- |
| `name`        | Yes      | Command name (without `/`)                      |
| `description` | Yes      | Shown in picker                                 |
| `inputHint`   | No       | Placeholder for arguments                       |
| `mode`        | No       | Force a specific approval mode for this command |

### Example Commands

**`~/.lace/commands/commit.md`**

```markdown
---
name: commit
description: Generate commit message for staged changes
---

Look at the staged git changes and generate an appropriate commit message.
Follow conventional commits format. Be concise.

Run `git diff --cached` to see what's staged.
```

**`~/.lace/commands/review.md`**

```markdown
---
name: review
description: Review code changes
inputHint: <file or PR>
---

Review the code changes. Focus on:

- Potential bugs or edge cases
- Code style and readability
- Performance implications
- Security concerns

If a file path is provided, review that file. If a PR number is provided, review
that PR. Otherwise, review staged git changes.
```

**`~/.lace/commands/yolo.md`**

```markdown
---
name: yolo
description: Execute without asking permission
mode: approve
---

Execute the following task without asking for permission on each tool use.
```

---

## Command Resolution

1. User types `/foo bar baz`
2. Agent looks up `foo`:
   - Check built-in commands first
   - Then check `~/.lace/commands/foo.md`
   - Then check `.lace/commands/foo.md` (project-local)
3. If found, execute with `bar baz` as arguments
4. If not found, pass through as regular prompt

---

## UI Behavior

1. **Picker**: Shows filtered commands as user types after `/`
2. **Tab**: Completes selected command
3. **Source indicator**: Show `(user)` badge for user-defined commands
4. **Input hint**: Shown as placeholder after command name
5. **Reload**: User commands are reloaded on each invocation (hot reload)

---

## Implementation Notes

### Agent Side

- Built-in commands handled directly by agent
- User commands: read markdown file, append user arguments, send as prompt
- `/mode` changes `approvalMode` in session config

### TUI Side

- Merge built-in and user commands for picker
- User commands discovered at startup + on directory focus
- Show source in picker (built-in vs user)
- Hot reload: re-read command files on each invocation
