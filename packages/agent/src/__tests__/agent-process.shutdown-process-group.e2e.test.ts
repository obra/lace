// ABOUTME: E2E reproduction of jc's PRI-3243 orphan finding: a subagent
// ABOUTME: process killed the way the parent actually kills it must take its
// ABOUTME: detached bash command tree (foreground pipeline AND background
// ABOUTME: children) down with it, inside the parent's real kill window.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
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

// Mirrors job-control.ts's killJob/killAllRunningJobs exactly: SIGTERM the
// process, wait only `waitMs` for it to exit on its own, and SIGKILL it
// outright if it hasn't. That 500ms is a hard deadline on the WHOLE subagent
// process, not just its cleanup step -- a subagent is not itself spawned
// detached (see job-control.ts's comment on the group-kill fallback), so this
// signals its own pid directly, exactly like the real parent-kill path does.
async function killTheWayTheParentDoes(
  proc: { pid?: number; kill: (signal: NodeJS.Signals) => boolean; exitCode: number | null },
  waitMs = 500
): Promise<void> {
  proc.kill('SIGTERM');
  if (proc.exitCode !== null) return;
  await Promise.race([
    new Promise<void>((resolve) => {
      const onExit = () => resolve();
      // @ts-expect-error -- proc is a real ChildProcess at the call site.
      proc.once('exit', onExit);
    }),
    new Promise<void>((resolve) => setTimeout(resolve, waitMs)),
  ]);
  if (proc.exitCode === null) {
    proc.kill('SIGKILL');
  }
}

describe(
  'a subagent process killed the way the parent kills it reaps its own bash process groups (E2E)',
  {
    timeout: E2E_TEST_TIMEOUT_MS,
  },
  () => {
    const ctx = createE2EContext({ prefix: 'lace-agent-shutdown-pgroup' });

    beforeEach(() => ctx.setup());
    afterEach(() => ctx.teardown());

    it('killing the agent process the way job-control.ts kills a subagent leaves neither the pipeline nor its background child alive', async () => {
      // jc's repro: "after the parent group-SIGTERMs, then SIGKILLs, a
      // detached 'subagent' running bash -c 'sleep 417 | cat', one sleep
      // survives under init," and separately: "the 500ms window is shorter
      // than the bash tool's 2s self-reap." This test reproduces both shapes
      // together against a real lace-agent process (this harness's spawned
      // agent IS that "subagent" from the orphan's point of view -- it's the
      // process whose own shutdown() has to do the reaping) and kills it with
      // the SAME timing the parent actually uses (job-control.ts's killJob:
      // SIGTERM, wait only 500ms, then SIGKILL) -- not an unbounded wait,
      // which would hide exactly the race jc found.
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

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
      await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      );

      const trapPidFile = path.join(ctx.workDir, 'pri-3243-trap-pid');
      const bgPidFile = path.join(ctx.workDir, 'pri-3243-bg-pid');

      // Two orphan shapes in one command:
      // 1. A plain `&` background child (not setsid'd, so it stays in the
      //    foreground command's process group unless something reaps it).
      // 2. A foreground pipeline whose first stage traps (ignores) SIGTERM
      //    (so a plain group SIGTERM alone wouldn't kill it -- the SIGKILL
      //    escalation has to actually fire) piped to `cat`, a second
      //    pipeline member distinct from the /bin/bash process the bash tool
      //    spawns directly -- the classic orphan target from #413's own repro.
      const command =
        `(sleep 300 & echo $! > ${bgPidFile}); ` +
        `sh -c 'trap "" TERM; echo $$ > ${trapPidFile}; exec sleep 300' | cat`;

      // Fire-and-forget: this tool call is never expected to return a normal
      // result in this test -- we kill the agent process out from under it.
      // Swallow the eventual rejection (the peer closes once the agent
      // process exits) so it doesn't show up as an unhandled rejection.
      ctx.agent.peer
        .requestWithId('session/prompt', {
          content: [{ type: 'text', text: `run: ${command}` }],
        })
        .result.catch(() => undefined);

      async function readPid(pidFile: string): Promise<number> {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          if (fs.existsSync(pidFile)) {
            const raw = fs.readFileSync(pidFile, 'utf8').trim();
            if (raw) {
              const pid = Number.parseInt(raw, 10);
              if (Number.isInteger(pid)) return pid;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error(`no pid written to ${pidFile}`);
      }

      const [trapPid, bgPid] = await Promise.all([readPid(trapPidFile), readPid(bgPidFile)]);
      expect(isAlive(trapPid)).toBe(true);
      expect(isAlive(bgPid)).toBe(true);

      // Kill the agent process the way the parent actually does: SIGTERM,
      // wait only 500ms, then SIGKILL if it's still running. This must NOT
      // be sent to the process group (only to the agent's own pid): a
      // subagent is not itself spawned detached, and the detached bash
      // command is the leader of a DIFFERENT process group anyway -- it's
      // only reachable via the agent's own shutdown() reaping it, not by
      // widening the blast radius of this signal.
      const killStart = Date.now();
      await killTheWayTheParentDoes(ctx.agent.proc, 500);

      await withTimeout(
        new Promise<void>((resolve, reject) => {
          if (ctx.agent!.proc.exitCode !== null) {
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
      // deadline to actually land, then confirm both descendants are
      // actually dead -- not merely reparented to init.
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(isAlive(trapPid)).toBe(false);
      expect(isAlive(bgPid)).toBe(false);
      // Sanity check on the repro itself: this has to have exercised the
      // parent's real 500ms-ish deadline, not an unbounded wait that would
      // let a slow, correct-on-paper reap hide the timing race jc found.
      expect(killElapsed).toBeLessThan(500 + 4_000);
    });
  }
);
