// ABOUTME: Gold-standard proof for the cross-process seq authority: spawns N REAL OS
// ABOUTME: processes each appending M events to the SAME session and asserts every
// eventSeq is unique (no duplicate), strictly increasing when sorted (gaps allowed), and
// the count equals N*M (no lost appends). This is the test that proves the per-session
// lock + reserve-before-append prevents the cross-process duplicate race.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readAllSessionEventLines } from '../event-log';

const CHILD = join(__dirname, '_seq-append-child.ts');

function runChild(laceDir: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', CHILD, ...args], {
      env: { ...process.env, LACE_DIR: laceDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0 && stderr) {
        // Surface child failures so a broken append doesn't masquerade as a pass.
        reject(new Error(`child exited ${code}: ${stderr}`));
        return;
      }
      resolve(code ?? -1);
    });
  });
}

function eventSeqsAcrossShards(sessionDir: string): number[] {
  const seqs: number[] = [];
  for (const line of readAllSessionEventLines(sessionDir)) {
    try {
      const seq = (JSON.parse(line) as { eventSeq?: number }).eventSeq;
      if (typeof seq === 'number') seqs.push(seq);
    } catch {
      // ignore malformed line
    }
  }
  return seqs;
}

describe('seq cross-process concurrency', () => {
  let laceDir: string;
  let sessionDir: string;
  let savedLaceDir: string | undefined;

  beforeEach(() => {
    savedLaceDir = process.env.LACE_DIR;
    laceDir = mkdtempSync(join(tmpdir(), 'lace-seq-conc-'));
    // The PARENT (this test) also reads the JSONL via readAllSessionEventLines,
    // which resolves the transcript tree from getLaceDir() → LACE_DIR. Set it so
    // the parent reads the same root the children wrote to.
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

  it('N processes appending M events each yield unique, monotonic, complete seqs', async () => {
    const N = 4;
    const M = 50;
    await Promise.all(Array.from({ length: N }, () => runChild(laceDir, [sessionDir, String(M)])));

    const seqs = eventSeqsAcrossShards(sessionDir);

    // NO DUPLICATES — the whole point. A duplicate seq means the lock failed
    // and two processes reserved the same value.
    expect(new Set(seqs).size).toBe(seqs.length);

    // No lost appends: every one of the N*M events landed.
    expect(seqs.length).toBe(N * M);

    // Strictly increasing when sorted (gaps allowed, but none expected here
    // since no crash was injected).
    const sorted = [...seqs].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]).toBeGreaterThan(sorted[i - 1]);
    }
  }, 60_000);
});
