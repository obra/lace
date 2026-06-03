import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PersonaRegistry } from './persona-registry';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { mkdirSync, writeFileSync, rmSync } from 'fs';

describe('PersonaRegistry', () => {
  let tempBundledDir: string;
  let tempUserDir: string;
  let userPersonaDir: string;
  let registry: PersonaRegistry;

  function makeRegistry(userPersonasPaths: readonly string[] = [userPersonaDir]): PersonaRegistry {
    return new PersonaRegistry({
      bundledPersonasPath: tempBundledDir,
      userPersonasPaths,
    });
  }

  beforeEach(() => {
    tempBundledDir = fs.mkdtempSync(path.join(tmpdir(), 'bundled-personas-'));
    tempUserDir = fs.mkdtempSync(path.join(tmpdir(), 'user-personas-'));
    userPersonaDir = path.join(tempUserDir, 'agent-personas');
    registry = makeRegistry();
  });

  afterEach(() => {
    rmSync(tempBundledDir, { recursive: true, force: true });
    rmSync(tempUserDir, { recursive: true, force: true });
  });

  it('loads bundled personas from directory', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Default persona');
    writeFileSync(path.join(tempBundledDir, 'coding-agent.md'), 'Coding persona');

    registry = makeRegistry();

    const personas = registry.listAvailablePersonas();
    expect(personas).toHaveLength(2);
    expect(personas.map((p) => p.name)).toContain('lace');
    expect(personas.map((p) => p.name)).toContain('coding-agent');
    expect(personas.every((p) => !p.isUserDefined)).toBe(true);
  });

  it('user personas override built-in ones', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Default persona');

    mkdirSync(userPersonaDir, { recursive: true });
    writeFileSync(path.join(userPersonaDir, 'lace.md'), 'User override');

    const personas = registry.listAvailablePersonas();
    const lacePersona = personas.find((p) => p.name === 'lace');

    expect(lacePersona?.isUserDefined).toBe(true);
    expect(lacePersona?.path).toContain('agent-personas');
  });

  it('resolves host-placement relative MCP command/args against mcpBaseDir', () => {
    mkdirSync(userPersonaDir, { recursive: true });
    writeFileSync(
      path.join(userPersonaDir, 'worker.md'),
      [
        '---',
        'mcpServers:',
        '  knowledge:',
        '    command: ./node_modules/.bin/tsx',
        '    args:',
        '      - ./src/mcp/servers/knowledge.ts',
        '      - --flag',
        '  absolute-host:',
        '    command: node',
        '    args:',
        '      - /opt/abs/index.js',
        '  in-container:',
        '    command: ./rel/in/container.js',
        '    placement: toolRuntime',
        '---',
        'body',
      ].join('\n')
    );

    const registry = new PersonaRegistry({
      bundledPersonasPath: tempBundledDir,
      userPersonasPaths: [userPersonaDir],
      mcpBaseDir: '/pkg/root',
    });

    const servers = registry.parsePersona('worker').config.mcpServers!;
    // Host placement (the default): relative command/args resolve under mcpBaseDir.
    expect(servers.knowledge.command).toBe('/pkg/root/node_modules/.bin/tsx');
    expect(servers.knowledge.args).toEqual(['/pkg/root/src/mcp/servers/knowledge.ts', '--flag']);
    // Absolute path and bare command name are left untouched.
    expect(servers['absolute-host'].command).toBe('node');
    expect(servers['absolute-host'].args).toEqual(['/opt/abs/index.js']);
    // toolRuntime placement runs inside the persona container — a relative path
    // there is container-side and must NOT be resolved against the host base.
    expect(servers['in-container'].command).toBe('./rel/in/container.js');
  });

  it('leaves relative MCP paths unchanged when no mcpBaseDir is configured', () => {
    mkdirSync(userPersonaDir, { recursive: true });
    writeFileSync(
      path.join(userPersonaDir, 'worker.md'),
      ['---', 'mcpServers:', '  k:', '    command: ./x', '---', 'b'].join('\n')
    );
    const { config } = makeRegistry().parsePersona('worker');
    expect(config.mcpServers!.k.command).toBe('./x');
  });

  it('validates persona existence', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Default persona');
    registry = makeRegistry();

    expect(() => registry.validatePersona('lace')).not.toThrow();
    expect(() => registry.validatePersona('nonexistent')).toThrow(
      "Persona 'nonexistent' not found"
    );
  });

  it('error message lists available personas', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Default');
    writeFileSync(path.join(tempBundledDir, 'coding-agent.md'), 'Coding');
    registry = makeRegistry();

    expect(() => registry.validatePersona('bad-name')).toThrow(
      'Available personas: coding-agent, lace'
    );
  });

  it('resolves known personas; unknown persona is absent', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Default persona');
    registry = makeRegistry();

    // Bundled persona is discoverable.
    expect(registry.hasPersona('lace')).toBe(true);
    expect(registry.listAvailablePersonas().map((p) => p.name)).toContain('lace');

    // Unknown persona is not present.
    expect(registry.hasPersona('nonexistent')).toBe(false);
    expect(registry.listAvailablePersonas().map((p) => p.name)).not.toContain('nonexistent');
  });

  it('hasPersona returns correct boolean values', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Default persona');
    registry = makeRegistry();

    expect(registry.hasPersona('lace')).toBe(true);
    expect(registry.hasPersona('nonexistent')).toBe(false);
  });

  it('handles missing bundled directory gracefully', () => {
    const nonExistentDir = path.join(tmpdir(), 'does-not-exist');
    const registryWithBadPath = new PersonaRegistry({
      bundledPersonasPath: nonExistentDir,
      userPersonasPaths: [],
    });

    const personas = registryWithBadPath.listAvailablePersonas();
    expect(personas).toHaveLength(0);
    expect(registryWithBadPath.hasPersona('lace')).toBe(false);
  });

  it('ignores non-markdown files', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Valid persona');
    writeFileSync(path.join(tempBundledDir, 'readme.txt'), 'Not a persona');
    writeFileSync(path.join(tempBundledDir, 'config.json'), '{}');

    registry = makeRegistry();

    const personas = registry.listAvailablePersonas();
    expect(personas).toHaveLength(1);
    expect(personas[0].name).toBe('lace');
  });
});
