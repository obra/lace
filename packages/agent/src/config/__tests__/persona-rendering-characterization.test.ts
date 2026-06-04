// ABOUTME: Characterization tests for persona rendering output — pinned before the
// ABOUTME: PersonaSource refactor so we can verify byte-identical output after.
// ABOUTME: Covers: user persona, bundled persona, plugin persona.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PersonaRegistry, PersonaNotFoundError } from '../persona-registry';
import { TemplateEngine } from '../template-engine';
import { VariableProviderManager, SystemVariableProvider } from '../variable-providers';
import { registries, resetRegistriesForTest } from '@lace/agent/plugins';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeMinimalContext(
  manager: VariableProviderManager
): Promise<import('../template-engine').TemplateContext> {
  return manager.getTemplateContext();
}

// ── fixtures ─────────────────────────────────────────────────────────────────

const USER_BODY = 'You are a user-defined test agent. {{system.os}}';
const BUNDLED_BODY = 'You are a bundled test agent. {{system.os}}';
const PLUGIN_BODY = 'You are a plugin-defined test agent. {{system.os}}';

// ── suite ────────────────────────────────────────────────────────────────────

describe('PersonaRegistry rendering characterization', () => {
  let tempDir: string;
  let bundledDir: string;
  let userDir: string;
  let registry: PersonaRegistry;
  let engine: TemplateEngine;
  let varManager: VariableProviderManager;

  beforeEach(() => {
    resetRegistriesForTest();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-render-char-'));
    bundledDir = path.join(tempDir, 'bundled');
    userDir = path.join(tempDir, 'user');
    fs.mkdirSync(bundledDir, { recursive: true });
    fs.mkdirSync(userDir, { recursive: true });

    fs.writeFileSync(path.join(bundledDir, 'bundled-agent.md'), BUNDLED_BODY);
    fs.writeFileSync(path.join(userDir, 'user-agent.md'), USER_BODY);

    registry = new PersonaRegistry({
      bundledPersonasPath: bundledDir,
      userPersonasPaths: [userDir],
    });

    // Engine must mirror what PromptManager builds: user dirs first, then bundled.
    engine = new TemplateEngine([userDir, bundledDir]);

    varManager = new VariableProviderManager();
    varManager.addProvider(new SystemVariableProvider());
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetRegistriesForTest();
  });

  // ── 1. User persona ───────────────────────────────────────────────────────

  it('renders a user-disk persona — template variables are substituted', async () => {
    const context = await makeMinimalContext(varManager);
    // Drive rendering the same way prompt-manager does today:
    // for a user persona the path is a real disk path, so prompt-manager calls
    // engine.render(`${name}.md`, context).
    const result = engine.render('user-agent.md', context);

    expect(result).toContain('You are a user-defined test agent.');
    // {{system.os}} should have been replaced (not literally present in output)
    expect(result).not.toContain('{{system.os}}');
    // The substituted value is some non-empty string
    const match = result.match(/You are a user-defined test agent\. (.+)/);
    expect(match).not.toBeNull();
    expect(match![1].trim().length).toBeGreaterThan(0);
  });

  // ── 2. Bundled persona ────────────────────────────────────────────────────

  it('renders the bundled persona — template variables are substituted', async () => {
    const context = await makeMinimalContext(varManager);
    const result = engine.render('bundled-agent.md', context);

    expect(result).toContain('You are a bundled test agent.');
    expect(result).not.toContain('{{system.os}}');
    const match = result.match(/You are a bundled test agent\. (.+)/);
    expect(match).not.toBeNull();
    expect(match![1].trim().length).toBeGreaterThan(0);
  });

  // ── 3. Plugin persona ─────────────────────────────────────────────────────

  it('renders a plugin persona — body is rendered via renderString, variables substituted', async () => {
    registries.personas.register(
      'plugin-agent',
      { config: { runtime: { type: 'root' } } as never, body: PLUGIN_BODY },
      'test-vendor'
    );

    const context = await makeMinimalContext(varManager);
    // Drive rendering the same way prompt-manager does today for plugin personas:
    // parsePersona returns the body, then engine.renderString(body, context) is called.
    const parsed = registry.parsePersona('plugin-agent');
    const result = engine.renderString(parsed.body, context);

    expect(result).toContain('You are a plugin-defined test agent.');
    expect(result).not.toContain('{{system.os}}');
    const match = result.match(/You are a plugin-defined test agent\. (.+)/);
    expect(match).not.toBeNull();
    expect(match![1].trim().length).toBeGreaterThan(0);
  });

  // ── 4. User wins over plugin with same name ───────────────────────────────

  it('user-disk persona shadows same-named plugin persona during render', async () => {
    registries.personas.register(
      'user-agent',
      { config: { runtime: { type: 'root' } } as never, body: PLUGIN_BODY },
      'test-vendor'
    );

    const context = await makeMinimalContext(varManager);
    // user-agent on disk should win, and render via engine.render (not renderString).
    const result = engine.render('user-agent.md', context);
    expect(result).toContain('You are a user-defined test agent.');
    expect(result).not.toContain('plugin-defined');
  });

  // ── registry.render() dispatch tests ─────────────────────────────────────
  // These exercise the new PersonaRegistry.render() method — the actual
  // dispatch path introduced by the refactor. The old tests above exercise
  // engine.render/renderString directly and do NOT cover registry dispatch.

  it('registry.render — user persona: substitutes {{system.os}}', async () => {
    const context = await makeMinimalContext(varManager);
    const result = registry.render('user-agent', engine, context);

    expect(result).toContain('You are a user-defined test agent.');
    // The mustache variable must have been expanded — literal tag is gone.
    expect(result).not.toContain('{{system.os}}');
    // The substituted value is a non-empty string (the real OS name).
    const match = result.match(/You are a user-defined test agent\. (.+)/);
    expect(match).not.toBeNull();
    expect(match![1].trim().length).toBeGreaterThan(0);
  });

  it('registry.render — plugin persona: renderString path, substitutes {{system.os}}', async () => {
    registries.personas.register(
      'plugin-agent',
      { config: { runtime: { type: 'root' } } as never, body: PLUGIN_BODY },
      'test-vendor'
    );

    const context = await makeMinimalContext(varManager);
    const result = registry.render('plugin-agent', engine, context);

    expect(result).toContain('You are a plugin-defined test agent.');
    expect(result).not.toContain('{{system.os}}');
    const match = result.match(/You are a plugin-defined test agent\. (.+)/);
    expect(match).not.toBeNull();
    expect(match![1].trim().length).toBeGreaterThan(0);
  });

  it('registry.render — user beats plugin for same name (precedence via dispatch)', async () => {
    // Register a plugin persona with the same name as the user-disk persona.
    registries.personas.register(
      'user-agent',
      { config: { runtime: { type: 'root' } } as never, body: PLUGIN_BODY },
      'test-vendor'
    );

    const context = await makeMinimalContext(varManager);
    // registry.render must pick the user-disk source first.
    const result = registry.render('user-agent', engine, context);

    expect(result).toContain('You are a user-defined test agent.');
    expect(result).not.toContain('plugin-defined');
  });

  it('registry.render — throws PersonaNotFoundError for unknown name', async () => {
    const context = await makeMinimalContext(varManager);
    expect(() => registry.render('does-not-exist', engine, context)).toThrow(PersonaNotFoundError);
  });
});
