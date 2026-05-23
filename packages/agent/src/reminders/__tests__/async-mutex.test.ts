import { describe, it, expect } from 'vitest';
import { AsyncMutex } from '../async-mutex';

describe('AsyncMutex', () => {
  it('serializes concurrent acquisitions', async () => {
    const mutex = new AsyncMutex();
    const events: string[] = [];

    const a = mutex.runExclusive(async () => {
      events.push('a-start');
      await new Promise((r) => setTimeout(r, 20));
      events.push('a-end');
    });
    const b = mutex.runExclusive(async () => {
      events.push('b-start');
      await new Promise((r) => setTimeout(r, 10));
      events.push('b-end');
    });

    await Promise.all([a, b]);

    // b must wait for a to finish before starting.
    expect(events).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('releases the lock when the body throws', async () => {
    const mutex = new AsyncMutex();
    await expect(
      mutex.runExclusive(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    // Lock is released; the next acquisition runs immediately.
    let ran = false;
    await mutex.runExclusive(() => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it('returns the body result', async () => {
    const mutex = new AsyncMutex();
    const result = await mutex.runExclusive(() => 42);
    expect(result).toBe(42);
  });

  it('does not propagate a body throw to a concurrently-queued caller', async () => {
    const mutex = new AsyncMutex();
    const a = mutex.runExclusive(async () => {
      throw new Error('boom');
    });
    let bRan = false;
    const b = mutex.runExclusive(async () => {
      bRan = true;
    });
    const [ra] = await Promise.allSettled([a, b]);
    expect(ra.status).toBe('rejected');
    expect(bRan).toBe(true);
  });
});
