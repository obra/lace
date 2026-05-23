// ABOUTME: Per-session async mutex via Promise-chain serialization.
// ABOUTME: Mirrors the runExclusive pattern in server.ts but standalone so the
// ABOUTME: reminders scheduler can own one without coupling to AgentServerState.

export class AsyncMutex {
  private tail: Promise<unknown> = Promise.resolve();

  /**
   * Run `work` after every previously-queued caller has completed.
   * Resolves with the body's return value; rejects with the body's error
   * (and releases the lock either way).
   */
  async runExclusive<T>(work: () => T | Promise<T>): Promise<T> {
    const previous = this.tail;
    let release: () => void;
    const ticket = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tail = ticket;
    try {
      await previous;
      return await work();
    } finally {
      release!();
    }
  }
}
