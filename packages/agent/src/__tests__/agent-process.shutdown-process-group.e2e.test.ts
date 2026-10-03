// ABOUTME: E2E for PRI-3243: a subagent process killed the way the parent
// ABOUTME: kills it (job-control.ts killJob) must take its detached bash
// ABOUTME: command trees down with it inside the parent's real kill window:
// ABOUTME: `&` jobs left by a call that already returned, a TERM-ignoring
// ABOUTME: pipeline killed mid-call, and one still dying after session/cancel.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { killJob } from '../jobs/job-control';
import type { JobState } from '../server-types';
import {
  AGENT_BOOT_TIMEOUT_MS,
  createE2EContext,
  spawnAgentProcess,
  withTimeout,
  defaultInitializeParams,
  E2E_TEST_TIMEOUT_MS,
} from './helpers';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH') throw error;
    return false;
  }
}

// Wraps the spawned agent's real ChildProcess in just enough JobState shape
// to hand to job-control.ts's OWN killJob -- not a hand-rolled approximation
// of it. jobs.ts's job-kill RPC and session.ts's session-close path both call
// killJob with exactly these options (`waitMs: 500, forceKill: true`), so
// calling the real function here is what makes this test exercise the real
// kill path: SIGTERM the process GROUP (job-control.ts's `process.kill(-pid,
// ...)`), wait only `waitMs` for the whole process to exit on its own, then
// SIGKILL the group outright if it hasn't. That group kill only has
// something of the agent's own to hit because the agent is spawned detached
// below, exactly as a real subagent is (`subagent-spawn.ts`).
function jobStateForRealKill(proc: ChildProcess): JobState {
  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  proc.once('exit', () => resolveCompletion());

  return {
    jobId: 'e2e-shutdown-pgroup-test',
    type: 'delegate',
    status: 'running',
    startedAt: new Date().toISOString(),
    outputPath: '/dev/null',
    proc,
    finished: false,
    completion,
    resolveCompletion,
  };
}

describe(
  'a subagent process killed the way the parent kills it reaps its own bash process groups (E2E)',
  {
    timeout: E2E_TEST_TIMEOUT_MS,
  },
  () => {
    const ctx = createE2EContext({ prefix: 'lace-agent-shutdown-pgroup' });

    // Every descendant pid a test records, SIGKILLed after the test whether
    // it passed or not, so a failing run can't leak `sleep 300`s to init.
    const descendantPids: number[] = [];

    beforeEach(() => ctx.setup());
    afterEach(async () => {
      for (const pid of descendantPids.splice(0)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
      await ctx.teardown();
    });

    async function bootDetachedAgent(): Promise<{ sessionId: string }> {
      // Spawned `detached` the same way `subagent-spawn.ts` spawns a real
      // subagent -- a non-detached test agent would make killJob's group
      // kill a no-op that falls back to a direct kill of one pid, which
      // isn't the real path.
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir, detached: true });

      ctx.agent.peer.onRequest('session/update', async () => undefined);
      ctx.agent.peer.onRequest('session/request_permission', async () => ({ decision: 'allow' }));

      await withTimeout(
        ctx.agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'dangerouslySkipPermissions' } })
        ),
        AGENT_BOOT_TIMEOUT_MS,
        'initialize'
      );
      return (await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      )) as { sessionId: string };
    }

    async function readPid(pidFile: string): Promise<number> {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (fs.existsSync(pidFile)) {
          const raw = fs.readFileSync(pidFile, 'utf8').trim();
          if (raw) {
            const pid = Number.parseInt(raw, 10);
            if (Number.isInteger(pid)) {
              descendantPids.push(pid);
              return pid;
            }
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`no pid written to ${pidFile}`);
    }

    // A foreground pipeline whose first stage ignores SIGTERM, so only a
    // SIGKILL ends it, and whose second stage is a separate process from
    // the /bin/bash the tool spawns directly. Both stages write their pids.
    function trapPipelineCommand(trapPidFile: string, catPidFile: string): string {
      return (
        `sh -c 'trap "" TERM; echo $$ > ${trapPidFile}; exec sleep 300' | ` +
        `sh -c 'echo $$ > ${catPidFile}; exec cat >/dev/null'`
      );
    }

    // Kill the agent process the way the parent actually does it: the real
    // job-control.ts `killJob`, SIGTERM-ing the agent's process GROUP,
    // waiting only 500ms, then SIGKILLing the group if it's still running.
    // That signal never reaches the detached bash command's tree -- that
    // command leads a different, disjoint process group, reachable only via
    // the agent's own shutdown() reap. Returns how long the kill took.
    async function killAgentLikeTheParent(): Promise<number> {
      const killStart = Date.now();
      await killJob(jobStateForRealKill(ctx.agent!.proc), { waitMs: 500, forceKill: true });

      await withTimeout(
        new Promise<void>((resolve, reject) => {
          if (ctx.agent!.proc.exitCode !== null || ctx.agent!.proc.signalCode !== null) {
            resolve();
            return;
          }
          ctx.agent!.proc.once('exit', () => resolve());
          ctx.agent!.proc.once('error', reject);
        }),
        5_000,
        'agent process exit after kill'
      );
      const killElapsed = Date.now() - killStart;

      // A bit of grace for a SIGKILL delivered right at the parent's
      // deadline to actually land before the caller checks for survivors.
      await new Promise((resolve) => setTimeout(resolve, 300));
      return killElapsed;
    }

    it('reaps background jobs left by a bash call that already returned', async () => {
      await bootDetachedAgent();

      const trapPidFile = path.join(ctx.workDir, 'pri-3243-trap-pid');
      const bgPidFile = path.join(ctx.workDir, 'pri-3243-bg-pid');

      // Two orphan shapes, both backgrounded so the bash tool call itself
      // returns right away, leaving jobs behind a shell that has already
      // exited:
      // 1. A plain `&` background child (not setsid'd, so it stays in the
      //    command's process group).
      // 2. A SIGTERM-ignoring pipeline stage, also backgrounded, which needs
      //    the reap's SIGKILL escalation.
      // Each backgrounded descendant redirects its own stdout and stderr
      // away from the pipe the agent reads bash output over; an inherited fd
      // held open by a background job would keep the tool call from ever
      // seeing EOF.
      const command =
        `(sleep 300 >/dev/null 2>&1 & echo $! > ${bgPidFile}); ` +
        `(sh -c 'trap "" TERM; echo $$ > ${trapPidFile}; exec sleep 300' 2>/dev/null | cat >/dev/null 2>&1 &)`;

      await withTimeout(
        ctx.agent!.peer.request('session/prompt', {
          content: [{ type: 'text', text: `run: ${command}` }],
        }),
        10_000,
        'session/prompt (backgrounds both orphans and returns)'
      );

      const [trapPid, bgPid] = await Promise.all([readPid(trapPidFile), readPid(bgPidFile)]);
      expect(isAlive(trapPid)).toBe(true);
      expect(isAlive(bgPid)).toBe(true);

      const killElapsed = await killAgentLikeTheParent();

      expect(isAlive(trapPid)).toBe(false);
      // Guards the registry against untracking a group when its shell exits:
      // the shell here exited long before the kill, while bgPid lived on.
      expect(isAlive(bgPid)).toBe(false);
      // The kill has to have run on the parent's real ~500ms deadline, not
      // an unbounded wait that would hide a slow reap.
      expect(killElapsed).toBeLessThan(500 + 4_000);
    });

    it('reaps a TERM-ignoring pipeline killed while its bash call is still in flight', async () => {
      await bootDetachedAgent();

      const trapPidFile = path.join(ctx.workDir, 'pri-3243-inflight-trap-pid');
      const catPidFile = path.join(ctx.workDir, 'pri-3243-inflight-cat-pid');

      // Not awaited: the pipeline runs for 300s, so the turn is still in the
      // middle of this bash call when the agent is killed.
      const { result: promptPromise } = ctx.agent!.peer.requestWithId('session/prompt', {
        content: [{ type: 'text', text: `run: ${trapPipelineCommand(trapPidFile, catPidFile)}` }],
      });
      promptPromise.catch(() => undefined);

      const [trapPid, catPid] = await Promise.all([readPid(trapPidFile), readPid(catPidFile)]);
      expect(isAlive(trapPid)).toBe(true);
      expect(isAlive(catPid)).toBe(true);

      const killElapsed = await killAgentLikeTheParent();

      expect(isAlive(trapPid)).toBe(false);
      expect(isAlive(catPid)).toBe(false);
      expect(killElapsed).toBeLessThan(500 + 4_000);
    });

    it('reaps a TERM-ignoring pipeline still inside its abort grace when the agent is killed after session/cancel', async () => {
      const { sessionId } = await bootDetachedAgent();

      const trapPidFile = path.join(ctx.workDir, 'pri-3243-cancel-trap-pid');
      const catPidFile = path.join(ctx.workDir, 'pri-3243-cancel-cat-pid');

      const { result: promptPromise } = ctx.agent!.peer.requestWithId('session/prompt', {
        content: [{ type: 'text', text: `run: ${trapPipelineCommand(trapPidFile, catPidFile)}` }],
      });

      const [trapPid, catPid] = await Promise.all([readPid(trapPidFile), readPid(catPidFile)]);
      expect(isAlive(trapPid)).toBe(true);

      // Cancel the turn. The bash tool SIGTERMs the pipeline's group, which
      // ends the shell and the cat stage, and arms a SIGKILL 2s later for the
      // TERM-ignoring stage. Kill the agent at ~1500ms, inside that grace:
      // the abort has already settled the call, so only the registry still
      // knows the group exists.
      const cancelledAt = Date.now();
      ctx.agent!.peer.notify('session/cancel', { sessionId });
      const result = (await withTimeout(promptPromise, 10_000, 'session/prompt (cancelled)')) as {
        stopReason: string;
      };
      expect(result.stopReason).toBe('cancelled');

      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, cancelledAt + 1_500 - Date.now()))
      );
      // Sanity check on the repro: the abort's own SIGKILL hasn't fired yet.
      expect(isAlive(trapPid)).toBe(true);

      await killAgentLikeTheParent();

      expect(isAlive(trapPid)).toBe(false);
      expect(isAlive(catPid)).toBe(false);
    });
  }
);
