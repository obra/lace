// ABOUTME: Unit tests for AlarmStore — single-snapshot JSON storage, in-memory mirror,
// ABOUTME: atomic rewrite via atomicWriteJson on every change, MAX_ACTIVE_ALARMS cap.

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { AlarmStore } from '../alarm-store';
import { MAX_ACTIVE_ALARMS } from '../types';
import { logger } from '@lace/agent/utils/logger';

function tempSessionDir(): string {
  return mkdtempSync(join(tmpdir(), 'lace-alarmstore-'));
}

describe('AlarmStore', () => {
  it('insert returns pending row and writes snapshot', () => {
    const dir = tempSessionDir();
    const s = new AlarmStore(dir);
    const row = s.insert({
      kind: 'once',
      schedule: '2030-01-01T00:00:00Z',
      timezone: 'UTC',
      prompt: 'p',
      next_fire_at: 1,
      now: 0,
    });
    expect(row.status).toBe('pending');
    const raw = JSON.parse(readFileSync(join(dir, 'alarms.json'), 'utf8'));
    expect(raw.alarms).toHaveLength(1);
    expect(raw.alarms[0].id).toBe(row.id);
  });

  it('rehydrates from snapshot', () => {
    const dir = tempSessionDir();
    const s1 = new AlarmStore(dir);
    s1.insert({
      kind: 'once',
      schedule: '2030-01-01T00:00:00Z',
      timezone: 'UTC',
      prompt: 'p',
      next_fire_at: 1,
      now: 0,
    });
    const s2 = new AlarmStore(dir);
    expect(s2.listActive()).toHaveLength(1);
  });

  it('claim transitions pending → firing exactly once', () => {
    const dir = tempSessionDir();
    const s = new AlarmStore(dir);
    const row = s.insert({
      kind: 'once',
      schedule: '2030-01-01T00:00:00Z',
      timezone: 'UTC',
      prompt: 'p',
      next_fire_at: 1,
      now: 0,
    });
    expect(s.claim(row.id)).toBe(true);
    expect(s.claim(row.id)).toBe(false);
    expect(s.get(row.id)?.status).toBe('firing');
  });

  it('cancel returns structured reasons', () => {
    const dir = tempSessionDir();
    const s = new AlarmStore(dir);
    expect(s.cancel('alarm_nope').cancelled).toBe(false);
    const row = s.insert({
      kind: 'once',
      schedule: '2030-01-01T00:00:00Z',
      timezone: 'UTC',
      prompt: 'p',
      next_fire_at: 1,
      now: 0,
    });
    s.claim(row.id);
    const denied = s.cancel(row.id);
    expect(denied.cancelled).toBe(false);
    if (!denied.cancelled) expect(denied.reason).toBe('firing');
  });

  it('countActive enforces MAX_ACTIVE_ALARMS', () => {
    const dir = tempSessionDir();
    const s = new AlarmStore(dir);
    for (let i = 0; i < MAX_ACTIVE_ALARMS; i++) {
      s.insert({
        kind: 'once',
        schedule: '2030-01-01T00:00:00Z',
        timezone: 'UTC',
        prompt: `p${i}`,
        next_fire_at: i,
        now: 0,
      });
    }
    expect(s.countActive()).toBe(MAX_ACTIVE_ALARMS);
  });

  it('repairFiringOnBoot demotes firing rows back to pending', () => {
    const dir = tempSessionDir();
    const s1 = new AlarmStore(dir);
    const row = s1.insert({
      kind: 'once',
      schedule: '2030-01-01T00:00:00Z',
      timezone: 'UTC',
      prompt: 'p',
      next_fire_at: 1,
      now: 0,
    });
    s1.claim(row.id);
    const s2 = new AlarmStore(dir);
    s2.repairFiringOnBoot();
    expect(s2.get(row.id)?.status).toBe('pending');
  });

  it('warns and treats corrupt JSON as empty', () => {
    const dir = tempSessionDir();
    writeFileSync(join(dir, 'alarms.json'), 'not valid json{');
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const s = new AlarmStore(dir);
    expect(s.listActive()).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith('alarm.store.corrupt_snapshot', expect.anything());
    warnSpy.mockRestore();
  });
});
