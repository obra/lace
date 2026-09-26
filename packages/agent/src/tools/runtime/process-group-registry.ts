// ABOUTME: Tracks detached foreground process groups spawned by the bash tool
// ABOUTME: so a killed/shut-down agent process can take them down with it (PRI-3243)

/**
 * The foreground bash tool (`bash.ts`) spawns its command `detached: true` on
 * POSIX so an abort/timeout can reach a whole pipeline (e.g. `sleep | cat`)
 * instead of orphaning everything but the shell itself. That detachment makes
 * the spawned command the leader of its OWN new process group — a group
 * distinct from the agent process's own group.
 *
 * That means a signal aimed at the agent process (e.g. the parent's
 * `killJob`/`killAllRunningJobs` in job-control.ts, which SIGTERMs a subagent
 * process directly — subagents are not themselves spawned detached, so the
 * group-kill form of that signal has nothing to hit and falls back to a
 * direct kill of the subagent's own pid) reaches the agent process itself but
 * NOT the detached command tree: it never arrives at that separate group at
 * all. If the agent process then exits — whether from that signal or any
 * other shutdown path — the detached tree is simply reparented to init with
 * no one left to signal it. It runs forever.
 *
 * The fix is not a signal-propagation trick (there is no signal that reaches
 * a disjoint process group); it's for the agent process to proactively kill
 * every process group it spawned, itself, before it exits. This module is
 * the tracking side of that: `bash.ts` registers each detached child's pid
 * here when it starts a command, and `main.ts`'s `shutdown()` calls
 * `killAllTrackedProcessGroups()` to reap every survivor before
 * `process.exit`.
 *
 * That reap has to fit inside the window the PARENT gives the subagent
 * process before giving up on cooperation entirely: `killJob` /
 * `killAllRunningJobs` (job-control.ts, invoked from `rpc/handlers/jobs.ts`'s
 * direct job-kill RPC and `rpc/handlers/session.ts`'s session-close path)
 * SIGTERM the subagent, wait only `waitMs: 500`, and then SIGKILL it outright
 * if it hasn't exited by then — a hard deadline on the WHOLE subagent
 * process, not just this cleanup step. A first attempt at this fix gave the
 * SIGTERM→SIGKILL escalation below a 2-second grace period; a TERM-ignoring
 * descendant would still be mid-poll when the parent's SIGKILL ended the
 * subagent process outright, abandoning the detached group exactly as before
 * — the reap has to be fast, not just eventually-correct.
 * `DEFAULT_GRACE_MS` is deliberately far under that 500ms deadline, with
 * headroom for signal-delivery and poll-loop latency, so the escalation
 * `shutdown()` runs reliably finishes with time to spare.
 */

const tracked = new Map<number, number>();

/**
 * Register a detached command's pid (which, on POSIX, is also its process
 * group id) for cleanup on shutdown. Returns an unregister function — callers
 * should invoke it once the command's own completion is known so the map
 * doesn't accumulate entries for the life of the agent process.
 *
 * `completion` is accepted (and used internally to drive the unregister
 * timing bash.ts wants) but killAllTrackedProcessGroups deliberately does NOT
 * rely on it to decide whether a GROUP is dead: `completion` only resolves
 * when this one tracked pid (the shell bash.ts spawned directly) exits, and
 * that process is typically the first thing a plain SIGTERM kills — while a
 * TERM-ignoring descendant it forked (a trap, or a pipeline stage) can survive
 * in the same group. Treating "this one process exited" as "the group is
 * gone" is exactly the bug this module exists to avoid, so liveness is polled
 * against the group itself instead (see groupIsEmpty).
 */
export function trackProcessGroup(pid: number, completion: Promise<unknown>): () => void {
  tracked.set(pid, pid);
  const untrack = () => {
    if (tracked.get(pid) === pid) {
      tracked.delete(pid);
    }
  };
  void completion.then(untrack, untrack);
  return untrack;
}

/** Test/introspection only: how many process groups are currently tracked. */
export function trackedProcessGroupCount(): number {
  return tracked.size;
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  if (process.platform === 'win32') return;
  try {
    process.kill(-pid, signal);
  } catch {
    // ESRCH (already gone) or the pid was never a group leader (shouldn't
    // happen — we only ever track pids from detached spawns). Either way,
    // there is nothing else to signal for this entry.
  }
}

/**
 * Whether ANY process is still alive in the group led by `pid`. A signal of
 * 0 to a negative pid probes group membership without actually signaling
 * anything: ESRCH means the group is completely empty; any other outcome
 * (success, or an error other than ESRCH such as EPERM) means at least one
 * member is still alive.
 */
function groupIsEmpty(pid: number): boolean {
  if (process.platform === 'win32') return true;
  try {
    process.kill(-pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// See the module doc above for why this has to stay far under the parent's
// 500ms kill-vs-SIGKILL deadline (job-control.ts's `killJob`/
// `killAllRunningJobs`, both called with `waitMs: 500`).
const DEFAULT_GRACE_MS = 150;

/**
 * SIGTERM every currently-tracked process group, poll for up to `graceMs` for
 * each to fully empty out, then SIGKILL any group that still has a survivor.
 * A well-behaved group typically empties out well before `graceMs` elapses
 * (the poll loop below returns as soon as it does); `graceMs` only bounds how
 * long a TERM-ignoring survivor gets before the SIGKILL escalation fires.
 *
 * Deliberately does not trust a tracked entry's own `completion` promise to
 * mean the GROUP is empty — only the group-membership probe (`groupIsEmpty`)
 * does, since completion resolves when the one tracked pid exits, and a
 * descendant it forked (a trap, or a pipeline stage) can be left alive in the
 * same group — exactly the survivor jc's orphan repro depends on. Declaring
 * victory the moment the named pid's own exit event fires would skip the
 * SIGKILL that survivor needs.
 *
 * Safe to call with nothing tracked (no-op) and safe to call more than once.
 */
export async function killAllTrackedProcessGroups(graceMs = DEFAULT_GRACE_MS): Promise<void> {
  const pids = [...tracked.values()];
  if (pids.length === 0) return;

  for (const pid of pids) {
    killGroup(pid, 'SIGTERM');
  }

  const deadline = Date.now() + graceMs;
  const pollIntervalMs = 10;

  await Promise.all(
    pids.map(async (pid) => {
      while (Date.now() < deadline && !groupIsEmpty(pid)) {
        await sleep(pollIntervalMs);
      }
      if (!groupIsEmpty(pid)) {
        killGroup(pid, 'SIGKILL');
      }
    })
  );
}
