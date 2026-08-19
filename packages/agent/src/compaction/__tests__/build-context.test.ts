// ABOUTME: Tests for buildCompactionContext — binds ctx.query to oneShotQuery and threads guidance
// ABOUTME: Verifies prompt→messages mapping, model defaulting, guidance passthrough, and connection guard

import { describe, it, expect, vi } from 'vitest';
import { buildCompactionContext, buildCompactionContextForConnection } from '../build-context';

describe('buildCompactionContext', () => {
  const BASE_OPTS = {
    threadId: 'thread-1',
    sessionDir: '/tmp/session',
    connectionId: 'conn-abc',
    modelId: 'claude-3-5-sonnet',
  };

  it('returns ctx with guidance set when provided', () => {
    const ctx = buildCompactionContext({ ...BASE_OPTS, guidance: 'focus on errors' });
    expect(ctx.guidance).toBe('focus on errors');
  });

  it('returns ctx with guidance undefined when not provided', () => {
    const ctx = buildCompactionContext(BASE_OPTS);
    expect(ctx.guidance).toBeUndefined();
  });

  it('ctx.query({prompt}) calls oneShotQuery with connectionId, default modelId, and mapped messages', async () => {
    const fakeOneShotQuery = vi.fn().mockResolvedValue({ text: 'result', usage: undefined });
    const ctx = buildCompactionContext(BASE_OPTS, { oneShotQuery: fakeOneShotQuery });

    const result = await ctx.query!({ prompt: 'hello world' });

    expect(result).toEqual({ text: 'result', usage: undefined });
    expect(fakeOneShotQuery).toHaveBeenCalledWith({
      connectionId: 'conn-abc',
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'hello world' }],
      signal: undefined,
    });
  });

  it('ctx.query({prompt, model}) overrides the default modelId', async () => {
    const fakeOneShotQuery = vi.fn().mockResolvedValue({ text: 'ok', usage: undefined });
    const ctx = buildCompactionContext(BASE_OPTS, { oneShotQuery: fakeOneShotQuery });

    await ctx.query!({ prompt: 'test', model: 'cheap-model' });

    expect(fakeOneShotQuery).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'cheap-model' })
    );
  });

  it('ctx.query({messages}) passes non-empty messages through directly (bypassing prompt mapping)', async () => {
    const fakeOneShotQuery = vi.fn().mockResolvedValue({ text: 'ok', usage: undefined });
    const ctx = buildCompactionContext(BASE_OPTS, { oneShotQuery: fakeOneShotQuery });

    const messages = [
      { role: 'user' as const, content: 'a' },
      { role: 'assistant' as const, content: 'b' },
    ];
    await ctx.query!({ messages });

    expect(fakeOneShotQuery).toHaveBeenCalledWith(expect.objectContaining({ messages }));
  });

  it('ctx.query({messages: []}) treats empty messages as no-messages and falls back to prompt', async () => {
    const fakeOneShotQuery = vi.fn().mockResolvedValue({ text: 'ok', usage: undefined });
    const ctx = buildCompactionContext(BASE_OPTS, { oneShotQuery: fakeOneShotQuery });

    await ctx.query!({ messages: [], prompt: 'fallback prompt' });

    expect(fakeOneShotQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'fallback prompt' }],
      })
    );
  });

  it('forwards AbortSignal to oneShotQuery', async () => {
    const fakeOneShotQuery = vi.fn().mockResolvedValue({ text: 'ok', usage: undefined });
    const ctx = buildCompactionContext(BASE_OPTS, { oneShotQuery: fakeOneShotQuery });
    const signal = new AbortController().signal;

    await ctx.query!({ prompt: 'x', signal });

    expect(fakeOneShotQuery).toHaveBeenCalledWith(expect.objectContaining({ signal }));
  });

  it('ctx has threadId and sessionDir set', () => {
    const ctx = buildCompactionContext(BASE_OPTS);
    expect(ctx.threadId).toBe('thread-1');
    expect(ctx.sessionDir).toBe('/tmp/session');
  });

  it('ctx.referenceTimestamp defaults to a valid ISO date string', () => {
    const ctx = buildCompactionContext(BASE_OPTS);
    expect(typeof ctx.referenceTimestamp).toBe('string');
    expect(Number.isNaN(Date.parse(ctx.referenceTimestamp!))).toBe(false);
  });

  it('ctx.referenceTimestamp is preserved when caller supplies it', () => {
    const ctx = buildCompactionContext({
      ...BASE_OPTS,
      referenceTimestamp: '2026-06-19T00:00:00.000Z',
    });
    expect(ctx.referenceTimestamp).toBe('2026-06-19T00:00:00.000Z');
  });

  it('ctx.query is absent when connectionId is falsy', () => {
    const ctx = buildCompactionContext({ ...BASE_OPTS, connectionId: undefined });
    expect(ctx.query).toBeUndefined();
  });

  it('ctx.query is absent when modelId is falsy', () => {
    const ctx = buildCompactionContext({ ...BASE_OPTS, modelId: undefined });
    expect(ctx.query).toBeUndefined();
  });

  it('ctx.query is absent when both connectionId and modelId are absent', () => {
    const ctx = buildCompactionContext({
      threadId: 'thread-1',
      sessionDir: '/tmp/session',
    });
    expect(ctx.query).toBeUndefined();
  });

  it('ctx.query is present when both connectionId and modelId are provided', () => {
    const fakeOneShotQuery = vi.fn().mockResolvedValue({ text: 'ok', usage: undefined });
    const ctx = buildCompactionContext(BASE_OPTS, { oneShotQuery: fakeOneShotQuery });
    expect(ctx.query).toBeDefined();
  });

  it('forwards contextWindow so the strategy can size its tail (PRI-2906)', () => {
    const ctx = buildCompactionContext({ ...BASE_OPTS, contextWindow: 200_000 });
    expect(ctx.contextWindow).toBe(200_000);
  });

  it('buildCompactionContextForConnection resolves the window and threads it in', async () => {
    // The composition is the unit under test. Before this existed, the resolve
    // and the build were two lines repeated in each RPC handler, and deleting
    // the window from either one passed the entire suite.
    const resolveContextWindow = vi.fn().mockResolvedValue(750_000);
    const ctx = await buildCompactionContextForConnection(BASE_OPTS, {
      oneShotQuery: vi.fn(),
      resolveContextWindow,
    });
    expect(resolveContextWindow).toHaveBeenCalledWith({
      connectionId: BASE_OPTS.connectionId,
      modelId: BASE_OPTS.modelId,
    });
    expect(ctx.contextWindow).toBe(750_000);
  });

  it('buildCompactionContextForConnection omits the window when it cannot be resolved', async () => {
    const ctx = await buildCompactionContextForConnection(BASE_OPTS, {
      oneShotQuery: vi.fn(),
      resolveContextWindow: vi.fn().mockResolvedValue(undefined),
    });
    expect('contextWindow' in ctx).toBe(false);
    // Everything else still arrives — a failed window lookup must not cost the
    // caller its query binding or its guidance.
    expect(ctx.query).toBeDefined();
    expect(ctx.threadId).toBe(BASE_OPTS.threadId);
  });

  it('omits contextWindow rather than forwarding undefined', () => {
    // exactOptionalPropertyTypes: a present-but-undefined key and an absent one
    // are different to a strategy that checks `in`, and the fallback path keys
    // on absence.
    const ctx = buildCompactionContext(BASE_OPTS);
    expect('contextWindow' in ctx).toBe(false);
  });
});
