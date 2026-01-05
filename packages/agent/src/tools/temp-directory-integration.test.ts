// ABOUTME: Integration tests for ToolExecutor temp directory handling
// ABOUTME: Verifies per-call toolTempDir creation under a provided toolTempRoot

import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { setupCoreTest } from '@lace/agent/test-utils/core-test-setup';
import { Tool } from './tool';
import { ToolExecutor } from './executor';
import type { ToolContext, ToolResult } from './types';

class IntegrationTestTool extends Tool {
  name = 'integration_test_tool';
  description = 'Tool for testing ToolExecutor temp directories';
  schema = z.object({
    content: z.string(),
  });

  private capturedContext?: ToolContext;

  protected async executeValidated(
    args: z.infer<typeof this.schema>,
    context: ToolContext
  ): Promise<ToolResult> {
    this.capturedContext = context;
    return this.createResult(`Integration test: ${args.content}`);
  }

  getCapturedContext(): ToolContext | undefined {
    return this.capturedContext;
  }
}

describe('ToolExecutor temp directories', () => {
  const tempLaceDirContext = setupCoreTest();
  let toolExecutor: ToolExecutor;
  let integrationTool: IntegrationTestTool;
  let toolTempRoot: string;

  beforeEach(() => {
    toolExecutor = new ToolExecutor();
    integrationTool = new IntegrationTestTool();
    toolExecutor.registerTool(integrationTool.name, integrationTool);

    toolTempRoot = join(tempLaceDirContext.tempDir, 'tool-temp-root');
    mkdirSync(toolTempRoot, { recursive: true });
  });

  it('creates a per-call toolTempDir under toolTempRoot', async () => {
    const context: ToolContext = {
      signal: new AbortController().signal,
      toolTempRoot,
    };

    await toolExecutor.execute(
      { id: 'test-hierarchy', name: integrationTool.name, arguments: { content: 'test' } },
      context
    );

    const received = integrationTool.getCapturedContext();
    expect(received?.toolTempDir).toBeDefined();
    expect(received!.toolTempDir).toBe(join(toolTempRoot, 'tool-call-test-hierarchy'));
    expect(existsSync(received!.toolTempDir!)).toBe(true);
  });

  it('is stable across ToolExecutor instances (same root, different call IDs)', async () => {
    const context: ToolContext = {
      signal: new AbortController().signal,
      toolTempRoot,
    };

    await toolExecutor.execute(
      { id: 'call-1', name: integrationTool.name, arguments: { content: 'one' } },
      context
    );
    const dir1 = integrationTool.getCapturedContext()!.toolTempDir!;

    const newToolExecutor = new ToolExecutor();
    const newIntegrationTool = new IntegrationTestTool();
    newToolExecutor.registerTool(newIntegrationTool.name, newIntegrationTool);

    await newToolExecutor.execute(
      { id: 'call-2', name: newIntegrationTool.name, arguments: { content: 'two' } },
      context
    );
    const dir2 = newIntegrationTool.getCapturedContext()!.toolTempDir!;

    expect(dir1).not.toBe(dir2);
    expect(dir1).toBe(join(toolTempRoot, 'tool-call-call-1'));
    expect(dir2).toBe(join(toolTempRoot, 'tool-call-call-2'));
  });
});
