// ABOUTME: E2E tests for todo tools (todo_add, todo_read, todo_update, todo_remove)
// ABOUTME: Tests verify todo.md persistence in session directory

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  /**
   * Helper to get the session directory from a sessionId.
   * The session dir is: <laceDir>/agent-sessions/<sessionId>
   */
  function getSessionDir(sessionId: string): string {
    return join(ctx.laceDir, 'agent-sessions', sessionId);
  }

  it('creates todo.md when agent uses todo_add', { timeout: 20_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    const updates: Array<Record<string, unknown>> = [];
    let todoAddCompleted = false;

    ctx.agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      updates.push(p);

      // Check for todo_add tool completion
      if (p.type === 'tool_use' && p.name === 'todo_add' && p.status === 'completed') {
        todoAddCompleted = true;
      }

      return undefined;
    });

    ctx.agent.peer.onRequest('session/request_permission', async () => ({ decision: 'allow' }));

    await withTimeout(
      ctx.agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'ask' } })
      ),
      2_000,
      'initialize'
    );

    const created = (await withTimeout(
      ctx.agent.peer.request('session/new', { workDir: ctx.workDir }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'add todo: Write unit tests for parser' }],
      }),
      10_000,
      'session/prompt'
    );

    // Wait for todo_add to complete
    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (todoAddCompleted) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      10_000,
      'todo_add completion'
    );

    // Verify todo.md was created in session directory
    const sessionDir = getSessionDir(created.sessionId);
    const todoPath = join(sessionDir, 'todo.md');

    expect(existsSync(todoPath)).toBe(true);

    const todoContent = readFileSync(todoPath, 'utf-8');
    expect(todoContent).toContain('Write unit tests for parser');
    expect(todoContent).toMatch(/\[ \]/); // Unchecked checkbox
    expect(todoContent).toMatch(/`t_\w{3}`/); // Has an ID like t_abc
  });

  it('reads existing todos with todo_read', { timeout: 20_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    const updates: Array<Record<string, unknown>> = [];
    let todoReadCompleted: Record<string, unknown> | undefined;

    ctx.agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      updates.push(p);

      if (p.type === 'tool_use' && p.name === 'todo_read' && p.status === 'completed') {
        todoReadCompleted = p;
      }

      return undefined;
    });

    ctx.agent.peer.onRequest('session/request_permission', async () => ({ decision: 'allow' }));

    await withTimeout(
      ctx.agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'ask' } })
      ),
      2_000,
      'initialize'
    );

    const created = (await withTimeout(
      ctx.agent.peer.request('session/new', { workDir: ctx.workDir }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    // Pre-populate todo.md with an existing task
    const sessionDir = getSessionDir(created.sessionId);
    mkdirSync(sessionDir, { recursive: true });
    const todoPath = join(sessionDir, 'todo.md');
    writeFileSync(
      todoPath,
      '- [ ] **Existing task from before** `t_xyz`\n',
      'utf-8'
    );

    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'read todos' }],
      }),
      10_000,
      'session/prompt'
    );

    // Wait for todo_read to complete
    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (todoReadCompleted) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      10_000,
      'todo_read completion'
    );

    // Verify the result contains the existing task
    const result = todoReadCompleted?.result as { outcome?: string; content?: Array<{ type: string; text?: string }> } | undefined;
    expect(result?.outcome).toBe('completed');

    const textContent = result?.content?.find((c) => c.type === 'text')?.text ?? '';
    expect(textContent).toContain('Existing task from before');
    expect(textContent).toContain('t_xyz');
  });

  it('marks tasks done with todo_update', { timeout: 20_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    const updates: Array<Record<string, unknown>> = [];
    let todoUpdateCompleted = false;

    ctx.agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      updates.push(p);

      if (p.type === 'tool_use' && p.name === 'todo_update' && p.status === 'completed') {
        todoUpdateCompleted = true;
      }

      return undefined;
    });

    ctx.agent.peer.onRequest('session/request_permission', async () => ({ decision: 'allow' }));

    await withTimeout(
      ctx.agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'ask' } })
      ),
      2_000,
      'initialize'
    );

    const created = (await withTimeout(
      ctx.agent.peer.request('session/new', { workDir: ctx.workDir }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    // Pre-populate todo.md with an incomplete task
    const sessionDir = getSessionDir(created.sessionId);
    mkdirSync(sessionDir, { recursive: true });
    const todoPath = join(sessionDir, 'todo.md');
    writeFileSync(
      todoPath,
      '- [ ] **Task to complete** `t_abc`\n',
      'utf-8'
    );

    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'mark done: t_abc' }],
      }),
      10_000,
      'session/prompt'
    );

    // Wait for todo_update to complete
    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (todoUpdateCompleted) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      10_000,
      'todo_update completion'
    );

    // Verify the todo.md now has [x] checkbox
    const todoContent = readFileSync(todoPath, 'utf-8');
    expect(todoContent).toContain('[x]'); // Checked checkbox
    expect(todoContent).toContain('Task to complete');
    expect(todoContent).toContain('t_abc');
  });
});
