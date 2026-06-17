// ABOUTME: Tests for the read_tool_result paging tool.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadToolResultTool } from '../implementations/read_tool_result';
import { writeToolResultSidecar } from '@lace/agent/storage/tool-result-store';
import type { ToolContext } from '../types';

const TEST_SESSION_ID = 'sess_550e8400-e29b-41d4-a716-446655440000';

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    signal: new AbortController().signal,
    ...overrides,
  };
}

function textOf(result: { content: Array<{ text?: string }> }): string {
  return result.content.map((b) => b.text ?? '').join('');
}

describe('tools/read_tool_result', () => {
  let originalLaceDir: string | undefined;
  let tempDir: string;
  const tool = new ReadToolResultTool();

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    tempDir = mkdtempSync(join(tmpdir(), 'lace-read-tool-result-'));
    process.env.LACE_DIR = tempDir;
  });

  afterEach(() => {
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  function seed(toolCallId: string): string {
    const lines: string[] = [];
    for (let i = 0; i < 1000; i++) lines.push(`line ${i} keyword-${i % 5}`);
    const full = lines.join('\n') + '\n';
    writeToolResultSidecar(TEST_SESSION_ID, toolCallId, full);
    return full;
  }

  it('returns a head slice with a header reporting total bytes/lines', async () => {
    const full = seed('tc_head');
    const result = await tool.execute(
      { tool_call_id: 'tc_head', head_lines: 3 },
      makeContext({ activeSessionId: TEST_SESSION_ID })
    );
    expect(result.status).toBe('completed');
    const text = textOf(result);
    expect(text).toContain('line 0 keyword-0');
    expect(text).toContain('line 2 keyword-2');
    expect(text).not.toContain('line 3 keyword-3');
    expect(text).toContain('1000'); // line count in header
    expect(text).toContain(String(Buffer.byteLength(full, 'utf8'))); // total bytes
  });

  it('returns a tail slice', async () => {
    seed('tc_tail');
    const result = await tool.execute(
      { tool_call_id: 'tc_tail', tail_lines: 2 },
      makeContext({ activeSessionId: TEST_SESSION_ID })
    );
    const text = textOf(result);
    expect(text).toContain('line 999 keyword-4');
    expect(text).toContain('line 998 keyword-3');
    expect(text).not.toContain('line 0 keyword-0');
  });

  it('returns grep matches', async () => {
    seed('tc_grep');
    const result = await tool.execute(
      { tool_call_id: 'tc_grep', grep: 'keyword-0' },
      makeContext({ activeSessionId: TEST_SESSION_ID })
    );
    const text = textOf(result);
    expect(text).toContain('line 0 keyword-0');
    expect(text).toContain('line 5 keyword-0');
    expect(text).not.toContain('keyword-1');
  });

  it('fails clearly (status:failed, no throw) when activeSessionId is absent', async () => {
    seed('tc_nosess');
    const result = await tool.execute({ tool_call_id: 'tc_nosess', head_lines: 1 }, makeContext());
    expect(result.status).toBe('failed');
    expect(textOf(result)).toMatch(/session/i);
  });

  it('fails clearly (status:failed, no throw) when the sidecar is missing', async () => {
    const result = await tool.execute(
      { tool_call_id: 'tc_absent', head_lines: 1 },
      makeContext({ activeSessionId: TEST_SESSION_ID })
    );
    expect(result.status).toBe('failed');
    expect(textOf(result)).toContain('tc_absent');
  });

  it('rejects unknown parameters (strict schema)', async () => {
    const result = await tool.execute(
      { tool_call_id: 'tc_strict', bogus: true },
      makeContext({ activeSessionId: TEST_SESSION_ID })
    );
    expect(result.status).toBe('failed');
  });
});
