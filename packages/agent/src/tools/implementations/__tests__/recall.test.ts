// ABOUTME: Tests for the `recall` built-in tool skeleton (Phase 6.1).
// ABOUTME: Validates registration, schema, and stubbed action methods.

import { describe, it, expect } from 'vitest';
import { RecallTool } from '../recall';
import { ToolExecutor, LACE_BUILTIN_TOOL_NAMES } from '@lace/agent/tools/executor';
import type { ToolContext } from '@lace/agent/tools/types';

function makeCtx(): ToolContext {
  return { signal: new AbortController().signal } as ToolContext;
}

describe('RecallTool registration', () => {
  it('is included in LACE_BUILTIN_TOOL_NAMES', () => {
    expect(LACE_BUILTIN_TOOL_NAMES).toContain('recall');
  });

  it('is registered by registerAllAvailableTools', () => {
    const executor = new ToolExecutor();
    executor.registerAllAvailableTools();
    const tool = executor.getTool('recall');
    expect(tool).toBeDefined();
    expect(tool).toBeInstanceOf(RecallTool);
    expect(tool!.name).toBe('recall');
  });
});

describe('RecallTool schema', () => {
  const tool = new RecallTool();

  it('accepts a valid search input', () => {
    expect(() => tool.schema.parse({ action: 'search', query: 'x' })).not.toThrow();
  });

  it('accepts a valid read input', () => {
    expect(() => tool.schema.parse({ action: 'read', event_id: 'evt_1' })).not.toThrow();
  });

  it('accepts search with all optional fields', () => {
    expect(() =>
      tool.schema.parse({
        action: 'search',
        query: 'hello',
        persona: ['ada', 'bea'],
        session_id: 's1',
        since: '2026-01-01',
        until: '2026-12-31',
        limit: 25,
      })
    ).not.toThrow();
  });

  it('accepts read with context and full', () => {
    expect(() =>
      tool.schema.parse({ action: 'read', event_id: 'evt_1', context: 5, full: true })
    ).not.toThrow();
  });

  it('rejects an unknown action', () => {
    expect(() => tool.schema.parse({ action: 'bogus' })).toThrow();
  });

  it('rejects search without a query', () => {
    expect(() => tool.schema.parse({ action: 'search' })).toThrow();
  });

  it('rejects search with an empty query', () => {
    expect(() => tool.schema.parse({ action: 'search', query: '' })).toThrow();
  });

  it('rejects read without event_id', () => {
    expect(() => tool.schema.parse({ action: 'read' })).toThrow();
  });

  it('rejects limit above max', () => {
    expect(() => tool.schema.parse({ action: 'search', query: 'x', limit: 1000 })).toThrow();
  });

  it('rejects context above max', () => {
    expect(() => tool.schema.parse({ action: 'read', event_id: 'e', context: 1000 })).toThrow();
  });
});

describe('RecallTool stubbed execute', () => {
  it('search action throws not implemented', async () => {
    const tool = new RecallTool();
    await expect(tool.execute({ action: 'search', query: 'x' }, makeCtx())).rejects.toThrow(
      /not implemented/
    );
  });

  it('read action throws not implemented', async () => {
    const tool = new RecallTool();
    await expect(tool.execute({ action: 'read', event_id: 'x' }, makeCtx())).rejects.toThrow(
      /not implemented/
    );
  });
});
