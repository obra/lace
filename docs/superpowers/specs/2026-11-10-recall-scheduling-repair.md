# Recall scheduling repair

Jesse requested small, separate fixes for slow semantic search and publication
HTTP 408s, with two independent reviews and a Reeve-only pilot. This proposal
does not change the memory model, ranking, recall allowance or search precision.

## Evidence

A fixed exact query on Reeve took 30.007 seconds in Qdrant. Its observation
window recorded 356 MiB of storage reads, 23.405 seconds of full I/O stall,
1.813 CPU-seconds and no cgroup CPU throttling. A second identical query took
2.003 seconds and read another 43.6 MiB. Cache reclamation is established; which
background work causes it still needs qualification.

A passive loopback capture caught a publication connection opening, Qdrant
returning HTTP 408 before acknowledging any request bytes, and Lace sending the
PUT about 5.23 seconds after connection establishment. This is a delayed client
request, not a timeout while Qdrant applies the publication. The capture reports
dropped packets, but the server's unchanged acknowledgment number establishes
that it had received no request bytes before its response.

Two blocking paths exist in Lace. Pending-vector selection walks the passage
table even when almost every row already has the current generation. Also,
onnxruntime-node defers inference with setImmediate but executes the native
inference call synchronously on that JavaScript thread. A Promise does not make
that native call nonblocking. Their individual contribution to the live stall
has not yet been measured. On the sealed populated copy, the pending selection
returned no rows in 6.86 seconds, with 202,548 SQLite page-cache misses and
982,881 VM steps. That is a measured synchronous stall even with nothing to
encode. A separate native Mac probe with four retained passages took 279 ms for
the warm batch, with no heartbeat opportunity during the call; this does not
quantify native inference on Reeve.

## Separate changes

1. Index pending-vector selection by generation. Seek a generation needing work,
   then select at most four current-source passages by rowid within that
   generation. Preserve source revision guards, encoding batches and yields. A
   caught-up pass must not walk the vector-bearing table. This is an ordinary
   query-plan repair using the existing SQLite storage.
2. Conditional, after measuring the selection-only repair: give the existing
   local encoder one lazy worker thread if native execution still materially
   delays publication. That thread owns model loading, tokenization and
   inference. Keep the existing priority queue and cancellation checks in the
   parent, with one batch in flight. This moves the existing model instance; it
   does not create a pool or a second model copy. Subagent automatic recall
   remains disabled.

If justified and agreed, the worker has the process lifetime of the existing
singleton encoder. It is referenced while a request is pending and unreferenced
when idle. A worker failure rejects the pending request and remains a failed
encoder for that process; the existing text-only fallback applies. Ordinary
per-request errors do not kill a healthy worker. Existing cancellation checks
remain: queued requests with a cancelled signal skip inference, and cancellation
during native inference discards its result after the bounded batch completes.
Maintenance currently has a close guard, not a cancellation signal. No retry,
request timeout or new public API.

## Validation and limits

Preserve the failing observations. Verify selection on a populated private copy
and with revision changes. Measure cold loading and a warm native encoder batch
separately, including synchronous execution time and event-loop delay. For the
proposed thread, test the built worker, identical embeddings, parent
responsiveness during native work, failure, cancellation and process exit.
Verify the documented source-loaded benchmark as well as the compiled agent. Use
the existing populated root-plus-workers and delivered-answer checks for
qualification, one heavy process at a time. Obtain two independent reviews of
each fix and its conclusions before merging and the Reeve-only rollout.

First measure exact search after removing avoidable indexing work. Changing
Qdrant storage placement or approximate search is a separate decision if the
remaining measurements require it. The current exact scan does not establish
acceptable performance for years of history.

Private receipts: `/Users/jesse/.cache/recall-latency.ol1gLr/`.

## Progress

| Work              | Shared boundary / constraint                                           | Status                                                                    |
| ----------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Pending selection | Existing passages table, source guards, four-item batches              | Sol implementation; focused regression failed on the old table scan.      |
| Encoder isolation | Existing serial encoder; no shared implementation files with selection | Conditional; no implementation dispatched.                                |
| Qualification     | Both can affect query responsiveness and shared page cache             | Test selection alone first; do not attribute all symptoms to either path. |

Independent Sol reviews A and B accepted implementation `0f8be6276` and the
populated caught-up measurement. The repaired check used 36 VM steps and 10
SQLite page-cache misses and finished below the timer's 0.01-second resolution.
With four missing vectors at the end of the 196,574-row table, it found those
four rows using 64 VM steps and 15 page-cache misses. The WAL-mode index build
took 7.10 seconds, with 26,874,792 bytes of WAL and about 25.5 MiB of permanent
database growth. The initial build attempt on a read-only clone failed before
writing; that receipt is retained separately from the writable trials.

All 59 focused passage/runtime/publication tests, workspace type checking and
the build passed. Full CI, answer regression and the Reeve-only deployment
remain pending. Both reviews require selection-only live measurements before
proceeding with the worker proposal. Neither claims the observed 408 was caused
by ONNX.
