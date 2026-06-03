import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { runExecToolProcess } from './run-once';
const FIX = path.join(__dirname, '__fixtures__');
describe('runExecToolProcess', () => {
  it('captures stdout + exit code', async () => {
    const r = await runExecToolProcess(path.join(FIX, 'echo-tool.sh'), ['lace-tool-invoke'], {
      stdin: JSON.stringify({ input: { msg: 'hi' }, context: { sessionId: 's', persona: 'p' } }),
      cwd: FIX,
      timeoutMs: 5000,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('echo:hi');
  });
  it('does NOT leak the parent env to the child', async () => {
    process.env.LACE_SECRET_PROBE = 'topsecret';
    const r = await runExecToolProcess(path.join(FIX, 'env-dump-tool.sh'), ['lace-tool-invoke'], {
      stdin: '{}',
      cwd: FIX,
      timeoutMs: 5000,
    });
    expect(r.stdout).not.toContain('topsecret');
    delete process.env.LACE_SECRET_PROBE;
  });
  it('kills the process group on abort', async () => {
    const ac = new AbortController();
    const p = runExecToolProcess(path.join(FIX, 'slow-tool.sh'), ['lace-tool-invoke'], {
      stdin: '{}',
      cwd: FIX,
      timeoutMs: 10000,
      signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 100);
    expect((await p).aborted).toBe(true);
  });
  it('reports timeout', async () => {
    const r = await runExecToolProcess(path.join(FIX, 'slow-tool.sh'), ['lace-tool-invoke'], {
      stdin: '{}',
      cwd: FIX,
      timeoutMs: 100,
    });
    expect(r.timedOut).toBe(true);
  });
  it('resolves cleanly when child exits before reading stdin (no EPIPE crash)', async () => {
    // fail-tool.sh does `echo boom >&2; exit 3` — it never reads stdin
    const r = await runExecToolProcess(path.join(FIX, 'fail-tool.sh'), ['lace-tool-invoke'], {
      stdin: JSON.stringify({ input: {}, context: { sessionId: 's', persona: 'p' } }),
      cwd: FIX,
      timeoutMs: 5000,
    });
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain('boom');
  });
});
