# Indexed transcript identifiers: implementation and private qualification

Spec: `docs/superpowers/specs/2026-11-10-transcript-recall-keys-proposal.md`.
Jesse approved implementation and private testing, including the actual prior
binary compatibility, after the two independent design reviews. Ada deployment
is outside this approval.

## Global constraints

Keep FTS schema version 3, transcript content, journal content, recall results,
and the public API unchanged. One ordinary identifier table in the same
database; no process-wide identifier cache, archive, service, worker pool or
retry policy. Root owns architecture. Sol implements and two independent Sol
agents review. Preserve all runs. Private data stays local. Run one heavy
process at a time, save and read test output, and do not modify any colleague's
runtime or data.

## Task 1: Implement indexed identifiers and behavior regressions

Work in the existing `wip/recall-startup-audit-20261110` worktree. Read the spec
first; its transaction and compatibility requirements are binding.

Add the identifier table and session index beside FTS, with the last examined
FTS rowid in `_meta`. Under the existing immediate transaction, reconcile later
FTS rows before consulting identifiers. Use one SQLite operation to import the
tail rather than materializing the entire index in JavaScript. Existing
duplicate FTS rows stay unchanged. Normal insertion must atomically update FTS,
its key and the marker, including inside a backfill transaction that catches row
failures. A nested transaction/savepoint is suitable; avoid a new transaction
framework. Read session membership after acquiring the write lock. Reset keys
and marker atomically when the existing FTS schema rebuild occurs, without
changing version 3.

Keep changes in `storage/recall/`: `index-db.ts`, `index-writer.ts`,
`backfill.ts`, one focused identifier helper if useful, and their tests. Update
the existing evergreen `docs/features/recall.md` with accurate storage/startup
behavior.

Start with meaningful failing regressions. Exercise real SQLite: existing-row
import; new insertion and duplicate rejection; old-style append while the new
connection stays open; missing transcript events below later sequence numbers;
two connections deterministically interleaved at the read/write-lock boundary;
and failure between FTS and metadata insertion inside an outer transaction.
Verify rebuild resets derived metadata. Do not add stress loops, sleeps, timing
thresholds, tests of rendered SQL text, or test-only production switches. The
actual prior binary and populated measurements are Task 2, not substitutes for
these regressions. Do not change startup scheduling or semantic recall.

Use Node 22.23.3 at `/Users/jesse/.local/share/mise/installs/node/22.23.3/bin`.
Save focused red/green output privately and read it. Run only focused tests
while iterating, then tell root when ready for the serialized full-suite slot.
Root will own the one final full suite and populated measurements. Commit the
focused implementation with normal hooks. No push, merge or deployment in this
task.

## Task 2: Independently review and qualify the frozen populated copy

Root coordinates two independent Sol implementation reviews. Review the exact
diff and tests against the spec, preserving meaningful findings and rulings.
Once focused checks pass, run the final serial full suite and build once.

Use the preserved Ada database and transcript inputs under
`/Users/jesse/.cache/recall-latency.ol1gLr` on a new private copy. Use the
existing `profile-lace-recall-backfill` tool, dry-run first. Preserve the
98.42-second baseline. Measure first import separately from subsequent backfill
and verify search/journal preservation, source hashes, index lookup behavior and
lock cost. Use actual `d0834134` storage code to append to an upgraded test
copy, then verify both a reopened upgraded connection and an upgraded connection
that stayed open. Reuse existing tools or ask Toolsmith; do not create scratch
helper scripts. Finish with a concise evidence report. Do not claim the earlier
live-turn stall or Reeve's remaining semantic-search/HTTP-408 incident is fixed
by this change.
