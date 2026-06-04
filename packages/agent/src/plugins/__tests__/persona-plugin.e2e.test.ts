// ABOUTME: E2E test for persona-plugin example — no mocks, real loader, real registries,
// ABOUTME: real PersonaRegistry, real TemplateEngine, real SystemVariableProvider.

import { describe, it, expect, beforeEach } from 'vitest';
import { loadPlugins, resetRegistriesForTest } from '@lace/agent/plugins';
import { PersonaRegistry } from '@lace/agent/config/persona-registry';
import { TemplateEngine } from '@lace/agent/config/template-engine';
import {
  VariableProviderManager,
  SystemVariableProvider,
} from '@lace/agent/config/variable-providers';

// Loader resolves relative to src/plugins/loader.ts; __examples__ is a sibling of __tests__.
const PLUGIN_SPEC = './__examples__/persona-plugin';
const PERSONA_NAME = 'persona-example/security-reviewer';

describe('persona-plugin e2e', () => {
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

  it('PersonaRegistry.parsePersona returns correct config and body', () => {
    const registry = new PersonaRegistry({
      bundledPersonasPath: '/nonexistent',
      userPersonasPaths: [],
    });
    const parsed = registry.parsePersona(PERSONA_NAME);

    // Body contains the identifying text from our plugin
    expect(parsed.body).toContain('Security Reviewer');
    // Body contains the unrendered template variable
    expect(parsed.body).toContain('{{system.sessionDate}}');
    // Config has the compaction strategy we set
    expect((parsed.config as { compaction?: { strategy?: string } }).compaction?.strategy).toBe(
      'track-based'
    );
  });

  it('registry.render substitutes {{system.sessionDate}} and removes the literal tag', async () => {
    const registry = new PersonaRegistry({
      bundledPersonasPath: '/nonexistent',
      userPersonasPaths: [],
    });

    // Build a real TemplateEngine (empty dirs — plugin body uses renderString path,
    // so no disk I/O occurs for the persona itself).
    const engine = new TemplateEngine([]);

    // Build a real context from SystemVariableProvider (the same provider the
    // kernel uses in production).
    const varManager = new VariableProviderManager();
    varManager.addProvider(new SystemVariableProvider());
    const context = await varManager.getTemplateContext();

    const rendered = registry.render(PERSONA_NAME, engine, context);

    // The literal mustache tag must be gone.
    expect(rendered).not.toContain('{{system.sessionDate}}');

    // The substituted value should be a date string (YYYY-MM-DD).
    expect(rendered).toMatch(/\d{4}-\d{2}-\d{2}/);

    // Static text still present.
    expect(rendered).toContain('Security Reviewer');
    expect(rendered).toContain('injection flaws');
  });
});
