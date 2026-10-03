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
 * `killJob`/`killAllRunningJobs` in job-control.ts, which group-kills a
 * subagent — `process.kill(-pid, ...)` — rather than signaling its pid
 * directly; subagents ARE themselves spawned detached (`subagent-spawn.ts`)
 * specifically so that group-kill has a group of the subagent's own to hit)
 * reaches the agent process itself but NOT the detached command tree: the
 * bash tool's spawn made that command the leader of a THIRD group, disjoint
 * from the subagent's own, so the parent's signal never arrives there at
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
 *
 * ## Why entries are removed lazily, not on the shell's own completion
 *
 * An earlier version of this module untracked a pgid as soon as the ONE
 * pid bash.ts spawned directly (the shell) exited — driven off that
 * process's own completion promise. That's wrong: a plain `cmd &`
 * backgrounds a grandchild that outlives the shell. The shell's completion
 * promise resolves (it returned immediately once the background job was
 * launched), so the entry got untracked, and `killAllTrackedProcessGroups`
 * then has no idea the group — still containing that live background
 * child — even exists. The bug wasn't limited to that one case: ANY
 * survivor in the group (a background job, a trap, a pipeline stage)
 * outlives the shell's own exit, so "the shell exited" was never a sound
 * proxy for "the group is empty."
 *
 * The only sound signal that a group is actually gone is probing the group
 * itself (`groupIsEmpty`, below) — never a completion promise for one
 * member of it. So a tracked pgid is removed ONLY once `groupIsEmpty(pgid)`
 * is observed true: when the shell bash.ts spawned exits
 * (`releaseProcessGroupIfEmpty`, which covers every command that leaves
 * nothing behind), opportunistically whenever a new pgid is tracked, and
 * again during `killAllTrackedProcessGroups`'s sweep, after the
 * SIGTERM/SIGKILL escalation has had its chance to empty the group out.
 * That keeps the map from growing without bound over the life of a
 * long-running agent process without ever trusting a false "done" signal.
 *
 * A pgid whose group still has live members can't be reused by the OS for
 * something unrelated. A pgid whose group has emptied CAN be: once its last
 * member exits, the kernel may hand the number to a new process, and if
 * that process becomes a group leader (a detached spawn, `setsid`, a
 * job-control shell) before this registry notices the old group is gone,
 * the shutdown reap would signal an unrelated group. Releasing on the
 * shell's exit closes that window for commands that leave nothing behind.
 * It stays open, briefly, for a group whose last background job exits
 * later: that entry lingers until the next sweep.
 *
 * ## Background jobs do not survive an agent restart
 *
 * The reap runs on every `shutdown()` path in main.ts (SIGTERM, SIGINT,
 * stdin end), for the root agent as well as subagents. A `cmd &` or
 * `nohup cmd &` started by a finished bash call is still in its tracked
 * group, so it is killed when the agent shuts down, including when a
 * supervisor restarts the agent by SIGTERMing its pid. Work that must
 * outlive the agent belongs in a background job (`job_start`), or must
 * leave the group itself (`setsid`).
 *
 * ## Shutting down
 *
 * The reap is a one-time snapshot, and `shutdown()` does not abort the
 * running turn, so a bash call can start after the reap has run (the next
 * call in a multi-tool batch, say). Its group would be tracked but never
 * reaped. So the first `killAllTrackedProcessGroups` call puts the registry
 * into a shutting-down state, and from then on `trackProcessGroup` SIGKILLs
 * the new group on the spot instead of tracking it.
 *
 * ## Known gap: an unresponsive subagent's groups are orphaned
 *
 * The reap only runs if the subagent can run its own SIGTERM handler inside
 * the parent's 500ms window. If the subagent is stopped (SIGSTOP), or its
 * event loop is blocked past about 350ms, the parent's group SIGKILL lands
 * before the reap does, and every tracked group is orphaned to init: the
 * in-flight command and any `&` jobs left by finished calls. The detached
 * groups are outside the subagent's own group, so that SIGKILL never
 * reaches them. This is a regression over the pre-detach behavior, where
 * those processes shared the subagent's group and died with it. Repro:
 * SIGSTOP a detached subagent that has a tracked group, then run the real
 * `killJob`. Fixing it is a design change (the parent learns the child's
 * pgids, or the subagent becomes a subreaper via prctl); see
 * https://github.com/obra/lace/issues/419.
 */

const tracked = new Set<number>();
let shuttingDown = false;

/**
 * Drop any tracked pgid whose group has already fully emptied out. Safe to
 * call at any time; a no-op for any pgid that still has a live member.
 */
function sweepEmptyGroups(): void {
  for (const pid of tracked) {
    if (groupIsEmpty(pid)) {
      tracked.delete(pid);
    }
  }
}

/**
 * Register a detached command's pid (which, on POSIX, is also its process
 * group id) for cleanup on shutdown.
 *
 * There is deliberately no "untrack on completion" here (see the module doc
 * above): the shell bash.ts spawns can exit while a background child (`cmd
 * &`) it launched keeps running in the same group, and that survivor is
 * exactly what `killAllTrackedProcessGroups` needs to still know about. A
 * pgid is only ever removed once its group is observed empty — opportunistically
 * here (so the map doesn't grow across the life of the agent process for
 * pgids that emptied out long ago and were never swept), and, more
 * importantly, inside `killAllTrackedProcessGroups` itself after its kill
 * escalation.
 */
export function trackProcessGroup(pid: number): void {
  if (shuttingDown) {
    // The reap has already run (see "Shutting down" in the module doc), so
    // nothing would ever signal this group. The agent is exiting; there is
    // no grace period left to give it.
    killGroup(pid, 'SIGKILL');
    return;
  }
  sweepEmptyGroups();
  tracked.add(pid);
}

/**
 * Drop `pid`'s entry if its group is already empty. bash.ts calls this when
 * the shell it spawned exits, so a command that leaves nothing behind
 * doesn't keep a stale pgid tracked (see the module doc on pid reuse). A
 * group that still has a live member, such as a `cmd &` job, stays tracked.
 */
export function releaseProcessGroupIfEmpty(pid: number): void {
  if (groupIsEmpty(pid)) {
    tracked.delete(pid);
  }
}

/** Test/introspection only: how many process groups are currently tracked. */
export function trackedProcessGroupCount(): number {
  return tracked.size;
}

/** Test only: forget every tracked group and leave the shutting-down state. */
export function resetProcessGroupRegistryForTest(): void {
  tracked.clear();
  shuttingDown = false;
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
 * A pgid is removed from the registry once this sweep observes its group
 * empty (see the module doc above for why that observation — never a
 * completion promise for one member — is the only sound removal signal). A
 * SIGKILL is not synchronous, so a survivor that needed the SIGKILL
 * escalation may still show up as non-empty for a moment after this
 * function returns; it will be swept out on the NEXT call (another kill
 * sweep, or the next `trackProcessGroup`), so the registry still can't grow
 * without bound.
 *
 * The first call puts the registry into its shutting-down state, so any
 * group tracked afterwards is killed at once (see the module doc).
 *
 * Safe to call with nothing tracked (no-op) and safe to call more than once.
 */
export async function killAllTrackedProcessGroups(graceMs = DEFAULT_GRACE_MS): Promise<void> {
  shuttingDown = true;
  sweepEmptyGroups();

  const pids = [...tracked];
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
      if (groupIsEmpty(pid)) {
        tracked.delete(pid);
      }
    })
  );
}
