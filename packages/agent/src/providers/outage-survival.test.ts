// ABOUTME: PRI-2901 — a provider outage must not be ridden out by re-sending
// ABOUTME: the prompt. After a few blip retries the provider switches to a
// ABOUTME: zero-token health probe on exponential backoff (capped), re-issuing
// ABOUTME: the real request only once the API answers again, and gives up after
// ABOUTME: a wall-clock budget so a turn cannot hang forever.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AIProvider,
  type ProviderMessage,
  type ProviderResponse,
  type WireTool,
} from './base-provider';
import {
  OUTAGE_BUDGET_MS,
  OUTAGE_PROBE_AFTER_ATTEMPTS,
  OUTAGE_PROBE_MAX_INTERVAL_MS,
} from './base-provider';

// A provider whose operation and health probe are both scriptable, so a full
// outage-and-recovery can be driven deterministically under fake timers.
class ProbeableProvider extends AIProvider {
  operationCalls = 0;
  probeCalls = 0;
  operationFails = true;
  apiIsUp = false;
  probeSupported = true;

  get providerName(): string {
    return 'probeable';
  }
  get defaultModel(): string {
    return 'test-model';
  }
  get supportsStreaming(): boolean {
    return false;
  }

  protected override healthProbe(): Promise<void> | null {
    if (!this.probeSupported) return null;
    this.probeCalls += 1;
    if (this.apiIsUp) return Promise.resolve();
    const err = new Error('probe: connection refused') as Error & { code: string };
    err.code = 'ECONNREFUSED';
    return Promise.reject(err);
  }

  async createResponse(): Promise<ProviderResponse> {
    throw new Error('unused');
  }

  // Drives the same retry machinery the real providers use.
  run(options?: { signal?: AbortSignal }): Promise<string> {
    return this.withRetry(
      () => {
        this.operationCalls += 1;
        if (this.operationFails) {
          const err = new Error('connection reset') as Error & { code: string };
          err.code = 'ECONNRESET';
          return Promise.reject(err);
        }
        return Promise.resolve('real response');
      },
      { signal: options?.signal }
    );
  }
}

function provider(): ProbeableProvider {
  const p = new ProbeableProvider({ apiKey: 'test-key' });
  p.on('error', () => {});
  p.on('retry_attempt', () => {});
  p.on('retry_exhausted', () => {});
  return p;
}

describe('PRI-2901: provider outage survival', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops re-sending the prompt after the blip retries and probes instead', async () => {
    const p = provider();
    const promise = p.run();
    promise.catch(() => {});

    // Ride well past the point where the old code would have burned all 10
    // attempts re-sending the full request.
    await vi.advanceTimersByTimeAsync(30 * 60_000);

    expect(p.operationCalls).toBe(OUTAGE_PROBE_AFTER_ATTEMPTS);
    expect(p.probeCalls).toBeGreaterThan(5);
  });

  it('re-issues the real request once the probe reports the API is back', async () => {
    const p = provider();
    const promise = p.run();
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(p.operationCalls).toBe(OUTAGE_PROBE_AFTER_ATTEMPTS);

    // Outage ends: the next probe succeeds, the real request is retried, and
    // this time it works.
    p.apiIsUp = true;
    p.operationFails = false;
    await vi.advanceTimersByTimeAsync(OUTAGE_PROBE_MAX_INTERVAL_MS + 1_000);

    await expect(promise).resolves.toBe('real response');
    expect(p.operationCalls).toBe(OUTAGE_PROBE_AFTER_ATTEMPTS + 1);
  });

  it('caps the probe interval so recovery is noticed promptly', async () => {
    const p = provider();
    const promise = p.run();
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(60 * 60_000);
    const probesInOneHour = p.probeCalls;

    // At the 5-minute cap an hour holds ~12 probes; a much larger number means
    // the cap is not being applied, a much smaller one means it backs off past it.
    expect(probesInOneHour).toBeGreaterThan(8);
    expect(probesInOneHour).toBeLessThan(30);
  });

  it('gives up after the wall-clock budget with an accurate error', async () => {
    const p = provider();
    const promise = p.run();
    const settled = promise.then(
      () => 'resolved',
      (err: Error) => err
    );

    await vi.advanceTimersByTimeAsync(OUTAGE_BUDGET_MS + 60_000);

    const result = await settled;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/provider (outage|unavailable)/i);
    // Never resumed re-sending the prompt during the outage.
    expect(p.operationCalls).toBe(OUTAGE_PROBE_AFTER_ATTEMPTS);
  });

  it('aborts promptly when the caller cancels mid-outage', async () => {
    const p = provider();
    const controller = new AbortController();
    const promise = p.run({ signal: controller.signal });
    const settled = promise.then(
      () => 'resolved',
      () => 'rejected'
    );

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await settled).toBe('rejected');
  });

  it('keeps the pre-existing retry behavior when the provider has no probe', async () => {
    const p = provider();
    p.probeSupported = false;
    const promise = p.run();
    const settled = promise.then(
      () => 'resolved',
      () => 'rejected'
    );

    await vi.advanceTimersByTimeAsync(30 * 60_000);

    expect(await settled).toBe('rejected');
    // Exhausted the normal attempt budget rather than entering outage mode.
    expect(p.operationCalls).toBeGreaterThan(OUTAGE_PROBE_AFTER_ATTEMPTS);
    expect(p.probeCalls).toBe(0);
  });
});
