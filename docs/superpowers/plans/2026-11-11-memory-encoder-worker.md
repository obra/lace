# Memory Encoder Worker Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to
> implement this plan and obtain two independent Sol reviews.

**Goal:** Keep Lace's main thread responsive during the existing local encoder's
loading, tokenization and native inference.

**Architecture:** One lazy Node worker owns the existing encoder and model. The
existing foreground/background scheduler stays in the parent and sends one batch
at a time; this is not a worker pool or a shared service. Jesse approved the
worker proposal on November 11 after the native Linux measurement showed a
1.394-second warm batch with no parent heartbeat.

**Tech Stack:** TypeScript, Node worker_threads, the existing pinned
Transformers/ONNX runtime.

**Spec:** `docs/superpowers/specs/2026-11-10-recall-scheduling-repair.md`
(encoder isolation and validation contract).

## Global Constraints

- Preserve the pinned model, generation, preprocessing, normalization, four-item
  batches, query priority, and explicit text-only fallback.
- Keep cancellation checks in the existing scheduler. Cancelled queued work
  never runs; an active bounded batch finishes and its result is discarded.
- Exactly one model instance in this process, loaded only on the first nonempty
  request. No retry, timeout, pool, new service, public configuration or storage
  transition.
- Model initialization failure remains failed. A worker error or unexpected
  exit, including exit code zero, rejects the pending request and permanently
  fails that encoder. An ordinary individual encode error leaves a healthy
  worker usable.
- Reference the worker while a request is pending and unreference it when idle;
  neither unresolved work nor a lingering idle model should break process exit.
- Preserve compiled agent operation and the existing source-loaded benchmark. No
  new dependency.
- No change to retrieval precision, ranking, automatic subagent recall, Ada
  deployment, or memory extraction settings.
- One heavy check at a time, save every result, keep private inputs private.
  Root owns architecture and rollout.

## Review Focus

1. Worker exit during initialization or inference settles all parent promises
   without retries.
2. Cancelling a queued query or an active batch preserves the existing
   scheduler's behavior.
3. Child process stays alive for pending work and exits naturally after its last
   result.
4. Both built JavaScript and source-loaded TypeScript resolve the real worker
   entry.
5. Real native output is identical while the parent remains responsive; this
   proves responsiveness, not the historical 408's complete cause.

## Task 1: Isolate the encoder without changing its behavior

**Files:** Modify `packages/agent/src/memory/encoder.ts`; add `encoder-model.ts`
for existing model operations and `encoder-worker.ts` for the worker entry.
Extend focused encoder tests and small process fixtures. Update
`docs/architecture/automatic-memory.md`.

**Interfaces:** Preserve the existing `MemoryEncoder`, `localMemoryEncoder`,
directory configuration, model metadata and helper exports. The parent/worker
message contains only a batch of texts and query/document kind, with vectors or
a serialized Error response. A single in-flight request needs no request
registry or multiplexer.

- [ ] Add behavioral RED tests for lazy single-worker ownership, request error
      versus worker death, pending/idle lifetime and actual worker entry
      loading. Use a gated fixture for deterministic blocking; no spin loops or
      timing-based success assertions.
- [ ] Move existing model verification, preprocessing and native operations into
      `encoder-model.ts` without algorithm changes. Re-export existing helpers
      from `encoder.ts` to preserve internal callers. The worker imports model
      operations directly, avoiding a runtime cycle.
- [ ] Keep `scheduledMemoryEncoder` unchanged and replace its local base encoder
      with the lazy worker bridge. Freeze the configured absolute directory on
      first use as today. Resolve the compiled sibling worker directly; source
      execution uses the installed tsx loader explicitly where needed, rather
      than depending on build artifacts.
- [ ] Test the above behaviors plus existing queue priority, cancellation,
      missing assets, token bounds and normalization. Run focused tests,
      typecheck, build and normal hooks, saving output. Update evergreen docs
      and commit only this repair.
- [ ] Obtain two independent Sol reviews of the exact diff. Root decides which
      findings are reachable and within the approved scope; repair real defects
      and retest affected behavior.

## Task 2: Qualify and land

- [ ] Reuse the preserved native Linux model and four-input batch. Compare
      against the pre-change encoder sequentially, checking every embedding
      component and parent heartbeat while native work executes. Verify
      source-loaded operation too. Preserve all receipts and report cold/warm
      phases separately.
- [ ] Run the existing populated retrieval and delivered-answer regression
      appropriate to an unchanged generation; retain failures. Run the full
      Linux suite once on the final reviewed head and inspect CI.
- [ ] Merge the reviewed Lace change and the separately reviewed Sen pin, then
      deploy only to Reeve using the established safe rollout procedure. Check
      process health, recall success, explicit fallback/errors and publication
      behavior. Do not call historical Ada or every 408 resolved without new
      causal evidence.
