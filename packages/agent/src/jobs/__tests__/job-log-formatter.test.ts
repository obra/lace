// ABOUTME: Tests for job-log formatter — verifies tool_use updates produce
// ABOUTME: one-line job-log entries that distinguish success / error /
// ABOUTME: permission-cancel / denied / timeout (kata #39).

import { describe, it, expect } from 'vitest';
import { formatToolAnnouncement, formatToolResultLine } from '../job-log-formatter';
import type { ToolResult } from '@lace/ent-protocol';

describe('formatToolAnnouncement', () => {
  it('emits a single-line [tool: name(input)] entry ending with newline', () => {
    const line = formatToolAnnouncement('file_read', {
      path: '/workspace/persona.md',
    });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.replace(/\n$/, '')).toBe('[tool: file_read({"path":"/workspace/persona.md"})]');
  });

  it('truncates very long inputs so the line stays readable', () => {
    const big = 'x'.repeat(2000);
    const line = formatToolAnnouncement('bash', { command: big });
    expect(line.length).toBeLessThan(400);
    expect(line).toMatch(/^\[tool: bash\(/);
    expect(line).toMatch(/\.\.\.\)\]\n$/);
  });
});

describe('formatToolResultLine', () => {
  it('formats a successful completion with content summary', () => {
    const result: ToolResult = {
      outcome: 'completed',
      content: [{ type: 'text', text: 'persona contents' }],
    };
    const line = formatToolResultLine('file_read', 'completed', result);
    expect(line.endsWith('\n')).toBe(true);
    expect(line).toContain('[tool_result: file_read');
    expect(line).toContain('persona contents');
    expect(line).not.toMatch(/ERROR|CANCELLED|DENIED|TIMEOUT/);
  });

  it('truncates large success content to ~400 chars with ellipsis', () => {
    const huge = 'a'.repeat(2000);
    const result: ToolResult = {
      outcome: 'completed',
      content: [{ type: 'text', text: huge }],
    };
    const line = formatToolResultLine('file_read', 'completed', result);
    expect(line.length).toBeLessThan(600);
    expect(line).toContain('...');
  });

  it('marks failed tool calls with ERROR and surfaces the error message', () => {
    const result: ToolResult = {
      outcome: 'failed',
      content: [
        {
          type: 'error',
          message: 'pattern "(Empty on first boot.)" not found in /workspace/persona.md',
        },
      ],
    };
    const line = formatToolResultLine('file_edit', 'failed', result);
    expect(line).toContain('[tool_result: file_edit');
    expect(line).toContain('ERROR');
    expect(line).toContain('pattern "(Empty on first boot.)" not found');
  });

  it('marks permission-cancelled tool calls with CANCELLED', () => {
    const result: ToolResult = {
      outcome: 'cancelled',
      content: [{ type: 'error', message: 'Cancelled' }],
    };
    const line = formatToolResultLine('file_edit', 'cancelled', result);
    expect(line).toContain('[tool_result: file_edit');
    expect(line).toContain('CANCELLED');
  });

  it('marks user-denied tool calls with DENIED', () => {
    const result: ToolResult = {
      outcome: 'denied',
      content: [{ type: 'error', message: 'Denied by user' }],
    };
    const line = formatToolResultLine('bash', 'denied', result);
    expect(line).toContain('DENIED');
    expect(line).toContain('Denied by user');
  });

  it('marks timeouts with TIMEOUT', () => {
    const result: ToolResult = {
      outcome: 'timeout',
      content: [{ type: 'error', message: 'killed after 30s' }],
    };
    const line = formatToolResultLine('bash', 'timeout', result);
    expect(line).toContain('TIMEOUT');
    expect(line).toContain('killed after 30s');
  });

  it('handles thrown / unknown-shape results without losing the failure marker', () => {
    // Tools that throw end up as outcome=failed in protocolToolResultFromCore
    // (see runner.ts mapOutcomeToStatus default branch). Ensure we still log
    // ERROR even if the message is unhelpfully empty.
    const result: ToolResult = {
      outcome: 'failed',
      content: [{ type: 'text', text: '' }],
    };
    const line = formatToolResultLine('file_write', 'failed', result);
    expect(line).toContain('ERROR');
  });
});
