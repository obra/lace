// ABOUTME: Tests for the compact_session built-in tool
// ABOUTME: Verifies schema, cell mutation, and "end your turn" instruction in result

import { describe, it, expect } from 'vitest';
import { CompactSessionTool } from '../compact_session';
import type { ToolContext } from '@lace/agent/tools/types';

/** Mirrors what the runner does: seed a mutable compactionRequest cell. */
function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    signal: new AbortController().signal,
    compactionRequest: { requested: false },
    ...overrides,
  } as ToolContext;
}

/** Context without a compactionRequest cell — simulates a runner bug. */
function makeCtxNoCell(): ToolContext {
  return {
    signal: new AbortController().signal,
  } as ToolContext;
}

describe('CompactSessionTool', () => {
  it('has the correct name', () => {
    const tool = new CompactSessionTool();
    expect(tool.name).toBe('compact_session');
  });

  it('schema accepts empty object (no guidance)', async () => {
    const tool = new CompactSessionTool();
    const ctx = makeCtx();
    const result = await tool.execute({}, ctx);
    expect(result.status).toBe('completed');
  });

  it('schema accepts optional guidance string', async () => {
    const tool = new CompactSessionTool();
    const ctx = makeCtx();
    const result = await tool.execute({ guidance: 'keep the bug list' }, ctx);
    expect(result.status).toBe('completed');
  });

  it('schema rejects empty guidance string', async () => {
    const tool = new CompactSessionTool();
    const ctx = makeCtx();
    const result = await tool.execute({ guidance: '' }, ctx);
    expect(result.status).toBe('failed');
  });

  it('schema rejects unknown keys (.strict())', async () => {
    const tool = new CompactSessionTool();
    const ctx = makeCtx();
    const result = await tool.execute({ unknownKey: 'oops' } as Record<string, unknown>, ctx);
    expect(result.status).toBe('failed');
  });

  describe('execute with guidance', () => {
    it('sets ctx.compactionRequest.requested = true and preserves guidance', async () => {
      const tool = new CompactSessionTool();
      const ctx = makeCtx();
      await tool.execute({ guidance: 'focus on open issues' }, ctx);
      expect(ctx.compactionRequest).toEqual({ requested: true, guidance: 'focus on open issues' });
    });

    it('result text instructs model to end its turn', async () => {
      const tool = new CompactSessionTool();
      const ctx = makeCtx();
      const result = await tool.execute({ guidance: 'retain todo list' }, ctx);
      const text = result.content[0].text ?? '';
      expect(text.toLowerCase()).toContain('end your turn');
      expect(text.toLowerCase()).toMatch(/schedul/);
    });

    it('result message has no double space', async () => {
      const tool = new CompactSessionTool();
      const ctx = makeCtx();
      const result = await tool.execute({ guidance: 'keep notes' }, ctx);
      const text = result.content[0].text ?? '';
      expect(text).not.toMatch(/ {2}/); // no double space
    });
  });

  describe('execute without guidance', () => {
    it('sets ctx.compactionRequest = { requested: true } with no guidance key', async () => {
      const tool = new CompactSessionTool();
      const ctx = makeCtx();
      await tool.execute({}, ctx);
      expect(ctx.compactionRequest).toEqual({ requested: true });
    });

    it('result message has no double space', async () => {
      const tool = new CompactSessionTool();
      const ctx = makeCtx();
      const result = await tool.execute({}, ctx);
      const text = result.content[0].text ?? '';
      expect(text).not.toMatch(/ {2}/); // no double space
    });
  });

  it('does NOT itself perform compaction (no side effects beyond cell mutation)', async () => {
    // The tool should not throw or call any compaction strategy — just mutate the cell.
    const tool = new CompactSessionTool();
    const ctx = makeCtx();
    const result = await tool.execute({ guidance: 'keep notes' }, ctx);
    expect(result.status).toBe('completed');
    // Only the cell is mutated; no extra fields beyond content/status.
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
  });

  describe('absent compactionRequest cell (runner bug guard)', () => {
    it('returns a failure result — does not pretend to succeed', async () => {
      const tool = new CompactSessionTool();
      const ctx = makeCtxNoCell();
      const result = await tool.execute({}, ctx);
      expect(result.status).toBe('failed');
    });

    it('does NOT fabricate ctx.compactionRequest', async () => {
      const tool = new CompactSessionTool();
      const ctx = makeCtxNoCell();
      await tool.execute({}, ctx);
      expect(ctx.compactionRequest).toBeUndefined();
    });

    it('failure message explains the problem', async () => {
      const tool = new CompactSessionTool();
      const ctx = makeCtxNoCell();
      const result = await tool.execute({}, ctx);
      const text = result.content[0].text ?? '';
      expect(text.toLowerCase()).toContain('compaction could not be scheduled');
    });
  });

  it('annotations mark it as safeInternal', () => {
    const tool = new CompactSessionTool();
    expect(tool.annotations?.safeInternal).toBe(true);
  });
});
