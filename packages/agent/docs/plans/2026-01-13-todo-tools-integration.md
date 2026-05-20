# Todo Tools System Prompt & E2E Integration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

**Goal:** Complete the todo tools feature by adding system prompt instructions
and an E2E test to verify agent usage.

**Architecture:** The todo tools are already implemented (types, markdown
parsing, execution logic, tool stubs, runner integration). This plan adds the
final pieces: system prompt guidance telling the agent when/how to use todo
tools, and an E2E test verifying the full flow works with a real agent session.

**Tech Stack:** TypeScript, Vitest, Bun, JSON-RPC stdio protocol for E2E tests

---

## Background

The todo tools implementation is complete:

- `src/todo/types.ts` - TodoItem interface, generateTodoId()
- `src/todo/markdown.ts` - parseTodoMarkdown(), serializeTodoMarkdown()
- `src/todo/todo-tools.ts` - executeTodoRead/Add/Update/Remove()
- `src/tools/implementations/todo_*.ts` - Tool stubs with prompt-engineered
  descriptions
- Wired into `runner.ts` alongside job tools
- All 349 tests pass, including 10 Haiku prompt engineering tests

What remains:

1. System prompt integration - tell the agent to use todo tools for task
   tracking
2. E2E test - verify full agent → tool → storage → response flow

---

### Task 1: Add System Prompt Section for Todo Tools

**Files:**

- Create: `packages/agent/config/agent-personas/sections/task-tracking.md`
- Modify: `packages/agent/config/agent-personas/lace.md`

**Step 1: Create the task-tracking section template**

Create file `packages/agent/config/agent-personas/sections/task-tracking.md`:

```markdown
# Task Tracking

## When to Use Todo Tools

Use your internal todo tools (`todo_add`, `todo_read`, `todo_update`,
`todo_remove`) for:

- **Multi-step coding tasks**: Break complex requests into tracked subtasks
- **Planning implementation work**: Create a task list before starting
  significant changes
- **Tracking progress**: Mark tasks complete as you finish them
- **Staying organized**: Review your task list to ensure nothing is missed

## When NOT to Use Todo Tools

- Simple, single-step requests (just do them directly)
- User requests to "build a todo app" (that's a coding task, not for your
  internal tracking)
- Pure Q&A or explanations (no task to track)

## Tool Usage

**todo_add**: Add a new task when starting multi-step work

- Use action-oriented titles: "Implement user login endpoint", not "work on
  stuff"
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
```

**Step 2: Run tests to ensure no regressions**

Run: `npm test --run -- --grep "prompt" 2>/dev/null || npm test --run` Expected:
All tests pass (template changes shouldn't break tests)

**Step 3: Add include to main lace.md template**

In `packages/agent/config/agent-personas/lace.md`, add after the tools include:

```markdown
@sections/tools.md

@sections/task-tracking.md

@sections/workflows.md
```

**Step 4: Run tests again**

Run: `npm test --run` Expected: All tests pass

**Step 5: Commit**

```bash
git add packages/agent/config/agent-personas/sections/task-tracking.md packages/agent/config/agent-personas/lace.md
git commit -m "$(cat <<'EOF'
feat(agent): add task-tracking system prompt section

Instructs the agent when and how to use todo tools for
internal task tracking during multi-step coding tasks.
EOF
)"
```

---

### Task 2: Create E2E Test for Todo Tools

**Files:**

- Create: `packages/agent/src/__tests__/agent-process.todo.e2e.test.ts`

**Step 1: Write the failing E2E test**

Create file `packages/agent/src/__tests__/agent-process.todo.e2e.test.ts`:

```typescript
// ABOUTME: E2E tests for todo tools in actual agent sessions
// ABOUTME: Verifies todo_add, todo_read, todo_update work via stdio RPC

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  createE2EContext,
  spawnAgentProcess,
  withTimeout,
  defaultInitializeParams,
} from './helpers';

describe('lace-agent todo tools (E2E over stdio)', () => {
  const ctx = createE2EContext({ prefix: 'lace-agent-todo' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it(
    'creates a todo.md file when agent uses todo_add',
    { timeout: 20_000 },
    async () => {
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

      const toolUses: Array<Record<string, unknown>> = [];

      ctx.agent.peer.onRequest('session/update', async (params) => {
        const p = params as Record<string, unknown>;
        if (p.type === 'tool_use' && typeof p.name === 'string') {
          toolUses.push(p);
        }
        return undefined;
      });

      // No permission prompts needed - todo tools are safeInternal
      ctx.agent.peer.onRequest('session/request_permission', async () => ({
        decision: 'allow',
      }));

      await withTimeout(
        ctx.agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'ask' } })
        ),
        2_000,
        'initialize'
      );

      const sessionResult = (await withTimeout(
        ctx.agent.peer.request('session/new', { workDir: ctx.workDir }),
        2_000,
        'session/new'
      )) as { sessionDir: string };

      const sessionDir = sessionResult.sessionDir;

      // Prompt agent to add a task
      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [
            {
              type: 'text',
              text: 'Add a task to your todo list: "Write unit tests for parser"',
            },
          ],
        }),
        10_000,
        'session/prompt (add task)'
      );

      // Wait for todo_add tool to complete
      await withTimeout(
        new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            const todoAdd = toolUses.find(
              (u) => u.name === 'todo_add' && u.status === 'completed'
            );
            if (todoAdd) {
              clearInterval(interval);
              resolve();
            }
          }, 50);
        }),
        8_000,
        'todo_add completion'
      );

      // Verify todo.md was created in session directory
      const todoPath = path.join(sessionDir, 'todo.md');
      expect(fs.existsSync(todoPath)).toBe(true);

      const todoContent = fs.readFileSync(todoPath, 'utf-8');
      expect(todoContent).toContain('Write unit tests for parser');
      expect(todoContent).toContain('- [ ]'); // Unchecked checkbox
      expect(todoContent).toMatch(/`t_[a-z0-9]{3}`/); // Has an ID
    }
  );

  it('reads existing todos with todo_read', { timeout: 20_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    const toolUses: Array<Record<string, unknown>> = [];

    ctx.agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      if (p.type === 'tool_use' && typeof p.name === 'string') {
        toolUses.push(p);
      }
      return undefined;
    });

    ctx.agent.peer.onRequest('session/request_permission', async () => ({
      decision: 'allow',
    }));

    await withTimeout(
      ctx.agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'ask' } })
      ),
      2_000,
      'initialize'
    );

    const sessionResult = (await withTimeout(
      ctx.agent.peer.request('session/new', { workDir: ctx.workDir }),
      2_000,
      'session/new'
    )) as { sessionDir: string };

    const sessionDir = sessionResult.sessionDir;

    // Pre-populate todo.md with a task
    const todoPath = path.join(sessionDir, 'todo.md');
    fs.writeFileSync(
      todoPath,
      '- [ ] **Existing task** `t_abc`\n  This was already here.\n'
    );

    // Ask agent to read todos
    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [
          {
            type: 'text',
            text: 'What tasks are on your todo list? Use todo_read to check.',
          },
        ],
      }),
      10_000,
      'session/prompt (read)'
    );

    // Wait for todo_read to complete
    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          const todoRead = toolUses.find(
            (u) => u.name === 'todo_read' && u.status === 'completed'
          );
          if (todoRead) {
            clearInterval(interval);
            resolve();
          }
        }, 50);
      }),
      8_000,
      'todo_read completion'
    );

    // Verify todo_read was called and returned the existing task
    const todoReadCall = toolUses.find(
      (u) => u.name === 'todo_read' && u.status === 'completed'
    );
    expect(todoReadCall).toBeDefined();

    const result = todoReadCall?.result as
      | { content?: Array<{ text?: string }> }
      | undefined;
    const text = result?.content?.find((c) => c.text)?.text ?? '';
    expect(text).toContain('t_abc');
    expect(text).toContain('Existing task');
  });

  it('marks tasks done with todo_update', { timeout: 20_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    const toolUses: Array<Record<string, unknown>> = [];

    ctx.agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      if (p.type === 'tool_use' && typeof p.name === 'string') {
        toolUses.push(p);
      }
      return undefined;
    });

    ctx.agent.peer.onRequest('session/request_permission', async () => ({
      decision: 'allow',
    }));

    await withTimeout(
      ctx.agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'ask' } })
      ),
      2_000,
      'initialize'
    );

    const sessionResult = (await withTimeout(
      ctx.agent.peer.request('session/new', { workDir: ctx.workDir }),
      2_000,
      'session/new'
    )) as { sessionDir: string };

    const sessionDir = sessionResult.sessionDir;

    // Pre-populate with an incomplete task
    const todoPath = path.join(sessionDir, 'todo.md');
    fs.writeFileSync(todoPath, '- [ ] **Task to complete** `t_xyz`\n');

    // Ask agent to mark it done
    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [
          { type: 'text', text: 'Mark task t_xyz as done in your todo list.' },
        ],
      }),
      10_000,
      'session/prompt (update)'
    );

    // Wait for todo_update to complete
    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          const todoUpdate = toolUses.find(
            (u) => u.name === 'todo_update' && u.status === 'completed'
          );
          if (todoUpdate) {
            clearInterval(interval);
            resolve();
          }
        }, 50);
      }),
      8_000,
      'todo_update completion'
    );

    // Verify the task was marked done in the file
    const updatedContent = fs.readFileSync(todoPath, 'utf-8');
    expect(updatedContent).toContain('- [x]'); // Checked checkbox
    expect(updatedContent).toContain('Task to complete');
    expect(updatedContent).toContain('t_xyz');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test --run -- src/__tests__/agent-process.todo.e2e.test.ts` Expected:
Test should fail (either timeout waiting for tool use, or assertion failure)

**Step 3: Analyze failure and fix if needed**

The test may fail for several reasons:

- Agent doesn't use todo tools (system prompt not integrated yet)
- Session directory not exposed correctly in response

Check the test output and fix any issues.

**Step 4: Run tests to verify they pass**

Run: `npm test --run -- src/__tests__/agent-process.todo.e2e.test.ts` Expected:
All 3 tests pass

**Step 5: Run full test suite**

Run: `npm test --run` Expected: All tests pass (349+ including new E2E tests)

**Step 6: Commit**

```bash
git add packages/agent/src/__tests__/agent-process.todo.e2e.test.ts
git commit -m "$(cat <<'EOF'
test(agent): add E2E tests for todo tools

Tests verify:
- todo_add creates todo.md with task
- todo_read returns existing tasks
- todo_update marks tasks complete
EOF
)"
```

---

### Task 3: Verify No Permission Prompts for Todo Tools

**Files:**

- Review: `packages/agent/src/__tests__/agent-process.todo.e2e.test.ts`

**Step 1: Add explicit test for safeInternal behavior**

Add this test to the existing E2E test file:

```typescript
it(
  'does not prompt for permission when using todo tools',
  { timeout: 20_000 },
  async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    let permissionRequested = false;
    const toolUses: Array<Record<string, unknown>> = [];

    ctx.agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      if (p.type === 'tool_use' && typeof p.name === 'string') {
        toolUses.push(p);
      }
      return undefined;
    });

    ctx.agent.peer.onRequest('session/request_permission', async (params) => {
      const p = params as Record<string, unknown>;
      // Track if permission was requested for any todo tool
      if (typeof p.tool === 'string' && p.tool.startsWith('todo_')) {
        permissionRequested = true;
      }
      return { decision: 'allow' };
    });

    await withTimeout(
      ctx.agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'ask' } })
      ),
      2_000,
      'initialize'
    );

    await withTimeout(
      ctx.agent.peer.request('session/new', { workDir: ctx.workDir }),
      2_000,
      'session/new'
    );

    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [
          {
            type: 'text',
            text: 'Add a task: "Test safeInternal". Then read your tasks. Then mark it done.',
          },
        ],
      }),
      15_000,
      'session/prompt'
    );

    // Wait for at least one todo tool to complete
    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          const todoTool = toolUses.find(
            (u) =>
              typeof u.name === 'string' &&
              u.name.startsWith('todo_') &&
              u.status === 'completed'
          );
          if (todoTool) {
            clearInterval(interval);
            resolve();
          }
        }, 50);
      }),
      10_000,
      'todo tool completion'
    );

    // Verify no permission was requested for todo tools
    expect(permissionRequested).toBe(false);
  }
);
```

**Step 2: Run the test**

Run: `npm test --run -- src/__tests__/agent-process.todo.e2e.test.ts` Expected:
All 4 tests pass

**Step 3: Commit**

```bash
git add packages/agent/src/__tests__/agent-process.todo.e2e.test.ts
git commit -m "$(cat <<'EOF'
test(agent): verify todo tools don't require permission

Confirms safeInternal annotation works correctly in E2E context.
EOF
)"
```

---

### Task 4: Final Verification

**Step 1: Run full test suite**

Run: `npm test --run` Expected: All tests pass

**Step 2: Run linting**

Run: `npm run lint` Expected: No errors

**Step 3: Build**

Run: `npm run build` Expected: Build succeeds

**Step 4: Final commit (if any changes)**

```bash
git status
# If any uncommitted changes from fixes:
git add -A
git commit -m "chore: final cleanup for todo tools integration"
```

---

## Summary

After completing all tasks:

1. ✅ System prompt section `task-tracking.md` instructs agent on todo tool
   usage
2. ✅ E2E tests verify full agent → tool → storage flow
3. ✅ Tests confirm safeInternal bypasses permission prompts
4. ✅ All tests pass, lint clean, build succeeds

The todo tools feature is now complete and ready for use.
