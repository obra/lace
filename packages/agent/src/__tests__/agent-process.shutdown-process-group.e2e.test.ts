// ABOUTME: E2E reproduction of jc's PRI-3243 orphan findings: a subagent
// ABOUTME: process killed the way the parent actually kills it must take its
// ABOUTME: detached bash command tree down with it -- both a background `&`
// ABOUTME: child left behind by a bash call that already returned (finding
// ABOUTME: #1) and a SIGTERM-ignoring pipeline stage (finding #2's original
// ABOUTME: repro) -- inside the parent's real kill window.

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
      // which would hide exactly the race jc found. Spawned `detached` here
      // the same way `subagent-spawn.ts` spawns a real subagent -- a
      // non-detached test agent would make killJob's group kill a no-op
      // that falls back to a direct kill of one pid, which isn't the real
      // path and is exactly the gap jc's finding #4 flagged in this test.
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
      await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      );

      const trapPidFile = path.join(ctx.workDir, 'pri-3243-trap-pid');
      const bgPidFile = path.join(ctx.workDir, 'pri-3243-bg-pid');

      // Two orphan shapes, both backgrounded so the bash TOOL CALL ITSELF
      // returns right away -- this is what finding #1 needs: a background
      // job left running by a bash call that has ALREADY returned, so the
      // group-empty check has to see past the shell's own exit rather than
      // riding its completion.
      // 1. A plain `&` background child (not setsid'd, so it stays in the
      //    foreground command's process group unless something reaps it) --
      //    jc's own finding #1 repro shape (`sleep 302 & echo $! > bg`).
      // 2. A SIGTERM-ignoring pipeline, ALSO backgrounded with `&` so it
      //    doesn't block the tool call either, piped to `cat` (a second
      //    pipeline member distinct from the /bin/bash process the bash tool
      //    spawns directly) -- the classic orphan target from #413's own
      //    repro, needing the SIGKILL escalation since a plain SIGTERM alone
      //    can't touch it.
      // Each backgrounded descendant explicitly redirects its own stdout AND
      // stderr away from the pipe the agent reads bash output over -- an
      // inherited, unredirected fd held open by a backgrounded descendant
      // would keep that pipe from ever reaching EOF, hanging the tool call
      // itself (a background-job variant of the stdin-pipe hang PRI-3243's
      // other half already fixed; see shell-job.ts's own `/dev/null` note).
      const command =
        `(sleep 300 >/dev/null 2>&1 & echo $! > ${bgPidFile}); ` +
        `(sh -c 'trap "" TERM; echo $$ > ${trapPidFile}; exec sleep 300' 2>/dev/null | cat >/dev/null 2>&1 &)`;

      // Awaited, not fire-and-forget: both orphans are backgrounded, so this
      // tool call -- and the whole turn -- completes normally on its own,
      // well before we kill the agent below. That's the shape finding #1
      // needs: the bash call has already returned by the time we act.
      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: `run: ${command}` }],
        }),
        10_000,
        'session/prompt (backgrounds both orphans and returns)'
      );

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

      // Kill the agent process the way the parent actually does it: the
      // real job-control.ts `killJob`, SIGTERM-ing the agent's process
      // GROUP, waiting only 500ms, then SIGKILLing the group if it's still
      // running. The agent is this test's "subagent" from the orphan's
      // point of view, and it's spawned `detached` above for exactly this
      // reason: that's what gives the group kill something of the agent's
      // own to hit at all. It still doesn't reach the detached bash
      // command's tree -- that command is the leader of a DIFFERENT,
      // disjoint process group one level further down, only reachable via
      // the agent's own shutdown() reaping it, not by widening the blast
      // radius of the parent's signal.
      const killStart = Date.now();
      await killJob(jobStateForRealKill(ctx.agent.proc), { waitMs: 500, forceKill: true });

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
