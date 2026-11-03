// ABOUTME: Proves `lace-agent reminders ensure` runs as a one-shot CLI from the real built entry:
// ABOUTME: it exits with stdin still open and never starts the server (no agent.log, no RPC).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SESSION = 'sess_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const agentMainPath = fileURLToPath(new URL('../../dist/main.js', import.meta.url));

let laceDir: string;

beforeEach(() => {
  laceDir = mkdtempSync(join(tmpdir(), 'lace-reminders-cli-e2e-'));
  mkdirSync(join(laceDir, 'agent-sessions', SESSION), { recursive: true });
  writeFileSync(join(laceDir, 'prompt.txt'), 'NIGHTLY MISE-EN-PLACE');
});

afterEach(() => {
  rmSync(laceDir, { recursive: true, force: true });
});

function runEntry(
  args: string[]
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // stdin stays an open pipe, as it would under a careless caller: the server would
    // block on it forever, so a prompt exit proves the server code never ran.
    const proc = spawn(process.execPath, [agentMainPath, ...args], {
      env: { ...process.env, LACE_DIR: laceDir, TZ: 'UTC' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
    proc.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`entry did not exit within 10s; stderr:\n${stderr}`));
    }, 10_000);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe('lace-agent reminders (built entry)', { timeout: 15_000 }, () => {
  it('creates the reminder and exits without starting the server', async () => {
    const { code, stdout, stderr } = await runEntry([
      'reminders',
      'ensure',
      '--session',
      SESSION,
      '--cron',
      '0 22 * * *',
      '--prompt-file',
      join(laceDir, 'prompt.txt'),
      '--match',
      'mise-en-place',
    ]);

    // Compared together so a failure shows the CLI's stderr.
    expect({ code, stderr }).toEqual({ code: 0, stderr: expect.any(String) });
    expect(JSON.parse(stdout.trim().split('\n').pop()!)).toMatchObject({ status: 'created' });
    const rows = JSON.parse(
      readFileSync(join(laceDir, 'agent-sessions', SESSION, 'reminders.json'), 'utf8')
    ).reminders;
    expect(rows).toHaveLength(1);
    expect(existsSync(join(laceDir, 'agent.log'))).toBe(false);
    expect(existsSync(join(laceDir, 'ent-protocol.log'))).toBe(false);
  });

  it('exits 64 with usage for an unknown reminders subcommand', async () => {
    const { code, stderr } = await runEntry(['reminders', 'frobnicate']);

    expect(code).toBe(64);
    expect(stderr).toContain('usage: lace-agent reminders ensure');
  });
});
