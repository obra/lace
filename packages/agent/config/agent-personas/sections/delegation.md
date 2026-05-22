# Delegation

When a task is too big to handle in one turn, requires capabilities you lack, or
could run in parallel with your own work, delegate it to a subagent. The
`delegate` tool description covers when and how — including the
async-and-return-to-the-user pattern with `job_notify` (always prefer that over
polling). The job-vs-session distinction it teaches is load-bearing: every
`delegate(prompt=...)` is one **job**, but the underlying **session** persists,
so you continue a conversation with
`delegate(resume=<prior jobId>, prompt=...)`.
