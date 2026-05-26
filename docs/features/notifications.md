# Notifications

Lace delivers agent-facing notifications (alarm fires, background job lifecycle,
subagent exit) through a single utility, `injectNotification`, that writes a
`context_injected` durable event with `priority='immediate'`. The conversation
runner picks it up at the next turn boundary as a `role: 'user'` message.

## Shape

All notifications share one wrapper:

```
<notification kind="..." [identifier-attributes]>
body prose
</notification>
```

- `kind`: discriminator (see "Kinds" below).
- Identifier attributes: machine-parseable identifiers (`alarm-id`, `job-id`,
  `subagent-session-id`, `persona`).
- Body: prose, not labeled fields. Lists in body get a short prose preamble plus
  indented bullets. End with the next-step tool-call hint when applicable.

## Kinds

| `kind`            | Identifiers                                | Composer                    |
| ----------------- | ------------------------------------------ | --------------------------- |
| `alarm-fired`     | `alarm-id`                                 | `composeAlarmFiredBody`     |
| `alarm-expired`   | `alarm-id`                                 | `composeAlarmExpiredBody`   |
| `job-completed`   | `job-id`                                   | `composeJobCompletedBody`   |
| `job-failed`      | `job-id`                                   | `composeJobFailedBody`      |
| `job-cancelled`   | `job-id`                                   | `composeJobCancelledBody`   |
| `job-progress`    | `job-id`                                   | `composeJobProgressBody`    |
| `subagent-exited` | `subagent-session-id`, `job-id`, `persona` | `composeSubagentExitedBody` |

## Adding a new kind

1. Add the kind to `NotificationKind` in
   `packages/agent/src/notifications/notification-wrapper.ts`.
2. Add a composer to `packages/agent/src/notifications/composers.ts` returning
   the prose body.
3. Add a snapshot test to
   `packages/agent/src/notifications/__tests__/composers.test.ts`.
4. Call `injectNotification({ kind, identifiers, body })` from the producing
   module.

## Body example

```
<notification kind="job-completed" job-id="job_xyz">
Your background job completed successfully (exit code 0) after 12.3 seconds, writing 15,234 bytes of output. The last line was: "build finished in 5.2s". Call job_output(jobId="job_xyz") to read the full output. To continue this conversation thread, call delegate(resume="job_xyz", prompt="your message").
</notification>
```
