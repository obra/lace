# Recall text nomination repair

Spec: `docs/superpowers/specs/2026-11-10-recall-text-nominations.md`.

Global constraints: keep Qdrant and SQLite authority; minimal separate changes;
preserve all runs; root owns architecture; Sol implementation and two independent
reviews; serial heavy work; qualify latency and actual answers before deployment.

1. **Implement bounded text nominations.** Change `automatic.ts` and meaningful
   memory tests; reuse the scratch match table and existing passage interfaces.
   Demonstrate a failing real-SQLite test before the fix, then run focused
   automatic-recall/scratch tests. Update `docs/architecture/automatic-memory.md`.
   Do not change semantic retrieval, model/provider policy, or ranking storage.
2. **Prepare the paired evaluation.** Reuse the native populated-index scenario
   and cataloged delivered-answer tool. Accept a fresh question file without
   changing frozen seed seals. Freeze four unseen answer cases. Resolve the
   small seed's inability to exercise the cutoff before claiming quality.
   Capture input/build hashes and original baseline `5504c2f`; no old cell reuse.
3. **Review and qualify.** Obtain two independent reviews of the patch and
   evaluation method. Run focused checks and the full relevant suite once;
   serialize populated latency/concurrent-worker and fresh answer comparisons.
   Compare evidence, grade actual delivery, inspect traces, interview completed
   cells privately, and have both reviewers challenge the conclusions.
4. **Land and deploy only qualified work.** Merge the small Lace repair, update
   the Sen pin and affected evergreen docs, verify exact CI/merge identities,
   and use the existing guarded Reeve-only rollout. Confirm healthy runtime,
   retained memories, root-only recall, and a real fresh recall after deployment.
   If qualification fails, preserve it and repair only an evidenced cause.
