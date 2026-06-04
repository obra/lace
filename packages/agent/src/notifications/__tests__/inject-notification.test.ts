// ABOUTME: Unit tests for injectNotification — writes context_injected event with
// ABOUTME: priority='immediate' and triggers idle-wake when targeting active session.

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { injectNotification } from '../inject-notification';
import { readDurableEvents, invalidatePersonaCache } from '../../storage/event-log';

function tempSessionDir(): { laceDir: string; sessionDir: string } {
  const laceDir = mkdtempSync(join(tmpdir(), 'lace-inject-test-'));
  const sessionId = `sess_${randomUUID()}`;
  const sessionDir = join(laceDir, 'agent-sessions', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    join(sessionDir, 'meta.json'),
    JSON.stringify({
      sessionId,
      workDir: laceDir,
      created: new Date().toISOString(),
      persona: 'test',
    })
  );
  return { laceDir, sessionDir };
}

describe('injectNotification', () => {
  let savedLaceDir: string | undefined;

  beforeEach(() => {
    savedLaceDir = process.env.LACE_DIR;
    invalidatePersonaCache();
  });

  afterEach(() => {
    if (savedLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = savedLaceDir;
  });

  it('appends a context_injected event with priority=immediate', () => {
    const { laceDir, sessionDir } = tempSessionDir();
    process.env.LACE_DIR = laceDir;
    injectNotification({
      sessionDir,
      kind: 'reminder',
      identifiers: { id: 'reminder_abc123abc123' },
      body: 'fired',
    });
    const { events } = readDurableEvents(sessionDir, {});
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('context_injected');
    expect((events[0].data as { priority?: string }).priority).toBe('immediate');
    const content = (events[0].data as { content: Array<{ text: string }> }).content;
    expect(content[0].text).toContain('<notification kind="reminder" id="reminder_abc123abc123">');
    expect(content[0].text).toContain('fired');
  });

  it('triggers idle-wake when target is active and no turn is in flight', () => {
    const { laceDir, sessionDir } = tempSessionDir();
    process.env.LACE_DIR = laceDir;
    const triggerInternalTurn = vi.fn();
    injectNotification({
      sessionDir,
      kind: 'job-completed',
      identifiers: { 'job-id': 'job_x' },
      body: 'done',
      idleWake: {
        isActive: (d) => d === sessionDir,
        hasActiveTurn: () => false,
        triggerInternalTurn,
      },
    });
    expect(triggerInternalTurn).toHaveBeenCalledTimes(1);
  });

  it('does NOT trigger idle-wake when a turn is in flight', () => {
    const { laceDir, sessionDir } = tempSessionDir();
    process.env.LACE_DIR = laceDir;
    const triggerInternalTurn = vi.fn();
    injectNotification({
      sessionDir,
      kind: 'job-progress',
      identifiers: { 'job-id': 'job_x' },
      body: 'running',
      idleWake: {
        isActive: (d) => d === sessionDir,
        hasActiveTurn: () => true,
        triggerInternalTurn,
      },
    });
    expect(triggerInternalTurn).not.toHaveBeenCalled();
  });

  it('sets track on the context_injected event when provided', () => {
    const { laceDir, sessionDir } = tempSessionDir();
    process.env.LACE_DIR = laceDir;
    injectNotification({
      sessionDir,
      kind: 'reminder',
      identifiers: { id: 'reminder_track_test' },
      body: 'fired',
      track: 'slack:TTEAM:CCHAN/1234567890.000100',
    });
    const { events } = readDurableEvents(sessionDir, {});
    expect(events).toHaveLength(1);
    expect((events[0].data as { track?: string }).track).toBe(
      'slack:TTEAM:CCHAN/1234567890.000100'
    );
  });

  it('leaves track undefined on the context_injected event when not provided', () => {
    const { laceDir, sessionDir } = tempSessionDir();
    process.env.LACE_DIR = laceDir;
    injectNotification({
      sessionDir,
      kind: 'reminder',
      identifiers: { id: 'reminder_notrack' },
      body: 'fired',
    });
    const { events } = readDurableEvents(sessionDir, {});
    expect(events).toHaveLength(1);
    expect((events[0].data as { track?: string }).track).toBeUndefined();
  });

  it('does NOT trigger idle-wake when target is not the active session', () => {
    const { laceDir, sessionDir } = tempSessionDir();
    process.env.LACE_DIR = laceDir;
    const triggerInternalTurn = vi.fn();
    injectNotification({
      sessionDir,
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
