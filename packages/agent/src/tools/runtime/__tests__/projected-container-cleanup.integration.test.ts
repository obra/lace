// ABOUTME: Real Docker process-group cancellation checks for projected shell commands.
// ABOUTME: Opt in on disposable Linux infrastructure with LACE_CONTAINER_CLEANUP_TESTS=1.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { DockerContainerRuntime } from '../../../containers/docker-container';
import { ContainerManager } from '../../../containers/container-manager';
import { ProjectedContainerToolRuntime } from '../projected-container';

const execFileAsync = promisify(execFile);
const enabled = process.env.LACE_CONTAINER_CLEANUP_TESTS === '1';

describe.skipIf(!enabled)('projected container process cleanup', () => {
  let directory: string;
  let name: string;
  let containerId: string;
  let manager: ContainerManager;
  let runtime: ProjectedContainerToolRuntime;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'lace-cleanup-'));
    name = `cleanup-${randomUUID()}`;
    const dockerWrapper = join(directory, 'docker.sh');
    await writeFile(
      dockerWrapper,
      `#!/bin/sh
      tagged=0
      for arg in "$@"; do case "$arg" in lace-exec-*) tagged=1 ;; esac; done
      if [ -e '${directory}/delay-start' ] && [ "$tagged" = 1 ]; then
        trap '' TERM
        printf '%s' "$$" > '${directory}/launch.pid'
        sleep 0.4
      fi
      exec docker "$@"
    `
    );
    await chmod(dockerWrapper, 0o755);
    manager = new ContainerManager(new DockerContainerRuntime(dockerWrapper), name);
    runtime = new ProjectedContainerToolRuntime({
      id: name,
      containerManager: manager,
      descriptor: {
        cwd: '/fixture',
        spec: {
          name,
          image: process.env.LACE_CLEANUP_TEST_IMAGE ?? 'node:24-bookworm',
          workingDirectory: '/fixture',
          mounts: [{ hostPath: directory, containerPath: '/fixture', readonly: false }],
        },
      },
    });
    await runtime.process.exec(['true']);
    containerId = (await manager.inspect(name))!.containerId;
    await writeFile(
      join(directory, 'child.cjs'),
      `
      const fs = require('node:fs');
      const label = process.argv[2];
      if (process.argv[3] === 'ignore-term') process.on('SIGTERM', () => {});
      fs.writeFileSync('/fixture/' + label + '.pid', String(process.pid));
      setTimeout(() => fs.writeFileSync('/fixture/' + label + '.marker', 'survived'), 4500);
      setTimeout(() => process.exit(0), 7000);
    `
    );
  }, 30000);

  afterEach(async () => {
    if (manager && name) await manager.destroy(name);
    if (directory) await rm(directory, { recursive: true, force: true });
  }, 30000);

  async function childPid(label: string): Promise<number> {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        return Number(await readFile(join(directory, `${label}.pid`), 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await delay(25);
      }
    }
    throw new Error(`child did not start: ${label}`);
  }

  async function alive(pid: number): Promise<boolean> {
    const { stdout } = await execFileAsync('docker', [
      'exec',
      containerId,
      'sh',
      '-c',
      'ps -o stat= -p "$1" || true',
      'probe',
      String(pid),
    ]);
    return stdout.trim().length > 0 && !stdout.trim().startsWith('Z');
  }

  it.each(['ordinary', 'ignore-term'])(
    'abort terminates a %s child before completion',
    async (mode) => {
      const controller = new AbortController();
      const handle = await runtime.process.start(
        ['sh', '-c', `node /fixture/child.cjs target ${mode} & wait`],
        {
          signal: controller.signal,
        }
      );
      const outcome = handle.completion.catch((error: unknown) => error);
      const pid = await childPid('target');
      const control = await runtime.process.start([
        'sh',
        '-c',
        'node /fixture/child.cjs control & wait',
      ]);
      const controlDone = control.completion.catch(() => undefined);
      const controlPid = await childPid('control');
      controller.abort();
      expect(await outcome).toHaveProperty('name', 'AbortError');
      expect(await alive(pid)).toBe(false);
      expect(await alive(controlPid)).toBe(true);
      await delay(2600);
      await expect(readFile(join(directory, 'target.marker'), 'utf8')).rejects.toHaveProperty(
        'code',
        'ENOENT'
      );
      expect(await readFile(join(directory, 'control.marker'), 'utf8')).toBe('survived');
      control.kill();
      await controlDone;
    },
    20000
  );

  it('explicit kill also waits for termination of TERM-resistant descendants', async () => {
    const handle = await runtime.process.start([
      'sh',
      '-c',
      'node /fixture/child.cjs target ignore-term & wait',
    ]);
    const pid = await childPid('target');
    handle.kill();
    await handle.completion;
    expect(await alive(pid)).toBe(false);
  }, 10000);

  it.each(['exec ', ''])(
    'Bash cancellation survives %scommand replacement',
    async (prefix) => {
      const handle = await runtime.process.start([
        '/bin/bash',
        '-c',
        `${prefix}node /fixture/child.cjs bash ignore-term`,
      ]);
      const pid = await childPid('bash');
      handle.kill();
      await handle.completion;
      expect(await alive(pid)).toBe(false);
    },
    10000
  );

  it('cancels during real Docker startup before the target is visible', async () => {
    await writeFile(join(directory, 'delay-start'), 'gate');
    const controller = new AbortController();
    const handle = await runtime.process.start(
      ['/bin/bash', '-c', 'exec node /fixture/child.cjs startup ignore-term'],
      {
        signal: controller.signal,
      }
    );
    const outcome = handle.completion.catch((error: unknown) => error);
    await childPid('launch');
    controller.abort();
    expect(await outcome).toHaveProperty('name', 'AbortError');
    expect(await alive(await childPid('startup'))).toBe(false);
    await expect(readFile(join(directory, 'startup.marker'))).rejects.toHaveProperty(
      'code',
      'ENOENT'
    );
  }, 15000);

  it('rejects a pre-aborted start without launching the command', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runtime.process.start(['sh', '-c', 'touch /fixture/started'], {
        signal: controller.signal,
      })
    ).rejects.toHaveProperty('name', 'AbortError');
    await expect(readFile(join(directory, 'started'))).rejects.toHaveProperty('code', 'ENOENT');
  });

  it('reports a real cleanup failure instead of silently completing', async () => {
    const handle = await runtime.process.start([
      'sh',
      '-c',
      'node /fixture/child.cjs target ignore-term & wait',
    ]);
    await childPid('target');
    await execFileAsync('docker', [
      'exec',
      '-u',
      '0',
      containerId,
      'mv',
      '/usr/bin/pgrep',
      '/usr/bin/pgrep.disabled',
    ]);
    const outcome = handle.completion.catch((error: unknown) => error);
    handle.kill();
    expect(await outcome).toBeInstanceOf(Error);
  }, 10000);

  it('preserves Bash output and exit status through the cancellation wrapper', async () => {
    const result = await runtime.process.exec(['/bin/bash', '-c', 'printf payload; exit 7']);
    expect(result).toEqual({ stdout: 'payload', stderr: '', exitCode: 7 });
  });

  it('leaves intentionally backgrounded work alive after normal completion', async () => {
    const started = Date.now();
    const result = await runtime.process.exec([
      'sh',
      '-c',
      'node /fixture/child.cjs background >/dev/null 2>&1 &',
    ]);
    expect(result.exitCode).toBe(0);
    expect(Date.now() - started).toBeLessThan(1800);
    expect(await alive(await childPid('background'))).toBe(true);
  });
});
