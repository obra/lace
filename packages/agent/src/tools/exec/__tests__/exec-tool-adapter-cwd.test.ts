// ABOUTME: Tests the ExecToolAdapter spawn cwd (Part B M1). For a trusted credential tool, the
// container session's workingDirectory (e.g. /work) is host-invalid → ENOENT; the adapter must
// spawn with the host-valid toolTempDir instead. Non-credential tools keep using workingDirectory.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecToolAdapter } from '../exec-tool-adapter';
import type { ExecToolDescriptor } from '../descriptor';
import type { ToolResult } from '@lace/ent-protocol';

// Echoes the process cwd it was spawned in, as its tool-result content, so the
// test can assert which directory the adapter chose.
const CWD_ECHO_SCRIPT = `#!/usr/bin/env node
const mode = process.argv[2];
if (mode === 'lace-tool-schema') { process.exit(0); }
let buf = '';
process.stdin.on('data', (d) => { buf += d; });
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ content: process.cwd() }));
  process.exit(0);
});
`;

function makeBin(): { binDir: string; bin: string } {
  const binDir = mkdtempSync(join(tmpdir(), 'lace-cwd-bin-'));
  const bin = join(binDir, 'echo-cwd');
  writeFileSync(bin, CWD_ECHO_SCRIPT);
  chmodSync(bin, 0o755);
  return { binDir, bin };
}

const credentialDescriptor: ExecToolDescriptor = {
  name: 'request_credential',
  description: 'cwd echo (credentials)',
  inputSchema: { type: 'object', properties: {} },
  capabilities: ['credentials'],
};

const plainDescriptor: ExecToolDescriptor = {
  name: 'echo_cwd',
  description: 'cwd echo (no capabilities)',
  inputSchema: { type: 'object', properties: {} },
};

function resultText(result: ToolResult): string {
  return (result.content ?? []).map((b) => (b.type === 'text' ? (b.text ?? '') : '')).join('');
}

describe('ExecToolAdapter spawn cwd (M1)', () => {
  let binDir: string;
  let binPath: string;
  let hostTmp: string;
  // Extra tempdirs a single test creates, removed by afterEach even on failure.
  const extraTempDirs: string[] = [];

  beforeEach(() => {
    ({ binDir, bin: binPath } = makeBin());
    hostTmp = realpathSync(mkdtempSync(join(tmpdir(), 'lace-cwd-tmp-')));
  });

  afterEach(() => {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(hostTmp, { recursive: true, force: true });
    for (const dir of extraTempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeOtherToolTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'lace-cwd-other-'));
    extraTempDirs.push(dir);
    return realpathSync(dir);
  }

  it('uses host-valid toolTempDir (not the container workingDirectory) for a trusted credential tool', async () => {
    const adapter = new ExecToolAdapter(binPath, credentialDescriptor, 'request_credential', true);
    const result = await adapter.execute(
      {},
      {
        activeSessionId: 'sess-1',
        persona: 'persistent-box-worker',
        credentialBrokerSocket: '/run/cred.sock',
        workingDirectory: '/work', // container path — does not exist on host
        toolTempDir: hostTmp,
      }
    );
    const cwd = realpathSync(resultText(result));
    expect(cwd).toBe(hostTmp);
    expect(cwd).not.toBe('/work');
  });

  it('keeps using workingDirectory for a non-credential tool', async () => {
    const adapter = new ExecToolAdapter(binPath, plainDescriptor, 'echo_cwd', true);
    const result = await adapter.execute(
      {},
      {
        activeSessionId: 'sess-1',
        persona: 'engineer',
        workingDirectory: hostTmp, // host-valid working dir
        toolTempDir: makeOtherToolTempDir(),
      }
    );
    const cwd = realpathSync(resultText(result));
    expect(cwd).toBe(hostTmp);
  });
});
