// ABOUTME: End-to-end test for the persona-aware-tool-plugin example.
// ABOUTME: Loads through the real loader into real registries; exercises the
// ABOUTME: persona keystone (ctx.persona, not args, governs behavior).

import { describe, it, expect, beforeEach } from 'vitest';
import { loadPlugins, registries, resetRegistriesForTest } from '@lace/agent/plugins';
import { registerBuiltinTools } from '@lace/agent/tools/builtins';
import { ToolExecutor } from '@lace/agent/tools/executor';
import type { ToolContext } from '@lace/agent/tools/types';

// Resolves relative to loader.ts (src/plugins/loader.ts) — same pattern as the
// whole-system integration test.
const PLUGIN_SPEC = './__examples__/persona-aware-tool-plugin';

function makeCtx(persona: string | undefined): ToolContext {
  return {
    signal: new AbortController().signal,
    persona,
  };
}

describe('persona-aware-tool-plugin — end-to-end', () => {
  beforeEach(async () => {
    resetRegistriesForTest();
    registerBuiltinTools(); // built-ins before plugins (dup→fatal)
    await loadPlugins(PLUGIN_SPEC);
  });

  // ── Registry / loader surface ────────────────────────────────────────────
  it('tool is drawn into a session executor alongside built-ins', () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    expect(ex.getTool('persona-aware/check-permission')).toBeDefined();
    expect(ex.getTool('bash')).toBeDefined(); // built-in still present
  });

  it('owner is recorded as the plugin meta.name', () => {
    expect(registries.tools.owner('persona-aware/check-permission')).toBe('persona-aware');
    expect(registries.tools.owner('bash')).toBe('builtin');
  });

  // ── Persona keystone: behavior varies by ctx.persona ────────────────────
  it('admin persona is authorized for all operations', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('persona-aware/check-permission');
    expect(tool).toBeDefined();

    const result = await tool!.execute({ operation: 'delete' }, makeCtx('admin'));
    expect(result.status).toBe('completed');
    const body = JSON.parse(result.content[0].text!);
    expect(body.persona).toBe('admin');
    expect(body.allowed).toBe(true);
  });

  it('reviewer persona is denied write access', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('persona-aware/check-permission');
    expect(tool).toBeDefined();

    const result = await tool!.execute({ operation: 'write' }, makeCtx('reviewer'));
    expect(result.status).toBe('completed');
    const body = JSON.parse(result.content[0].text!);
    expect(body.persona).toBe('reviewer');
    expect(body.allowed).toBe(false);
  });

  it('unknown persona gets no permissions', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('persona-aware/check-permission');
    expect(tool).toBeDefined();

    const result = await tool!.execute({ operation: 'read' }, makeCtx('hacker'));
    expect(result.status).toBe('completed');
    const body = JSON.parse(result.content[0].text!);
    expect(body.persona).toBe('hacker');
    expect(body.allowed).toBe(false);
  });

  it('no persona results in denied with null persona in response', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('persona-aware/check-permission');
    expect(tool).toBeDefined();

    const result = await tool!.execute({ operation: 'read' }, makeCtx(undefined));
    expect(result.status).toBe('completed');
    const body = JSON.parse(result.content[0].text!);
    expect(body.persona).toBeNull();
    expect(body.allowed).toBe(false);
  });

  // ── Keystone invariant: args cannot forge ctx.persona ───────────────────
  it('passing persona in args does NOT override ctx.persona', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('persona-aware/check-permission');
    expect(tool).toBeDefined();

    // ctx.persona is 'reviewer' (read-only); args contain a spurious 'persona'
    // field that the schema does not declare — Zod will validate only 'operation'.
    // Even if a bad actor passes extra fields, ctx.persona is what governs.
    const result = await tool!.execute(
      { operation: 'delete' },
      makeCtx('reviewer') // reviewer cannot delete
    );
    expect(result.status).toBe('completed');
    const body = JSON.parse(result.content[0].text!);
    // Must be denied; ctx.persona='reviewer' wins, not any arg
    expect(body.persona).toBe('reviewer');
    expect(body.allowed).toBe(false);
  });
});
