// ABOUTME: Ensures ToolExecutor can run tools without context.agent coupling
// ABOUTME: Verifies toolTempRoot -> toolTempDir wiring for tools that require temp dirs

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { Tool } from './tool';
import { ToolExecutor } from './executor';
import type { ToolContext, ToolResult } from './types';

class TempDirProbeTool extends Tool {
  name = 'temp_dir_probe';
  description = 'Asserts that ToolExecutor provided toolTempDir';
  schema = z.object({});

  protected async executeValidated(
    _args: Record<string, never>,
    context: ToolContext
  ): Promise<ToolResult> {
    const toolTempDir = this.getToolTempDir(context);
    return this.createResult(toolTempDir);
  }
}

describe('ToolExecutor ToolContext (no agent)', () => {
  it('creates toolTempDir from toolTempRoot when executing a tool', async () => {
    const toolTempRoot = mkdtempSync(join(tmpdir(), 'lace-tool-temp-root-'));
    try {
      const executor = new ToolExecutor();
      const tool = new TempDirProbeTool();
      executor.registerTool(tool.name, tool);

      const context: ToolContext = {
        signal: new AbortController().signal,
        workingDirectory: toolTempRoot,
        toolTempRoot,
      };

      const result = await executor.execute(
        { id: 'call-1', name: tool.name, arguments: {} },
        context
      );

      expect(result.status).toBe('completed');
      expect(result.content[0]?.type).toBe('text');
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain(toolTempRoot);
      expect(text).toContain('tool-call-call-1');
    } finally {
      rmSync(toolTempRoot, { recursive: true, force: true });
    }
  });
});
