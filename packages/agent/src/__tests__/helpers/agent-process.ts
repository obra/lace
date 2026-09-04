// ABOUTME: Spawns a real lace-agent child process over stdio for the E2E tests
// ABOUTME: and gives them a request timeout guard plus an orderly shutdown.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';

/**
 * Budget for the FIRST request to a freshly spawned agent (`initialize`).
 *
 * `spawnAgentProcess` returns as soon as `spawn()` does, so this budget has to
 * cover the child's entire cold boot before the round trip even starts: node
 * startup, importing the whole `dist` module graph, `loadPlugins()`, and
 * `runStartupReaper()`'s container-runtime probe. The agent only wires its
 * JSON-RPC peer after all of that (see `boot()` in src/main.ts), so a slow boot
 * looks exactly like a hung request.
 *
 * Measured on a 16-core box, spawn to `initialize` response: ~0.4s for a lone
 * agent, p50 1.1s / max 1.2s with 16 booting at once, p50 3.3s / max 3.6s with
 * 48 — which is what the E2E files and their subagent children produce when
 * vitest runs them in parallel. The hard-coded 2s budgets these call sites used
 * to carry were sized for an idle machine and blew nondeterministically under
 * suite load. This is deliberately far above the measured worst case: it exists
 * to catch an agent that never answers, not to police boot latency.
 */
export const AGENT_BOOT_TIMEOUT_MS = 30_000;

/**
 * Budget for a whole E2E test that spawns a real agent child.
 *
 * These tests inherited vitest's 5s default `testTimeout`, which is the same
 * mistake AGENT_BOOT_TIMEOUT_MS documents, one layer up: the budget has to cover
 * the child's cold boot before any of the test's own work starts. At the 48-way
 * concurrency a fully parallel `vitest run` produces, boot alone costs p50 3.3s /
 * max 3.6s, so most of the 5s was gone before the first RPC.
 *
 * The number is derived from the guards it has to contain, not from observed
 * durations. Every request in these tests is already wrapped in a `withTimeout`
 * whose label says what hung; the longest of those is AGENT_BOOT_TIMEOUT_MS
 * (30s). For that guard to ever fire — and for a failure to say "initialize" and
 * not the useless "Test timed out" — the surrounding test budget must be
 * strictly larger than it, with room for the RPCs that follow the boot. 60s is
 * double the largest inner guard and roughly four times the slowest E2E test
 * observed under full parallelism (13s). Like the inner guards, it exists to
 * catch a test that will never finish, not to police how long one takes.
 */
export const E2E_TEST_TIMEOUT_MS = 60_000;

/**
 * Budget for waiting on a delegate/subagent job to reach `job_finished`.
 *
 * A delegate job spawns a *second* lace-agent process, so this wait contains an
 * entire additional cold boot — the same p50 3.3s / max 3.6s at 48-way
 * concurrency — before the subagent does any work of its own. The 10-15s these
 * call sites carried was sized as if the job were boot-free, and it blew under
 * suite load the same way the 2s `initialize` budgets did. Sized to match
 * AGENT_BOOT_TIMEOUT_MS: one cold boot plus real work, far above the measured
 * worst case, and still under E2E_TEST_TIMEOUT_MS so this guard fires first and
 * names what it was waiting for.
 *
 * Waits on plain *shell* jobs deliberately keep their smaller budgets — they
 * spawn no agent, so they have no boot to absorb.
 */
export const SUBAGENT_JOB_TIMEOUT_MS = 30_000;

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
