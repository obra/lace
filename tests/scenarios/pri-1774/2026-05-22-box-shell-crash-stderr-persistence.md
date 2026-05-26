# Scenario: box-shell delegate crash — stderr persistence + child_exit propagation

PRI-1774 smoke scenario for bugs #1 (child_exit not propagating to job state)
and #2 (per-job stderr persistence regression).

## Trigger

In Ada's sen-core (or any embedder running lace with the bounded host runtime
work merged), call:

```
delegate(persona='box-shell', prompt='echo hello', cwd='/scratch')
```

The subagent will spawn into the `sen-box` persona container, exec lace-agent,
and (until bug #3 is fixed) crash within ~500ms on a `PersonaContainerSpecError`
while resolving its own persona.

## Expected post-fix behavior (this commit)

- `<sessionDir>/jobs/job_<id>.log` contains a `[SUBAGENT CHILD EXITED]` block
  with `exitCode: 1` and the captured stderr (~749 bytes).
- The job transitions to `failed` state within seconds — `jobs_list` reflects
  it; `job_output` returns the persisted stderr; `job_notify` subscribers wake.
- `delegate` returns/fails fast instead of hanging for 10 minutes.

## Expected pre-fix behavior (what Ada observed)

- `<sessionDir>/jobs/job_<id>.log` empty (no per-job stderr persistence).
- `jobs_list` shows `running` indefinitely until manual kill.
- `job_output` returns empty.
- `agent.log` shows
  `job.subagent.child_exit jobId=... exitCode=1 stderrLength=749` but no other
  follow-up.

## Verifying the fix on Ada

After deploying:

```bash
docker exec ada-sen-v2 bash -c "ls -la /var/sen/instance/history/lace/agent-sessions/<sess>/jobs/ | tail"
docker exec ada-sen-v2 cat /var/sen/instance/history/lace/agent-sessions/<sess>/jobs/<jobId>.log
```

The `[SUBAGENT CHILD EXITED]` block must be present. The stderr inside
identifies the actual mount-resolution error for bug #3.

## Implementation summary

`subagentProc.onExit` in `packages/agent/src/jobs/subagent-job.ts` now:

1. Calls `persistSubagentChildExit` (new helper in `subagent-exit-handler.ts`)
   to append a `[SUBAGENT CHILD EXITED]` block — including signal, exitCode, and
   stderr — to `job.outputPath` synchronously.
2. Calls `childPeer.close()` so any in-flight RPC awaits reject with `'Closed'`
   (via `JsonRpcPeer.client.rejectAllPendingRequests`). That trips the catch
   block in `runSubagentJobProcess`, which sets `job.status = 'failed'` and
   reaches the `finally` block where `finalizeJob` transitions the durable event
   log, emits `job_finished`, and fans out `job_notify` subscribers.

A `teardownInitiated` flag prevents the persistence path from firing on the
normal SIGTERM-during-cleanup exit that follows a successful prompt.

## History

| Date       | Run by     | Layer       | Result                                                                                                                                                                                                                                                                                                                                         |
| ---------- | ---------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-22 | Bot        | unit        | `subagent-child-exit.test.ts` 4/4 pass against `subagent-exit-handler` helper                                                                                                                                                                                                                                                                  |
| 2026-05-22 | Bot        | integration | `subagent-job-child-exit-propagation.test.ts` 1/1: mocked spawn + simulated child crash → `finalizeJob` called with `status='failed'`, per-job .log contains `[SUBAGENT CHILD EXITED]` block + persisted stderr                                                                                                                                |
| 2026-05-22 | Ada (live) | live smoke  | `job_6a759d33-...` ran box-shell delegate post-deploy. Failed in 0.3s with `job-failed` notification fired. `.log` 1592 bytes, fully populated with `[SUBAGENT CHILD EXITED]` + `Cannot find module '/lace/packages/agent/dist/main.js'`. `job_output` returns the persisted text. Ada confirmed in #bot-debugging thread `1779483281.490559`. |

## Known gotchas / Fail criteria

- If a future change makes `subagent-spawn`'s `onExit` listener fire BEFORE
  `childPeer` is constructed (e.g. an inline error path), `childPeer?.close()`
  is a no-op and the pending RPC won't reject — but in that case the spawn
  itself failed and the setup-catch branch already handles persistence.
- `persistSubagentChildExit` is sync-only by design (appendFileSync) so the
  diagnostic lands even if the event loop is later stalled.
- Bug #3 is NOT resolved by this commit. Once stderr is persisted, the contents
  of that stderr drive the bug #3 investigation.
