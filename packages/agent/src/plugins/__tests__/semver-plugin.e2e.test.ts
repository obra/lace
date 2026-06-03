// ABOUTME: End-to-end test for the semver-plugin example.
// ABOUTME: Loads through the real loader into real registries, exercises all three
// ABOUTME: tools (semver/parse, semver/compare, semver/bump) with real SemVer 2.0.0
// ABOUTME: inputs — no mocks. Covers success paths, error paths, and spec edge cases.

import { describe, it, expect, beforeEach } from 'vitest';
import { loadPlugins, registries, resetRegistriesForTest } from '@lace/agent/plugins';
import { registerBuiltinTools } from '@lace/agent/tools/builtins';
import { ToolExecutor } from '@lace/agent/tools/executor';
import type { ToolContext } from '@lace/agent/tools/types';

// Resolves relative to loader.ts (src/plugins/loader.ts) — same pattern as the
// whole-system integration test.
const PLUGIN_SPEC = './__examples__/semver-plugin';

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    signal: new AbortController().signal,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('semver-plugin — end-to-end', () => {
  beforeEach(async () => {
    resetRegistriesForTest();
    registerBuiltinTools(); // built-ins before plugins (dup→fatal)
    await loadPlugins(PLUGIN_SPEC);
  });

  // ── Registry / loader surface ─────────────────────────────────────────────

  it('all three tools are drawn into a session executor alongside built-ins', () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    expect(ex.getTool('semver/parse')).toBeDefined();
    expect(ex.getTool('semver/compare')).toBeDefined();
    expect(ex.getTool('semver/bump')).toBeDefined();
    expect(ex.getTool('bash')).toBeDefined(); // built-in still present
  });

  it('all three tools have owner recorded as the plugin meta.name', () => {
    expect(registries.tools.owner('semver/parse')).toBe('semver');
    expect(registries.tools.owner('semver/compare')).toBe('semver');
    expect(registries.tools.owner('semver/bump')).toBe('semver');
    expect(registries.tools.owner('bash')).toBe('builtin');
  });

  // ── semver/parse — success paths ──────────────────────────────────────────

  describe('semver/parse', () => {
    it('parses a plain release version', async () => {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/parse')!;

      const result = await tool.execute({ version: '1.2.3' }, makeCtx());
      expect(result.status).toBe('completed');

      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.valid).toBe(true);
      expect(body.major).toBe(1);
      expect(body.minor).toBe(2);
      expect(body.patch).toBe(3);
      expect(body.prerelease).toEqual([]);
      expect(body.buildMetadata).toEqual([]);
      expect(body.isPrerelease).toBe(false);
    });

    it('parses a pre-release version with multiple identifiers', async () => {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/parse')!;

      const result = await tool.execute({ version: '2.0.0-alpha.1' }, makeCtx());
      expect(result.status).toBe('completed');

      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.major).toBe(2);
      expect(body.minor).toBe(0);
      expect(body.patch).toBe(0);
      expect(body.prerelease).toEqual(['alpha', '1']);
      expect(body.isPrerelease).toBe(true);
    });

    it('parses a version with build metadata', async () => {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/parse')!;

      const result = await tool.execute({ version: '3.1.0-rc.2+build.42' }, makeCtx());
      expect(result.status).toBe('completed');

      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.prerelease).toEqual(['rc', '2']);
      expect(body.buildMetadata).toEqual(['build', '42']);
    });

    it('parses version 0.0.0', async () => {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/parse')!;

      const result = await tool.execute({ version: '0.0.0' }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.major).toBe(0);
      expect(body.minor).toBe(0);
      expect(body.patch).toBe(0);
    });

    it('returns an error for an invalid version string', async () => {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/parse')!;

      const result = await tool.execute({ version: '1.2' }, makeCtx());
      expect(result.status).toBe('failed');
      expect(result.content[0].text).toMatch(/not a valid semver/i);
    });

    it('returns an error for a version with leading zeros', async () => {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/parse')!;

      // Leading zeros are forbidden by the SemVer spec
      const result = await tool.execute({ version: '01.2.3' }, makeCtx());
      expect(result.status).toBe('failed');
    });

    it('returns an error for an empty string (Zod validation)', async () => {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/parse')!;

      const result = await tool.execute({ version: '' }, makeCtx());
      expect(result.status).toBe('failed');
    });
  });

  // ── semver/compare — success paths ────────────────────────────────────────

  describe('semver/compare', () => {
    it('returns 0 for equal versions', async () => {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/compare')!;

      const result = await tool.execute({ a: '1.0.0', b: '1.0.0' }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.result).toBe(0);
      expect(body.relationship).toBe('a == b');
    });

    it('returns -1 when a < b (major)', async () => {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/compare')!;

      const result = await tool.execute({ a: '1.0.0', b: '2.0.0' }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.result).toBe(-1);
      expect(body.relationship).toBe('a < b');
    });

    it('returns 1 when a > b (patch)', async () => {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/compare')!;

      const result = await tool.execute({ a: '1.0.1', b: '1.0.0' }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.result).toBe(1);
      expect(body.relationship).toBe('a > b');
    });

    it('release version is greater than any pre-release of the same triple', async () => {
      // SemVer §11.4.4: when major, minor, patch are equal, a pre-release version
      // has lower precedence than a normal version.
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/compare')!;

      const result = await tool.execute({ a: '1.0.0', b: '1.0.0-alpha' }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.result).toBe(1); // 1.0.0 > 1.0.0-alpha
    });

    it('compares pre-release numeric identifiers as integers', async () => {
      // Spec example: 1.0.0-alpha.1 < 1.0.0-alpha.2
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/compare')!;

      const result = await tool.execute({ a: '1.0.0-alpha.1', b: '1.0.0-alpha.2' }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.result).toBe(-1);
    });

    it('numeric identifiers have lower precedence than alphanumeric ones', async () => {
      // Spec §11.4.1: numeric < alphanumeric, so "1" < "alpha"
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/compare')!;

      const result = await tool.execute({ a: '1.0.0-1', b: '1.0.0-alpha' }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.result).toBe(-1);
    });

    it('ignores build metadata in comparison', async () => {
      // Spec §10: build metadata MUST be ignored when determining version precedence.
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/compare')!;

      const result = await tool.execute({ a: '1.0.0+build.1', b: '1.0.0+build.2' }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.result).toBe(0); // equal despite different build metadata
    });

    it('returns an error when a is invalid', async () => {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/compare')!;

      const result = await tool.execute({ a: 'v1.0.0', b: '1.0.0' }, makeCtx());
      expect(result.status).toBe('failed');
    });

    it('returns an error when b is invalid', async () => {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/compare')!;

      const result = await tool.execute({ a: '1.0.0', b: 'not-semver' }, makeCtx());
      expect(result.status).toBe('failed');
    });
  });

  // ── semver/bump — success paths ───────────────────────────────────────────

  describe('semver/bump', () => {
    it('bumps major correctly', async () => {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/bump')!;

      const result = await tool.execute({ version: '1.2.3', type: 'major' }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.to).toBe('2.0.0');
    });

    it('bumps minor correctly', async () => {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/bump')!;

      const result = await tool.execute({ version: '1.2.3', type: 'minor' }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.to).toBe('1.3.0');
    });

    it('bumps patch correctly', async () => {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/bump')!;

      const result = await tool.execute({ version: '1.2.3', type: 'patch' }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.to).toBe('1.2.4');
    });

    it('starts a premajor pre-release series', async () => {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/bump')!;

      const result = await tool.execute(
        { version: '1.2.3', type: 'premajor', prerelease_id: 'alpha' },
        makeCtx()
      );
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.to).toBe('2.0.0-alpha.0');
    });

    it('starts a preminor pre-release series', async () => {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/bump')!;

      const result = await tool.execute(
        { version: '1.2.3', type: 'preminor', prerelease_id: 'beta' },
        makeCtx()
      );
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.to).toBe('1.3.0-beta.0');
    });

    it('starts a prepatch pre-release series', async () => {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/bump')!;

      const result = await tool.execute(
        { version: '1.2.3', type: 'prepatch', prerelease_id: 'rc' },
        makeCtx()
      );
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.to).toBe('1.2.4-rc.0');
    });

    it('increments the trailing numeric pre-release identifier', async () => {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/bump')!;

      const result = await tool.execute({ version: '1.2.4-rc.0', type: 'prerelease' }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.to).toBe('1.2.4-rc.1');
    });

    it('patch bump on a pre-release strips pre-release without incrementing patch', async () => {
      // 1.2.4-rc.1 → patch → 1.2.4 (the pre-release work IS the patch)
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/bump')!;

      const result = await tool.execute({ version: '1.2.4-rc.1', type: 'patch' }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.to).toBe('1.2.4');
    });

    it('major bump on a pre-release of a fresh major strips pre-release without re-incrementing', async () => {
      // 2.0.0-alpha.1 → major → 2.0.0 (already at 2, just drop pre-release)
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/bump')!;

      const result = await tool.execute({ version: '2.0.0-alpha.1', type: 'major' }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.to).toBe('2.0.0');
    });

    it('includes from and type in the result body', async () => {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/bump')!;

      const result = await tool.execute({ version: '1.0.0', type: 'minor' }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.from).toBe('1.0.0');
      expect(body.type).toBe('minor');
    });

    it('uses default prerelease_id "0" when not supplied', async () => {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/bump')!;

      const result = await tool.execute({ version: '1.0.0', type: 'premajor' }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.to).toBe('2.0.0-0.0');
    });

    it('returns an error for an invalid version string', async () => {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/bump')!;

      const result = await tool.execute({ version: 'banana', type: 'patch' }, makeCtx());
      expect(result.status).toBe('failed');
    });

    it('returns an error for an invalid bump type (Zod validation)', async () => {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      const tool = ex.getTool('semver/bump')!;

      const result = await tool.execute({ version: '1.0.0', type: 'invalid' }, makeCtx());
      expect(result.status).toBe('failed');
    });
  });
});
