# Incremental transcript catch-up

Jesse approved replacing the routine full transcript reread with durable
per-file catch-up after the indexed identifier repair. The goal is startup work
proportional to new transcript content while retaining recovery of missed FTS
and journal writes. This is separate from publication HTTP 408s and Ada's
unattributed live-turn stall. No Ada deployment is included.

## Approach

Keep JSONL authoritative and the existing SQLite index. Add one ordinary
`transcript_checkpoints` table recording each file's path, device/inode,
successfully processed byte offset and modification time. A checkpoint means
every complete record before that offset has either been indexed as required or
skipped under the existing malformed-record rules. It is not an event sequence
watermark: later successful events cannot conceal an earlier failure.

Full rescans on every start retain today's cost. Advancing from live append
success is unsafe because JSONL, FTS and journal writes are independent; forks
also rely on backfill for journal rows. The chosen approach records progress
only during transactional catch-up. Root owns this design; Sol implements it.

## Behavior

- Discover the existing new and legacy paths, preserving persona attribution. An
  unchanged, fully processed file needs only a checkpoint and metadata check.
  Skip the session's writer transaction and identifier load when none of its
  files needs catch-up.
- For changed files, use the existing per-session immediate SQLite transaction.
  Recheck progress under that lock, open the file, and use its actual identity
  and size. Read from the checkpoint in bounded byte chunks, honoring actual
  bytes read and UTF-8 line boundaries. Bound the pass by the opened size so
  ongoing appends remain for write-through or a later catch-up.
- Commit progress with the existing FTS/journal work. After any required write
  or conversion failure, continue preserving later usable events as today but
  leave the contiguous checkpoint before that failure. A transaction failure
  rolls back progress too. Never advance it from FTS membership alone.
- Preserve valid JSON at unterminated EOF: it may be indexed as today, but the
  checkpoint stays before that record until a newline completes it. A torn final
  record is likewise left for the writer's existing newline repair. Malformed
  newline-terminated records remain skippable. Blank lines and records without a
  usable sequence require no index writes.
- File replacement or shortening restarts that file at zero. A changed
  modification time with size equal to the completed offset also restarts it,
  covering same-size rewrites. Normal writers only append. Arbitrary edits
  inside an existing prefix while simultaneously growing the same inode are
  outside this append-only contract and require an explicit index rebuild.
- New shards and forks start at zero. Missing files retain today's additive
  index behavior. FTS schema rebuild clears checkpoints in the same transaction;
  a fresh database or rebuild remains the full-repair path. No new CLI, daemon,
  archive, runtime option or retry mechanism.

## Validation

Prove unchanged files are not read and do not acquire a writer transaction;
prove appends read only their suffix. Cover independent journal and FTS gaps,
crash/transaction rollback, UTF-8/chunk boundaries, valid and torn EOF records,
replacement/shortening, mixed shards, forks, competing backfills and schema
rebuild. Use real temporary files and SQLite, deterministic interleavings, and
the preserved populated corpus. Compare final FTS/journal contents with the
existing completed baseline. Keep all earlier measurements. Two independent Sol
reviews must accept the final change before landing.
