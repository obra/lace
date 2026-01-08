import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';

export type SpawnedAgent = {
  peer: JsonRpcPeer;
  proc: ChildProcessWithoutNullStreams;
  shutdown: () => Promise<void>;
  stderr: () => string;
};

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function spawnAgentProcess(options: {
  laceDir: string;
  env?: Record<string, string>;
}): SpawnedAgent {
  const agentMainPath = fileURLToPath(new URL('../../../dist/main.js', import.meta.url));
  const agentCwd = fileURLToPath(new URL('../../../', import.meta.url));

  let stderrBuffer = '';

  const proc = spawn(process.execPath, [agentMainPath], {
    cwd: agentCwd,
    env: {
      ...process.env,
      LACE_DIR: options.laceDir,
      // Keep agent-process tests deterministic by default. Specific tests can opt-in
      // to dynamic catalogs by overriding this env var.
      LACE_DISABLE_DYNAMIC_CATALOGS: '1',
      ...(options.env || {}),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (chunk) => {
    stderrBuffer += chunk;
  });

  const transport = createNdjsonStdioTransport({ readable: proc.stdout, writable: proc.stdin });
  const peer = new JsonRpcPeer(transport, { idPrefix: 'c_' });

  const shutdown = async () => {
    if (proc.exitCode !== null) {
      peer.close();
      return;
    }

    // Best-effort: kill any running jobs (especially subagents) before terminating the parent
    // so we don't leave child processes holding files in the temp lace dir.
    const killDeadlineMs = Date.now() + 2_000;
    while (Date.now() < killDeadlineMs) {
      try {
        const jobsResult = (await peer.request('ent/job/list')) as unknown as {
          jobs?: Array<{ jobId: string; status: string }>;
        };

        const running = (jobsResult.jobs ?? []).filter((j) => j.status === 'running');
        if (running.length === 0) break;

        for (const job of running) {
          try {
            await peer.request('ent/job/kill', { jobId: job.jobId });
          } catch {
            // Ignore and retry until deadline
          }
        }
      } catch {
        break;
      }

      await sleep(50);
    }

    proc.kill('SIGTERM');

    await Promise.race([
      new Promise<void>((resolve, reject) => {
        const onExit = () => resolve();
        const onError = (err: unknown) => reject(err);

        proc.once('exit', onExit);
        proc.once('error', onError);
      }),
      sleep(2_000),
    ]);

    if (proc.exitCode === null) {
      proc.kill('SIGKILL');
      await Promise.race([
        new Promise<void>((resolve) => proc.once('exit', () => resolve())),
        sleep(2_000),
      ]);
    }

    peer.close();
  };

  return {
    peer,
    proc,
    shutdown,
    stderr: () => stderrBuffer,
  };
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const guard = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms);
  });

  try {
    return await Promise.race([promise, guard]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
