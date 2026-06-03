// ABOUTME: Tests for the compact_session built-in tool
// ABOUTME: Verifies schema, cell mutation, and "end your turn" instruction in result

import { describe, it, expect } from 'vitest';
import { CompactSessionTool } from '../compact_session';
import type { ToolContext } from '@lace/agent/tools/types';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    signal: new AbortController().signal,
    ...overrides,
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
  });

  describe('execute without guidance', () => {
    it('sets ctx.compactionRequest = { requested: true } with no guidance key', async () => {
      const tool = new CompactSessionTool();
      const ctx = makeCtx();
      await tool.execute({}, ctx);
      expect(ctx.compactionRequest).toEqual({ requested: true });
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

  it('handles absent compactionRequest on ctx gracefully (still returns sensible message)', async () => {
    // At runtime the runner always injects the cell, but the tool must be robust
    // if ctx.compactionRequest is somehow absent.
    const tool = new CompactSessionTool();
    // Pass a ctx without compactionRequest pre-seeded (default makeCtx has none).
    const ctx = makeCtx();
    const result = await tool.execute({}, ctx);
    expect(result.status).toBe('completed');
    const text = result.content[0].text ?? '';
    expect(text.length).toBeGreaterThan(0);
  });

  it('annotations mark it as safeInternal', () => {
    const tool = new CompactSessionTool();
    expect(tool.annotations?.safeInternal).toBe(true);
  });
});
