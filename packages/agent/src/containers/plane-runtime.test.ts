// ABOUTME: Tests PlaneRuntime as a standalone sen-docker plane client.
// ABOUTME: Uses an injected runner so no docker CLI or real plane process is needed.

import { describe, it, expect, vi } from 'vitest';
import { PlaneRuntime, type PlaneRunner } from './plane-runtime';
import type { PlaneSpawnRequest } from './types';

function spawnRequest(extra: Partial<PlaneSpawnRequest> = {}): PlaneSpawnRequest {
  return {
    persona: 'ephemeral-shell',
    parentSession: 'sess_parent',
    childSession: 'sess_child',
    jobId: 'job_1',
    ...extra,
  };
}

describe('PlaneRuntime', () => {
  it('create emits the 4-arg spawn verb and returns the daemon name', async () => {
    const run = vi.fn<PlaneRunner['run']>().mockResolvedValue({
      stdout: 'sen-x-abc\n',
      stderr: '',
      exitCode: 0,
    });
    const rt = new PlaneRuntime('/bin/sen-docker-client', { run });

    const id = await rt.create(spawnRequest());

    expect(run).toHaveBeenCalledWith([
      'spawn',
      'ephemeral-shell',
      'sess_parent',
      'sess_child',
      'job_1',
    ]);
    expect(id).toBe('sen-x-abc');
  });

  it('falls back to id before name when spawn prints no name', async () => {
    const run = vi.fn<PlaneRunner['run']>().mockResolvedValue({
      stdout: '\n',
      stderr: '',
      exitCode: 0,
    });
    const rt = new PlaneRuntime('/bin/sen-docker-client', { run });

    await expect(
      rt.create({ ...spawnRequest(), id: 'container-id', name: 'requested-box' })
    ).resolves.toBe('container-id');
  });

  it('rejects when persona is missing', async () => {
    const rt = new PlaneRuntime('/bin/sen-docker-client', {
      run: vi.fn<PlaneRunner['run']>(),
    });

    await expect(
      rt.create({ parentSession: 'sess_parent', jobId: 'job_1' } as never)
    ).rejects.toThrow(/persona/);
  });

  it('synthesizes jobId from the child session when absent', async () => {
    const run = vi.fn<PlaneRunner['run']>().mockResolvedValue({
      stdout: 'sen-x-child\n',
      stderr: '',
      exitCode: 0,
    });
    const rt = new PlaneRuntime('/bin/sen-docker-client', { run });

    await rt.create({
      persona: 'ephemeral-shell',
      parentSession: 'sess_parent',
      childSession: 'sess_child',
    } as PlaneSpawnRequest);

    expect(run).toHaveBeenCalledWith([
      'spawn',
      'ephemeral-shell',
      'sess_parent',
      'sess_child',
      'job_child',
    ]);
  });

  it('start is a no-op for already-running cached containers', async () => {
    const run = vi.fn<PlaneRunner['run']>().mockResolvedValue({
      stdout: 'sen-x-start\n',
      stderr: '',
      exitCode: 0,
    });
    const rt = new PlaneRuntime('/bin/sen-docker-client', { run });
    const id = await rt.create(spawnRequest());

    await rt.start(id);

    expect(rt.inspect(id).state).toBe('running');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('start rejects stopped cached containers without changing cached state', async () => {
    const run = vi.fn<PlaneRunner['run']>().mockResolvedValue({
      stdout: 'sen-x-start\n',
      stderr: '',
      exitCode: 0,
    });
    const rt = new PlaneRuntime('/bin/sen-docker-client', { run });
    const id = await rt.create(spawnRequest());
    await rt.stop(id);

    await expect(rt.start(id)).rejects.toThrow(/cannot start stopped plane container/i);

    expect(rt.inspect(id).state).toBe('stopped');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('start rejects unknown container ids', async () => {
    const run = vi.fn<PlaneRunner['run']>();
    const rt = new PlaneRuntime('/bin/sen-docker-client', { run });

    await expect(rt.start('missing-container')).rejects.toThrow(
      /Container not found: missing-container/
    );

    expect(run).not.toHaveBeenCalled();
  });

  it('adopt re-runs create through the idempotent spawn path', async () => {
    const run = vi.fn<PlaneRunner['run']>().mockResolvedValue({
      stdout: 'sen-x-adopt\n',
      stderr: '',
      exitCode: 0,
    });
    const rt = new PlaneRuntime('/bin/sen-docker-client', { run });

    await rt.adopt(spawnRequest(), 'running');

    expect(run).toHaveBeenCalledWith([
      'spawn',
      'ephemeral-shell',
      'sess_parent',
      'sess_child',
      'job_1',
    ]);
    expect(rt.inspect('sen-x-adopt').state).toBe('running');
  });

  it('exec emits the buffered plane exec verb with workdir and env args', async () => {
    const run = vi
      .fn<PlaneRunner['run']>()
      .mockResolvedValueOnce({ stdout: 'sen-x-exec\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'out', stderr: 'err', exitCode: 7 });
    const rt = new PlaneRuntime('/bin/sen-docker-client', { run });
    const id = await rt.create(spawnRequest());

    await expect(
      rt.exec(id, {
        command: ['node', '-e', 'process.exit(7)'],
        workingDirectory: '/work',
        environment: { A: '1', B: '2' },
      })
    ).resolves.toEqual({ stdout: 'out', stderr: 'err', exitCode: 7 });

    expect(run).toHaveBeenLastCalledWith(
      ['exec', '-w', '/work', '-e', 'A=1', '-e', 'B=2', id, 'node', '-e', 'process.exit(7)'],
      { timeout: 30000 }
    );
  });

  it('exec forwards timeout to the plane runner', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ stdout: 'sen-x-timeout\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });
    const rt = new PlaneRuntime('/bin/sen-docker-client', { run });
    const id = await rt.create(spawnRequest());

    await rt.exec(id, { command: ['true'], timeout: 1234 });

    expect(run).toHaveBeenLastCalledWith(['exec', id, 'true'], { timeout: 1234 });
  });

  it('exec maps timeout runner errors to Execution timeout', async () => {
    const timeoutError = Object.assign(new Error('spawn ETIMEDOUT'), {
      killed: true,
      signal: 'SIGTERM',
    });
    const run = vi
      .fn()
      .mockResolvedValueOnce({ stdout: 'sen-x-timeout-error\n', stderr: '', exitCode: 0 })
      .mockRejectedValueOnce(timeoutError);
    const rt = new PlaneRuntime('/bin/sen-docker-client', { run });
    const id = await rt.create(spawnRequest());

    await expect(rt.exec(id, { command: ['sleep', '10'] })).rejects.toThrow(/Execution timeout/);
  });

  it('exec rejects stdin until streaming exec is implemented', async () => {
    const run = vi.fn<PlaneRunner['run']>().mockResolvedValue({
      stdout: 'sen-x-stdin\n',
      stderr: '',
      exitCode: 0,
    });
    const rt = new PlaneRuntime('/bin/sen-docker-client', { run });
    const id = await rt.create(spawnRequest());

    await expect(rt.exec(id, { command: ['cat'], stdin: 'input' })).rejects.toThrow(
      /stdin.*execStream/i
    );
  });

  it('execStream throws a clear not-yet-implemented error', async () => {
    const rt = new PlaneRuntime('/bin/sen-docker-client', {
      run: vi.fn<PlaneRunner['run']>(),
    });

    await expect(rt.execStream('sen-x-stream', { command: ['cat'] })).rejects.toThrow(
      /execStream.*not implemented/i
    );
  });

  it('stop and remove go through the plane client and update cache', async () => {
    const run = vi.fn<PlaneRunner['run']>().mockResolvedValue({
      stdout: 'sen-x-rm\n',
      stderr: '',
      exitCode: 0,
    });
    const rt = new PlaneRuntime('/bin/sen-docker-client', { run });
    const id = await rt.create(spawnRequest());

    await rt.stop(id);
    expect(rt.inspect(id).state).toBe('stopped');

    await rt.remove(id);
    expect(() => rt.inspect(id)).toThrow(/Container not found/);
    expect(run).toHaveBeenNthCalledWith(2, ['stop', id]);
    expect(run).toHaveBeenNthCalledWith(3, ['rm', '-f', id]);
  });

  it('stop translates timeout milliseconds to whole seconds', async () => {
    const run = vi.fn<PlaneRunner['run']>().mockResolvedValue({
      stdout: 'sen-x-stop-timeout\n',
      stderr: '',
      exitCode: 0,
    });
    const rt = new PlaneRuntime('/bin/sen-docker-client', { run });
    const id = await rt.create(spawnRequest());

    await rt.stop(id, 2500);

    expect(run).toHaveBeenLastCalledWith(['stop', '-t', '2', id]);
  });
});
