// ABOUTME: Crash-injection proof for reserve-before-append. A child reserves a seq
// ABOUTME: (advancing the head file) then dies BEFORE appending the JSONL line. The
// reserved seq must be BURNED (a gap) — never written, never reused by the next append.
// This proves a crash in the reserve→append window yields a gap, not a duplicate.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { appendDurableEvent, readAllSessionEventLines } from '../event-log';
import { readHead } from '../seq-head';

const CHILD = join(__dirname, '_seq-append-child.ts');

function runChild(laceDir: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', CHILD, ...args], {
      env: { ...process.env, LACE_DIR: laceDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? -1));
  });
}

function eventSeqs(sessionDir: string): number[] {
  const seqs: number[] = [];
  for (const line of readAllSessionEventLines(sessionDir)) {
    try {
      const seq = (JSON.parse(line) as { eventSeq?: number }).eventSeq;
      if (typeof seq === 'number') seqs.push(seq);
    } catch {
      // ignore malformed
    }
  }
  return seqs;
}

describe('seq crash-injection (reserve-before-append → gap, not dup)', () => {
  let laceDir: string;
  let sessionDir: string;
  let savedLaceDir: string | undefined;

  beforeEach(() => {
    savedLaceDir = process.env.LACE_DIR;
    laceDir = mkdtempSync(join(tmpdir(), 'lace-seq-crash-'));
    process.env.LACE_DIR = laceDir;
    const sessionId = `sess_${randomUUID()}`;
    sessionDir = join(laceDir, 'agent-sessions', sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, 'meta.json'),
      JSON.stringify({
        sessionId,
        workDir: laceDir,
        created: new Date().toISOString(),
        persona: 'ada',
      })
    );
  });

  afterEach(() => {
    if (savedLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = savedLaceDir;
    rmSync(laceDir, { recursive: true, force: true });
  });

  it('burns a seq when a process dies between reserve and append', async () => {
    // 1) A real append lands seq 1 (head → 2).
    let state = { nextEventSeq: 1, nextStreamSeq: 1 };
    ({ nextState: state } = appendDurableEvent(sessionDir, state, { type: 'message', data: {} }));
    expect(eventSeqs(sessionDir)).toEqual([1]);
    expect(readHead(sessionDir)).toBe(2);

    // 2) Child reserves seq 2 (head → 3) then dies BEFORE appending: seq 2 burned.
    const code = await runChild(laceDir, [sessionDir, '--reserve-only']);
    expect(code).toBe(1);
    // The head advanced (the reserve persisted) but no JSONL line was written.
    expect(readHead(sessionDir)).toBe(3);
    expect(eventSeqs(sessionDir)).toEqual([1]); // seq 2 NOT present — burned

    // 3) Next normal append gets seq 3 (the burned 2 is a permanent gap).
    ({ nextState: state } = appendDurableEvent(sessionDir, state, { type: 'message', data: {} }));
    const seqs = eventSeqs(sessionDir);

    // No duplicate: the set size equals the length.
    expect(new Set(seqs).size).toBe(seqs.length);
    // The append got 3, not the burned 2 → a gap [1, 3], not a dup.
    expect(seqs).toEqual([1, 3]);
    expect(seqs).not.toContain(2);
  });
});
