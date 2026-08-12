// ABOUTME: Maintains a turn-active flag file so host-side deploy tooling can
// ABOUTME: see "an agent turn is in flight" without talking to the RPC socket.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface TurnBeaconOptions {
  /** Absolute path of the flag file (conventionally $LACE_DIR/turn-active). */
  flagPath: string;
  /** Whether a turn is currently running. Sampled on every beat. */
  isTurnActive: () => boolean;
  /** Beat interval in milliseconds. */
  intervalMs: number;
}

export interface TurnBeacon {
  /** Start the periodic beat. Idempotent. */
  start(): void;
  /** Stop the periodic beat and leave the flag as-is. Idempotent. */
  stop(): void;
  /**
   * One immediate beat with an explicit state, for raising the flag
   * synchronously at turn start instead of waiting out the interval.
   */
  beat(active: boolean): void;
}

/**
 * The flag protocol: file present AND recently touched = a turn is running.
 * Readers must treat a stale mtime (older than a few beat intervals) as NOT
 * busy — a crashed process leaves the file behind, and staleness is what
 * makes that safe. That is also why this is a heartbeat rather than a
 * write-once marker, and why nothing here needs a boot-time cleanup.
 *
 * Every write is wrapped: the beacon is observability for deploy tooling,
 * never load-bearing for the agent, so a filesystem error must not crash or
 * even log-spam the process.
 */
export function createTurnBeacon(opts: TurnBeaconOptions): TurnBeacon {
  let timer: NodeJS.Timeout | null = null;

  const beat = (active: boolean): void => {
    try {
      if (active) {
        mkdirSync(path.dirname(opts.flagPath), { recursive: true });
        // Rewritten (not just touched) every beat: the changing updatedAt is
        // what lets tests prove the heartbeat is really refreshing the file.
        writeFileSync(opts.flagPath, `{"updatedAt":${Date.now()}}\n`, 'utf8');
      } else {
        rmSync(opts.flagPath, { force: true });
      }
    } catch {
      // Best-effort by design; see doc comment.
    }
  };

  return {
    start(): void {
      if (timer) return;
      timer = setInterval(() => beat(opts.isTurnActive()), opts.intervalMs);
      timer.unref?.();
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    beat,
  };
}

/**
 * Canonical per-process flag path: $LACE_DIR/turn-active.d/<pid>. Extracted so
 * tests can pin the invariant that distinct processes get distinct files —
 * a shared path would let an idle process unflag a busy sibling.
 */
export function turnFlagPathForProcess(laceDir: string, pid: number): string {
  return path.join(laceDir, 'turn-active.d', String(pid));
}
