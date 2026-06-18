// ABOUTME: Child script spawned by the seq concurrency/crash tests. Appends `count`
// ABOUTME: durable events to a session via appendDurableEvent, or (in --reserve-only mode)
// reserves a single seq WITHOUT appending and exits non-zero — simulating a crash in the
// reserve-before-append window. Run with `node --import tsx _seq-append-child.ts ...`.
// LACE_DIR must be set in the environment so the transcript tree resolves to the test dir.
import { appendDurableEvent } from '../event-log';
import { reserveSeq } from '../seq-head';
import { deriveNextEventSeqAcrossSessionFiles } from '../event-log';
import { getLaceDir } from '../../config/lace-dir';
import * as path from 'node:path';

function main(): void {
  const args = process.argv.slice(2);
  const sessionDir = args[0];
  if (!sessionDir) {
    console.error('usage: _seq-append-child <sessionDir> <count> [--reserve-only]');
    process.exit(2);
  }

  if (args.includes('--reserve-only')) {
    // Crash-injection: advance the head (reserve a seq) and die BEFORE appending
    // the JSONL line. Reserve-before-append means the reserved seq is burned (a
    // gap), never written, never a duplicate.
    const sessionId = path.basename(sessionDir);
    const laceDir = getLaceDir();
    reserveSeq(sessionDir, () => deriveNextEventSeqAcrossSessionFiles(laceDir, sessionId) - 1);
    // Hard-exit nonzero to mimic a crash after the reserve, before the append.
    process.exit(1);
  }

  const count = Number(args[1]);
  if (!Number.isInteger(count) || count <= 0) {
    console.error(`bad count: ${args[1]}`);
    process.exit(2);
  }

  let state = { nextEventSeq: 1, nextStreamSeq: 1 };
  for (let i = 0; i < count; i++) {
    const { nextState } = appendDurableEvent(sessionDir, state, {
      type: 'message',
      data: { type: 'message', from: `pid${process.pid}`, i },
    });
    state = nextState;
  }
  process.exit(0);
}

main();
