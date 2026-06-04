// ABOUTME: Tests for buildCompactionContext — binds ctx.query to oneShotQuery and threads guidance
// ABOUTME: Verifies prompt→messages mapping, model defaulting, guidance passthrough, and connection guard

import { describe, it, expect, vi } from 'vitest';
import { buildCompactionContext } from '../build-context';

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
});
