// ABOUTME: E2E tests for the workspace-stats one-shot-exec tool example.
// ABOUTME: Uses the REAL pipeline: discoverExecToolsSync + ExecToolAdapter.execute (no mocks).
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { discoverExecToolsSync } from '@lace/agent/tools/exec/discover';
import { ExecToolAdapter } from '@lace/agent/tools/exec/exec-tool-adapter';
import type { ToolContext } from '@lace/agent/tools/types';

const EXAMPLES_DIR = path.join(__dirname, '..', '__examples__');

/** Minimal ToolContext sufficient for exec tool invocations */
function makeCtx(persona: string): ToolContext {
  return {
    signal: new AbortController().signal,
    activeSessionId: 'test-session',
    persona,
  };
}

describe('workspace-stats e2e', () => {
  it('discoverExecToolsSync finds the workspace-stats adapter with correct metadata', async () => {
    const adapters = discoverExecToolsSync(EXAMPLES_DIR);
    const adapter = adapters.find((a) => a.name === 'workspace/stats');
    expect(adapter).toBeInstanceOf(ExecToolAdapter);
    expect(adapter!.name).toBe('workspace/stats');
    expect(adapter!.description).toContain('working directory');
    // inputSchema must be a valid object schema
    expect(adapter!.inputSchema.type).toBe('object');
    expect(adapter!.inputSchema.properties).toBeDefined();
    expect(Array.isArray(adapter!.inputSchema.required)).toBe(true);
  });

  it('execute returns a completed result with file stats and echoes persona', async () => {
    // Run against a temp dir with known contents so the test is hermetic
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lace-ws-stats-test-'));
    try {
      await fs.writeFile(path.join(tmpDir, 'alpha.ts'), 'const x = 1;');
      await fs.writeFile(path.join(tmpDir, 'beta.ts'), 'const y = 2;');
      await fs.writeFile(path.join(tmpDir, 'readme.md'), '# hello');

      const adapters = discoverExecToolsSync(EXAMPLES_DIR);
      const adapter = adapters.find((a) => a.name === 'workspace/stats')!;
      expect(adapter).toBeDefined();

      const ctx = { ...makeCtx('researcher'), workingDirectory: tmpDir };
      const result = await adapter.execute({ top_n: 5, max_depth: 2 }, ctx);

      expect(result.status).toBe('completed');
      const text = result.content[0].text ?? '';
      // Output should reference the tmpDir as the workspace
      expect(text).toContain(tmpDir);
      // The persona should appear in the output
      expect(text).toContain('researcher');
      // Should have found our 3 files
      expect(text).toContain('.ts');
      expect(text).toContain('.md');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('context.persona reaches the tool — debug persona shows relative paths, researcher basenames', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lace-ws-stats-persona-'));
    try {
      const subDir = path.join(tmpDir, 'nested');
      await fs.mkdir(subDir);
      await fs.writeFile(path.join(subDir, 'deep-file.txt'), 'content');

      const adapters = discoverExecToolsSync(EXAMPLES_DIR);
      const adapter = adapters.find((a) => a.name === 'workspace/stats')!;

      // researcher persona → basenames only
      const resCtx = { ...makeCtx('researcher'), workingDirectory: tmpDir };
      const resResult = await adapter.execute({ top_n: 5 }, resCtx);
      expect(resResult.status).toBe('completed');
      const resText = resResult.content[0].text ?? '';
      // Basename only — does not contain the 'nested/' prefix
      expect(resText).not.toContain('nested/deep-file.txt');
      expect(resText).toContain('deep-file.txt');

      // debug persona → relative paths
      const dbgCtx = { ...makeCtx('debug'), workingDirectory: tmpDir };
      const dbgResult = await adapter.execute({ top_n: 5 }, dbgCtx);
      expect(dbgResult.status).toBe('completed');
      const dbgText = dbgResult.content[0].text ?? '';
      // Relative path — contains the 'nested/' prefix
      expect(dbgText).toContain('nested/deep-file.txt');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns failed result with stderr when bad input supplied (top_n out of range)', async () => {
    const adapters = discoverExecToolsSync(EXAMPLES_DIR);
    const adapter = adapters.find((a) => a.name === 'workspace/stats')!;

    const result = await adapter.execute({ top_n: 99 }, makeCtx('researcher'));
    expect(result.status).toBe('failed');
    // The error message should surface the stderr text from the tool
    const text = result.content[0].text ?? '';
    expect(text).toContain('top_n');
  });
});
