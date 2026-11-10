// ABOUTME: Checks the native evaluation's opt-in evidence capture through real provider calls.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { TestAgentProvider } from './test-provider';

it('records only the dispatched temporary context when the private receipt is configured', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lace-test-provider-context-'));
  const receipt = join(directory, 'provider-context.jsonl');
  const provider = new TestAgentProvider();
  const options = { temporaryContext: 'Selected original\nExact excerpt.' };
  try {
    vi.stubEnv('LACE_TEST_PROVIDER_RECORD_CONTEXT', undefined);
    await provider.createStreamingResponse([], [], 'test', undefined, undefined, options);
    expect(readdirSync(directory)).toEqual([]);

    vi.stubEnv('LACE_TEST_PROVIDER_RECORD_CONTEXT', receipt);
    await provider.createStreamingResponse([], [], 'test', undefined, undefined, options);
    await provider.createResponse([], [], 'test', undefined, undefined, options);
    await provider.createStreamingResponse([], [], 'test');
    const entries = readFileSync(receipt, 'utf8')
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line) as unknown);
    expect(entries).toEqual([
      { pid: process.pid, temporaryContext: options.temporaryContext },
      { pid: process.pid, temporaryContext: options.temporaryContext },
      { pid: process.pid, temporaryContext: null },
    ]);
    expect(statSync(receipt).mode & 0o777).toBe(0o600);
  } finally {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  }
});
