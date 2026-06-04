// ABOUTME: E2E test for incident-responder-plugin — no mocks, real loader, real registries,
// ABOUTME: real PersonaRegistry, real TemplateEngine, real SystemVariableProvider.

import { describe, it, expect, beforeEach } from 'vitest';
import { loadPlugins, resetRegistriesForTest } from '@lace/agent/plugins';
import { PersonaRegistry } from '@lace/agent/config/persona-registry';
import {
  VariableProviderManager,
  SystemVariableProvider,
} from '@lace/agent/config/variable-providers';

// Loader resolves relative to src/plugins/loader.ts; __examples__ is a sibling of __tests__.
const PLUGIN_SPEC = './__examples__/incident-responder-plugin';
const PERSONA_NAME = 'incident-responder:incident-responder';

describe('incident-responder-plugin e2e', () => {
  beforeEach(async () => {
    resetRegistriesForTest();
    await loadPlugins(PLUGIN_SPEC);
  });

  it('PersonaRegistry.hasPersona returns true for the registered persona', () => {
    const registry = new PersonaRegistry({
      bundledPersonasPath: '/nonexistent',
      userPersonasPaths: [],
    });
    expect(registry.hasPersona(PERSONA_NAME)).toBe(true);
  });

  it('PersonaRegistry.parsePersona returns correct config fields', () => {
    const registry = new PersonaRegistry({
      bundledPersonasPath: '/nonexistent',
      userPersonasPaths: [],
    });
    const parsed = registry.parsePersona(PERSONA_NAME);

    // Body contains identifying role text
    expect(parsed.body).toContain('Incident Responder');
    // Body contains both template variables (still unrendered at parse time)
    expect(parsed.body).toContain('{{system.sessionDate}}');
    expect(parsed.body).toContain('{{system.os}}');

    // Config: runtime is root
    expect((parsed.config as { runtime?: { type?: string } }).runtime?.type).toBe('root');

    // Config: maxTurns is set and is a positive integer
    const maxTurns = (parsed.config as { maxTurns?: number }).maxTurns;
    expect(maxTurns).toBeDefined();
    expect(typeof maxTurns).toBe('number');
    expect(maxTurns).toBeGreaterThan(0);

    // Config: tools allowlist is present and includes bash and read_file
    const tools = (parsed.config as { tools?: string[] }).tools;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools).toContain('bash');
    expect(tools).toContain('read_file');

    // Config: compaction strategy is set
    const compaction = (parsed.config as { compaction?: { strategy?: string } }).compaction;
    expect(compaction?.strategy).toBe('track-based');

    // Config: compaction breakpoints include a notify at 0.8
    const breakpoints = (
      parsed.config as {
        compaction?: { breakpoints?: Array<{ at: number; action: string }> };
      }
    ).compaction?.breakpoints;
    expect(Array.isArray(breakpoints)).toBe(true);
    const notifyBreakpoint = breakpoints?.find((bp) => bp.action === 'notify');
    expect(notifyBreakpoint).toBeDefined();
    expect(notifyBreakpoint?.at).toBe(0.8);
  });

  it('registry.renderPersona substitutes {{system.sessionDate}} and {{system.os}}', async () => {
    const registry = new PersonaRegistry({
      bundledPersonasPath: '/nonexistent',
      userPersonasPaths: [],
    });

    // Build a real context from SystemVariableProvider (the same provider the
    // kernel uses in production).
    const varManager = new VariableProviderManager();
    varManager.addProvider(new SystemVariableProvider());
    const context = await varManager.getTemplateContext();

    const rendered = registry.renderPersona(PERSONA_NAME, context);

    // Both literal mustache tags must be gone.
    expect(rendered).not.toContain('{{system.sessionDate}}');
    expect(rendered).not.toContain('{{system.os}}');

    // sessionDate substituted value should look like a YYYY-MM-DD date.
    expect(rendered).toMatch(/\d{4}-\d{2}-\d{2}/);

    // os substituted value should be a known platform string.
    const knownPlatforms = ['linux', 'darwin', 'win32', 'freebsd', 'openbsd'];
    expect(knownPlatforms.some((p) => rendered.includes(p))).toBe(true);

    // Static text still present.
    expect(rendered).toContain('Incident Responder');
    expect(rendered).toContain('Root Cause Hypothesis');
    expect(rendered).toContain('BLOCKED: need X');
  });
});
