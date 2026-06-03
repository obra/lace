// ABOUTME: End-to-end test for the file-outline-plugin example.
// ABOUTME: Loads through the real loader into real registries, exercises real
// ABOUTME: file outline extraction on temp fixture files — no mocks.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPlugins, registries, resetRegistriesForTest } from '@lace/agent/plugins';
import { registerBuiltinTools } from '@lace/agent/tools/builtins';
import { ToolExecutor } from '@lace/agent/tools/executor';
import type { ToolContext } from '@lace/agent/tools/types';

// Resolves relative to loader.ts (src/plugins/loader.ts) — same pattern as the
// whole-system integration test.
const PLUGIN_SPEC = './__examples__/file-outline-plugin';

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    signal: new AbortController().signal,
    ...overrides,
  };
}

// ── Fixture source ────────────────────────────────────────────────────────────

const FIXTURE_SOURCE = `
// A comment at the top

export interface Shape {
  area(): number;
}

interface InternalMarker {
  tag: string;
}

export type ColorName = string;

type InternalAlias = number | string;

export enum Direction {
  Up,
  Down,
  Left,
  Right,
}

export const MAX_SIZE = 1024;

const internalConst = 'hidden';

export async function computeArea(width: number, height: number): Promise<number> {
  return width * height;
}

function helperFn(x: number) {
  return x * 2;
}

export class Rectangle implements Shape {
  private width: number;
  private height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  public area(): number {
    return this.width * this.height;
  }

  public scale(factor: number): Rectangle {
    return new Rectangle(this.width * factor, this.height * factor);
  }

  protected validate(): boolean {
    return this.width > 0 && this.height > 0;
  }
}

class InternalHelper {
  public doWork(): void {}
}
`.trim();

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('file-outline-plugin — end-to-end', () => {
  let tmpDir: string;
  let fixtureFile: string;

  beforeEach(async () => {
    resetRegistriesForTest();
    registerBuiltinTools(); // built-ins before plugins (dup→fatal)
    await loadPlugins(PLUGIN_SPEC);

    // Create a real temp directory with a real fixture file.
    tmpDir = await mkdtemp(join(tmpdir(), 'file-outline-test-'));
    fixtureFile = join(tmpDir, 'shapes.ts');
    await writeFile(fixtureFile, FIXTURE_SOURCE, 'utf8');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Registry / loader surface ─────────────────────────────────────────────

  it('tool is drawn into a session executor alongside built-ins', () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    expect(ex.getTool('file-outline/outline')).toBeDefined();
    expect(ex.getTool('bash')).toBeDefined(); // built-in still present
  });

  it('owner is recorded as the plugin meta.name', () => {
    expect(registries.tools.owner('file-outline/outline')).toBe('file-outline');
    expect(registries.tools.owner('bash')).toBe('builtin');
  });

  // ── Real behavior: outline extraction ─────────────────────────────────────

  it('extracts all top-level declarations from a fixture file', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('file-outline/outline');
    expect(tool).toBeDefined();

    const result = await tool!.execute({ path: fixtureFile }, makeCtx());
    expect(result.status).toBe('completed');

    const body = JSON.parse(result.content[0].text!);
    expect(body.path).toBe(fixtureFile);
    expect(typeof body.total).toBe('number');
    expect(Array.isArray(body.entries)).toBe(true);

    const names = body.entries.map((e: { name: string }) => e.name);
    // All of these should appear in the outline:
    expect(names).toContain('Shape'); // exported interface
    expect(names).toContain('InternalMarker'); // non-exported interface
    expect(names).toContain('ColorName'); // exported type
    expect(names).toContain('InternalAlias'); // non-exported type alias
    expect(names).toContain('Direction'); // exported enum
    expect(names).toContain('MAX_SIZE'); // exported const
    expect(names).toContain('computeArea'); // exported async function
    expect(names).toContain('helperFn'); // non-exported function
    expect(names).toContain('Rectangle'); // exported class
    expect(names).toContain('InternalHelper'); // non-exported class
  });

  it('correctly identifies exported vs non-exported declarations', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('file-outline/outline');
    expect(tool).toBeDefined();

    const result = await tool!.execute({ path: fixtureFile }, makeCtx());
    const body = JSON.parse(result.content[0].text!);

    const byName = Object.fromEntries(
      body.entries.map((e: { name: string; exported: boolean }) => [e.name, e])
    );

    expect(byName['Shape'].exported).toBe(true);
    expect(byName['InternalMarker'].exported).toBe(false);
    expect(byName['ColorName'].exported).toBe(true);
    expect(byName['InternalAlias'].exported).toBe(false);
    expect(byName['Direction'].exported).toBe(true);
    expect(byName['MAX_SIZE'].exported).toBe(true);
    expect(byName['computeArea'].exported).toBe(true);
    expect(byName['helperFn'].exported).toBe(false);
    expect(byName['Rectangle'].exported).toBe(true);
    expect(byName['InternalHelper'].exported).toBe(false);
  });

  it('includes methods for class entries', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('file-outline/outline');
    expect(tool).toBeDefined();

    const result = await tool!.execute({ path: fixtureFile }, makeCtx());
    const body = JSON.parse(result.content[0].text!);

    const rectangle = body.entries.find((e: { name: string }) => e.name === 'Rectangle');
    expect(rectangle).toBeDefined();
    expect(rectangle.kind).toBe('class');
    expect(Array.isArray(rectangle.methods)).toBe(true);
    // area, scale, validate should appear (constructor is excluded)
    expect(rectangle.methods).toContain('area');
    expect(rectangle.methods).toContain('scale');
    expect(rectangle.methods).toContain('validate');
  });

  it('records correct 1-based line numbers', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('file-outline/outline');
    expect(tool).toBeDefined();

    const result = await tool!.execute({ path: fixtureFile }, makeCtx());
    const body = JSON.parse(result.content[0].text!);

    // Every entry must have a positive integer line number.
    for (const entry of body.entries) {
      expect(typeof entry.line).toBe('number');
      expect(entry.line).toBeGreaterThan(0);
    }

    // The Shape interface appears first in the fixture (after the comment).
    const shape = body.entries.find((e: { name: string }) => e.name === 'Shape');
    const rectangle = body.entries.find((e: { name: string }) => e.name === 'Rectangle');
    expect(shape).toBeDefined();
    expect(rectangle).toBeDefined();
    // Shape must have a lower line number than Rectangle.
    expect(shape.line).toBeLessThan(rectangle.line);
  });

  it('filters to exported_only when requested', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('file-outline/outline');
    expect(tool).toBeDefined();

    const result = await tool!.execute({ path: fixtureFile, exported_only: true }, makeCtx());
    expect(result.status).toBe('completed');
    const body = JSON.parse(result.content[0].text!);

    // Only exported entries should be present.
    for (const entry of body.entries) {
      expect(entry.exported).toBe(true);
    }
    // Non-exported ones must be absent.
    const names = body.entries.map((e: { name: string }) => e.name);
    expect(names).not.toContain('InternalMarker');
    expect(names).not.toContain('InternalAlias');
    expect(names).not.toContain('helperFn');
    expect(names).not.toContain('InternalHelper');
    expect(names).not.toContain('internalConst');
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it('returns an error result for a missing file', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('file-outline/outline');
    expect(tool).toBeDefined();

    const result = await tool!.execute({ path: join(tmpDir, 'does-not-exist.ts') }, makeCtx());
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toMatch(/not found/i);
  });

  it('returns an error result for an unsupported file extension', async () => {
    // Write a Python file to the temp dir.
    const pyFile = join(tmpDir, 'script.py');
    await writeFile(pyFile, 'def main(): pass\n', 'utf8');

    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('file-outline/outline');
    expect(tool).toBeDefined();

    const result = await tool!.execute({ path: pyFile }, makeCtx());
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toMatch(/unsupported file type/i);
  });

  it('resolves a relative path against ctx.workingDirectory', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('file-outline/outline');
    expect(tool).toBeDefined();

    // Pass only the filename; provide tmpDir as the working directory.
    const result = await tool!.execute(
      { path: 'shapes.ts' },
      makeCtx({ workingDirectory: tmpDir })
    );
    expect(result.status).toBe('completed');
    const body = JSON.parse(result.content[0].text!);
    expect(body.entries.length).toBeGreaterThan(0);
  });

  it('returns an empty-entries result for a file with no declarations', async () => {
    const emptyish = join(tmpDir, 'comments-only.ts');
    await writeFile(emptyish, '// just a comment\n// nothing here\n', 'utf8');

    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('file-outline/outline');
    expect(tool).toBeDefined();

    const result = await tool!.execute({ path: emptyish }, makeCtx());
    expect(result.status).toBe('completed');
    const body = JSON.parse(result.content[0].text!);
    expect(body.entries).toEqual([]);
    expect(body.note).toBeDefined();
  });
});
