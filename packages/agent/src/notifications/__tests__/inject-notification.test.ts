// ABOUTME: Unit tests for injectNotification — writes context_injected event with
// ABOUTME: priority='immediate' and triggers idle-wake when targeting active session.

import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { injectNotification } from '../inject-notification';

function tempSessionDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'lace-inject-test-'));
  mkdirSync(root, { recursive: true });
  return root;
}

function readEventsJsonl(dir: string): Array<{ type: string; data: Record<string, unknown> }> {
  try {
    return readFileSync(join(dir, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

describe('injectNotification', () => {
  it('appends a context_injected event with priority=immediate', () => {
    const dir = tempSessionDir();
    injectNotification({
      sessionDir: dir,
      kind: 'reminder',
      identifiers: { id: 'reminder_abc123abc123' },
      body: 'fired',
    });
    const events = readEventsJsonl(dir);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('context_injected');
    expect((events[0].data as { priority?: string }).priority).toBe('immediate');
    const content = (events[0].data as { content: Array<{ text: string }> }).content;
    expect(content[0].text).toContain('<notification kind="reminder" id="reminder_abc123abc123">');
    expect(content[0].text).toContain('fired');
  });

  it('triggers idle-wake when target is active and no turn is in flight', () => {
    const dir = tempSessionDir();
    const triggerInternalTurn = vi.fn();
    injectNotification({
      sessionDir: dir,
      kind: 'job-completed',
      identifiers: { 'job-id': 'job_x' },
      body: 'done',
      idleWake: {
        isActive: (d) => d === dir,
        hasActiveTurn: () => false,
        triggerInternalTurn,
      },
    });
    expect(triggerInternalTurn).toHaveBeenCalledTimes(1);
  });

  it('does NOT trigger idle-wake when a turn is in flight', () => {
    const dir = tempSessionDir();
    const triggerInternalTurn = vi.fn();
    injectNotification({
      sessionDir: dir,
      kind: 'job-progress',
      identifiers: { 'job-id': 'job_x' },
      body: 'running',
      idleWake: {
        isActive: (d) => d === dir,
        hasActiveTurn: () => true,
        triggerInternalTurn,
      },
    });
    expect(triggerInternalTurn).not.toHaveBeenCalled();
  });

  it('does NOT trigger idle-wake when target is not the active session', () => {
    const dir = tempSessionDir();
    const triggerInternalTurn = vi.fn();
    injectNotification({
      sessionDir: dir,
      kind: 'subagent-exited',
      identifiers: { 'subagent-session-id': 'sess_x' },
      body: 'gone',
      idleWake: {
        isActive: () => false,
        hasActiveTurn: () => false,
        triggerInternalTurn,
      },
    });
    expect(triggerInternalTurn).not.toHaveBeenCalled();
  });
});
