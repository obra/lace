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

  probeHttpStatus: number | undefined;

  protected override supportsHealthProbe(): boolean {
    return this.probeSupported;
  }

  protected override healthProbe(): Promise<void> | null {
    if (!this.probeSupported) return null;
    this.probeCalls += 1;
    if (this.apiIsUp) return Promise.resolve();
    if (this.probeHttpStatus !== undefined) {
      // The server answered — a revoked key, a proxy that only forwards
      // /v1/messages, a 429. Reachable, just unhappy.
      const httpErr = new Error(`probe: HTTP ${this.probeHttpStatus}`) as Error & {
        status: number;
      };
      httpErr.status = this.probeHttpStatus;
      return Promise.reject(httpErr);
    }
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

    // Measure the STEADY-STATE rate, after the exponential ramp has hit the
    // cap. Counting the first hour cannot distinguish a capped schedule from an
    // uncapped one: pure doubling from 5s also lands ~9 probes in hour one.
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    const afterFirstHour = p.probeCalls;
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    const inSecondHour = p.probeCalls - afterFirstHour;

    // An hour at the 5-minute cap is 12 probes. Written as a literal on
    // purpose: deriving it from OUTAGE_PROBE_MAX_INTERVAL_MS would move both
    // sides of the assertion together, so raising the cap could not fail this
    // test — which is exactly the hole a mutation found in the first version.
    expect(inSecondHour).toBeGreaterThanOrEqual(11);
    expect(inSecondHour).toBeLessThanOrEqual(13);
    expect(OUTAGE_PROBE_MAX_INTERVAL_MS).toBe(300_000);
  });

  it('does not turn a flapping provider into thousands of prompt re-sends', async () => {
    // The nastiest real outage shape: /v1/models answers fine while the real
    // endpoint keeps 5xx-ing. Riding this out must never cost more full
    // re-sends than the ordinary retry budget would have.
    const p = provider();
    p.apiIsUp = true; // probe always healthy
    p.operationFails = true; // real request never recovers
    const promise = p.run();
    const settled = promise.then(
      () => 'resolved',
      () => 'rejected'
    );

    await vi.advanceTimersByTimeAsync(OUTAGE_BUDGET_MS + 60_000);

    expect(await settled).toBe('rejected');
    // The pre-fix implementation reset the attempt counter on every successful
    // probe and made ~8,000 full-prompt attempts here.
    expect(p.operationCalls).toBeLessThanOrEqual(10);
  });

  it('treats a probe that gets an HTTP answer as proof the provider is reachable', async () => {
    // A revoked key or a proxied baseURL that only forwards /v1/messages makes
    // the probe fail forever. That must not be read as a six-hour outage.
    const p = provider();
    p.probeHttpStatus = 401;
    const promise = p.run();
    const settled = promise.then(
      () => 'resolved',
      () => 'rejected'
    );

    // Well short of the 6h budget: each probe answers immediately, so the
    // attempt budget runs out in minutes rather than hours.
    await vi.advanceTimersByTimeAsync(30 * 60_000);

    expect(await settled).toBe('rejected');
    // Failed on the real error's attempt budget rather than waiting out the
    // outage budget — a handful of probes, not the ~72 a 6h wait would take.
    expect(p.probeCalls).toBeLessThan(15);
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
      (err: Error) => err
    );

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1_000);

    const result = await settled;
    expect(result).toBeInstanceOf(Error);
    // Specifically an abort — not the budget error arriving early, which a
    // bare "did it reject" assertion would happily accept.
    expect((result as Error).name).toBe('AbortError');
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
