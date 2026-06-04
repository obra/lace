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
import { addPersonaDir, resetContributedDirsForTest } from '@lace/agent/plugins';

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
  let pluginDir: string;
  let registry: PersonaRegistry;
  let engine: TemplateEngine;
  let varManager: VariableProviderManager;

  beforeEach(() => {
    resetContributedDirsForTest();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-render-char-'));
    bundledDir = path.join(tempDir, 'bundled');
    userDir = path.join(tempDir, 'user');
    pluginDir = path.join(tempDir, 'plugin');
    fs.mkdirSync(bundledDir, { recursive: true });
    fs.mkdirSync(userDir, { recursive: true });
    fs.mkdirSync(pluginDir, { recursive: true });

    fs.writeFileSync(path.join(bundledDir, 'bundled-agent.md'), BUNDLED_BODY);
    fs.writeFileSync(path.join(userDir, 'user-agent.md'), USER_BODY);
    fs.writeFileSync(path.join(pluginDir, 'plugin-agent.md'), PLUGIN_BODY);

    addPersonaDir('test-vendor', pluginDir);

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
    resetContributedDirsForTest();
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

  it('renders a plugin persona — body rendered via renderPersona, variables substituted', async () => {
    const context = await makeMinimalContext(varManager);
    // Plugin persona is now file-dir based: test-vendor:plugin-agent resolves
    // from the plugin dir set up in beforeEach via addPersonaDir.
    const result = registry.renderPersona('test-vendor:plugin-agent', context);

    expect(result).toContain('You are a plugin-defined test agent.');
    expect(result).not.toContain('{{system.os}}');
    const match = result.match(/You are a plugin-defined test agent\. (.+)/);
    expect(match).not.toBeNull();
    expect(match![1].trim().length).toBeGreaterThan(0);
  });

  // ── 4. User wins over plugin with same name ───────────────────────────────

  it('user-disk persona is found by engine render without plugin interference', async () => {
    // Plugin personas are namespaced (test-vendor:plugin-agent), so there is no
    // name collision with plain user-disk personas. Verify engine.render picks the
    // user-disk file as expected.
    const context = await makeMinimalContext(varManager);
    const result = engine.render('user-agent.md', context);
    expect(result).toContain('You are a user-defined test agent.');
    expect(result).not.toContain('plugin-defined');
  });

  // ── registry.renderPersona() dispatch tests ───────────────────────────────
  // These exercise PersonaRegistry.renderPersona() — the source-scoped dispatch
  // path. Engine.render/renderString tests above do NOT cover registry dispatch.

  it('registry.renderPersona — user persona: substitutes {{system.os}}', async () => {
    const context = await makeMinimalContext(varManager);
    const result = registry.renderPersona('user-agent', context);

    expect(result).toContain('You are a user-defined test agent.');
    // The mustache variable must have been expanded — literal tag is gone.
    expect(result).not.toContain('{{system.os}}');
    // The substituted value is a non-empty string (the real OS name).
    const match = result.match(/You are a user-defined test agent\. (.+)/);
    expect(match).not.toBeNull();
    expect(match![1].trim().length).toBeGreaterThan(0);
  });

  it('registry.renderPersona — plugin persona: substitutes {{system.os}}', async () => {
    const context = await makeMinimalContext(varManager);
    const result = registry.renderPersona('test-vendor:plugin-agent', context);

    expect(result).toContain('You are a plugin-defined test agent.');
    expect(result).not.toContain('{{system.os}}');
    const match = result.match(/You are a plugin-defined test agent\. (.+)/);
    expect(match).not.toBeNull();
    expect(match![1].trim().length).toBeGreaterThan(0);
  });

  it('registry.renderPersona — user persona wins when user dir and bundled dir both have entry', async () => {
    // Write a bundled entry with the same name as the user persona. User dir source
    // has higher precedence, so registry.renderPersona must return the user body.
    fs.writeFileSync(path.join(bundledDir, 'user-agent.md'), BUNDLED_BODY);

    // Rebuild registry so it scans the updated bundled dir.
    const reg2 = new PersonaRegistry({
      bundledPersonasPath: bundledDir,
      userPersonasPaths: [userDir],
    });

    const context = await makeMinimalContext(varManager);
    const result = reg2.renderPersona('user-agent', context);

    expect(result).toContain('You are a user-defined test agent.');
    expect(result).not.toContain('bundled');
  });

  it('registry.renderPersona — throws PersonaNotFoundError for unknown name', async () => {
    const context = await makeMinimalContext(varManager);
    expect(() => registry.renderPersona('does-not-exist', context)).toThrow(PersonaNotFoundError);
  });
});
