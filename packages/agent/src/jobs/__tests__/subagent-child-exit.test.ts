// ABOUTME: Tests for subagent child-exit handling — PRI-1774
// ABOUTME: When a subagent process crashes mid-RPC the parent must persist its
// ABOUTME: stderr to the per-job .log file AND wake the pending RPC so the job
// ABOUTME: transitions to a terminal state instead of hanging forever.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { persistSubagentChildExit } from '../subagent-exit-handler';

describe('persistSubagentChildExit', () => {
  it('writes the captured stderr buffer to the per-job .log file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pri-1774-'));
    try {
      const outputPath = join(dir, 'jobs', 'job_x.log');

      persistSubagentChildExit({
        jobId: 'job_x',
        outputPath,
        exitCode: 1,
        signal: null,
        stderr: "PersonaContainerSpecError: unknown mount 'lace'\n",
      });

      expect(existsSync(outputPath)).toBe(true);
      const contents = readFileSync(outputPath, 'utf8');
      expect(contents).toContain('[SUBAGENT CHILD EXITED]');
      expect(contents).toContain('exitCode: 1');
      expect(contents).toContain("PersonaContainerSpecError: unknown mount 'lace'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records the signal name when a signal terminated the child', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pri-1774-'));
    try {
      const outputPath = join(dir, 'jobs', 'job_y.log');

      persistSubagentChildExit({
        jobId: 'job_y',
        outputPath,
        exitCode: null,
        signal: 'SIGSEGV',
        stderr: 'segfault\n',
      });

      const contents = readFileSync(outputPath, 'utf8');
      expect(contents).toContain('signal: SIGSEGV');
      expect(contents).toContain('segfault');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op when exitCode is 0 (normal shutdown)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pri-1774-'));
    try {
      const outputPath = join(dir, 'jobs', 'job_z.log');

      persistSubagentChildExit({
        jobId: 'job_z',
        outputPath,
        exitCode: 0,
        signal: null,
        stderr: 'irrelevant\n',
      });

      expect(existsSync(outputPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still writes a header even if stderr is empty (so the log is not silent)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pri-1774-'));
    try {
      const outputPath = join(dir, 'jobs', 'job_q.log');

      persistSubagentChildExit({
        jobId: 'job_q',
        outputPath,
        exitCode: 1,
        signal: null,
        stderr: '',
      });

      const contents = readFileSync(outputPath, 'utf8');
      expect(contents).toContain('[SUBAGENT CHILD EXITED]');
      expect(contents).toContain('exitCode: 1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
