// ABOUTME: Pins kata #39 — tool_use and tool_result events from a subagent
// ABOUTME: turn must land in the per-job log file with unambiguous success vs
// ABOUTME: error vs cancellation markers, alongside the existing text-delta output.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logToolUpdateToJobLog } from '../job-log-formatter';
import type { ToolResult } from '@lace/ent-protocol';

function makeLogFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kata39-'));
  const path = join(dir, 'job_test.log');
  writeFileSync(path, '');
  return path;
}

describe('subagent job log captures tool_use + tool_result (kata #39)', () => {
  it('records successful tool_use + tool_result as two lines', () => {
    const path = makeLogFile();
    const seen = new Set<string>();

    logToolUpdateToJobLog(
      {
        toolCallId: 't1',
        name: 'file_read',
        input: { path: '/persona.md' },
        status: 'pending',
      },
      seen,
      path
    );

    const successResult: ToolResult = {
      outcome: 'completed',
      content: [{ type: 'text', text: 'hello world' }],
    };
    logToolUpdateToJobLog(
      {
        toolCallId: 't1',
        name: 'file_read',
        input: { path: '/persona.md' },
        status: 'completed',
        result: successResult,
      },
      seen,
      path
    );

    const contents = readFileSync(path, 'utf8');
    expect(contents).toMatch(/^\[tool: file_read/m);
    expect(contents).toMatch(/^\[tool_result: file_read/m);
    expect(contents).toContain('hello world');
    expect(contents).not.toMatch(/ERROR|CANCELLED|DENIED|TIMEOUT/);
  });

  it('records permission-cancelled tool calls as CANCELLED', () => {
    const path = makeLogFile();
    const seen = new Set<string>();

    logToolUpdateToJobLog(
      {
        toolCallId: 't2',
        name: 'file_edit',
        input: { path: '/persona.md', pattern: 'foo', replacement: 'bar' },
        status: 'awaiting_permission',
      },
      seen,
      path
    );

    const cancelled: ToolResult = {
      outcome: 'cancelled',
      content: [{ type: 'error', message: 'Cancelled' }],
    };
    logToolUpdateToJobLog(
      {
        toolCallId: 't2',
        name: 'file_edit',
        input: { path: '/persona.md', pattern: 'foo', replacement: 'bar' },
        status: 'cancelled',
        result: cancelled,
      },
      seen,
      path
    );

    const contents = readFileSync(path, 'utf8');
    expect(contents).toMatch(/^\[tool: file_edit/m);
    expect(contents).toContain('CANCELLED');
    expect(contents).not.toContain('[tool_result: file_edit → "Cancelled" (');
  });

  it('records tool errors as ERROR with the message', () => {
    const path = makeLogFile();
    const seen = new Set<string>();

    logToolUpdateToJobLog(
      {
        toolCallId: 't3',
        name: 'file_edit',
        input: { path: '/persona.md', pattern: '(Empty on first boot.)' },
        status: 'running',
      },
      seen,
      path
    );

    const failed: ToolResult = {
      outcome: 'failed',
      content: [
        {
          type: 'error',
          message: 'pattern not found in /persona.md',
        },
      ],
    };
    logToolUpdateToJobLog(
      {
        toolCallId: 't3',
        name: 'file_edit',
        input: { path: '/persona.md', pattern: '(Empty on first boot.)' },
        status: 'failed',
        result: failed,
      },
      seen,
      path
    );

    const contents = readFileSync(path, 'utf8');
    expect(contents).toContain('[tool: file_edit');
    expect(contents).toContain('ERROR');
    expect(contents).toContain('pattern not found');
  });

  it('does not duplicate the [tool: ...] announcement across status transitions', () => {
    const path = makeLogFile();
    const seen = new Set<string>();

    // pending → awaiting_permission → running — same toolCallId
    for (const status of ['pending', 'awaiting_permission', 'running'] as const) {
      logToolUpdateToJobLog(
        {
          toolCallId: 'tdupe',
          name: 'file_read',
          input: { path: '/x' },
          status,
        },
        seen,
        path
      );
    }

    const matches = readFileSync(path, 'utf8').match(/^\[tool: file_read/gm) ?? [];
    expect(matches.length).toBe(1);
  });
});
