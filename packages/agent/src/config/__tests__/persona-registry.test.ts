// ABOUTME: Tests for PersonaRegistry.parsePersona (frontmatter + body extraction)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { mkdirSync, writeFileSync, rmSync } from 'fs';

describe('PersonaRegistry.parsePersona', () => {
  let tempBundledDir: string;
  let tempUserDir: string;
  let userPersonaDir: string;
  let PersonaRegistry: typeof import('../persona-registry').PersonaRegistry;
  let registry: InstanceType<typeof PersonaRegistry>;

  beforeEach(async () => {
    tempBundledDir = fs.mkdtempSync(path.join(tmpdir(), 'bundled-personas-'));
    tempUserDir = fs.mkdtempSync(path.join(tmpdir(), 'user-personas-'));
    userPersonaDir = path.join(tempUserDir, 'agent-personas');

    vi.resetModules();
    ({ PersonaRegistry } = await import('../persona-registry'));
    registry = new PersonaRegistry({
      bundledPersonasPath: tempBundledDir,
      userPersonasPaths: [userPersonaDir],
    });
  });

  afterEach(() => {
    rmSync(tempBundledDir, { recursive: true, force: true });
    rmSync(tempUserDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function makeRegistry(
    userPersonasPaths: readonly string[]
  ): InstanceType<typeof PersonaRegistry> {
    return new PersonaRegistry({
      bundledPersonasPath: tempBundledDir,
      userPersonasPaths,
    });
  }

  it('returns config with runtime default and full body when file has no frontmatter', () => {
    const body = 'You are a helpful assistant.\n\nBe concise.';
    writeFileSync(path.join(tempBundledDir, 'plain.md'), body);
    registry = makeRegistry([userPersonaDir]);

    const result = registry.parsePersona('plain');
    expect(result.config).toEqual({ runtime: { type: 'root' } });
    expect(result.body).toBe(body);
  });

  it('parses valid frontmatter and returns body separately', () => {
    const content = `---
model: claude-sonnet-4
tools: [bash, file_read]
maxTurns: 20
---
You are Lace.`;
    writeFileSync(path.join(tempBundledDir, 'lace.md'), content);
    registry = makeRegistry([userPersonaDir]);

    const result = registry.parsePersona('lace');
    expect(result.config.model).toBe('claude-sonnet-4');
    expect(result.config.tools).toEqual(['bash', 'file_read']);
    expect(result.config.runtime).toEqual({ type: 'root' });
    expect(result.config.maxTurns).toBe(20);
    expect(result.body.trim()).toBe('You are Lace.');
  });

  it('parses runtime.type=root explicitly', () => {
    const content = `---
runtime:
  type: root
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'root-runtime.md'), content);
    registry = makeRegistry([userPersonaDir]);

    const result = registry.parsePersona('root-runtime');
    expect(result.config.runtime).toEqual({ type: 'root' });
  });

  it('parses runtime.type=container with required fields', () => {
    const content = `---
runtime:
  type: container
  containerSharing: per_invocation
  image: ghcr.io/example/lace-shell:latest
  workingDirectory: /workspace
  mounts:
    - scratch
    - knowledge
  env:
    FOO: bar
  ports:
    - host: 8080
      container: 80
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'container-runtime.md'), content);
    registry = makeRegistry([userPersonaDir]);

    const result = registry.parsePersona('container-runtime');
    expect(result.config.runtime).toEqual({
      type: 'container',
      containerSharing: 'per_invocation',
      image: 'ghcr.io/example/lace-shell:latest',
      workingDirectory: '/workspace',
      mounts: ['scratch', 'knowledge'],
      env: { FOO: 'bar' },
      ports: [{ host: 8080, container: 80 }],
      browserCdpSocket: false,
    });
  });

  it('parses runtime.type=container with browserCdpSocket defaulting false', () => {
    const content = `---
runtime:
  type: container
  containerSharing: per_invocation
  image: sen-browser:dev
  workingDirectory: /work
  mounts: []
  browserCdpSocket: true
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'browser-cdp-runtime.md'), content);
    registry = makeRegistry([userPersonaDir]);

    expect(registry.parsePersona('browser-cdp-runtime').config.runtime).toMatchObject({
      type: 'container',
      browserCdpSocket: true,
    });

    const omitted = `---
runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /work
  mounts: []
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'no-browser-cdp-runtime.md'), omitted);
    registry = makeRegistry([userPersonaDir]);

    expect(registry.parsePersona('no-browser-cdp-runtime').config.runtime).toMatchObject({
      type: 'container',
      browserCdpSocket: false,
    });
  });

  it('clamps container runtime ports to u16 bounds', () => {
    const atBounds = `---
runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /work
  mounts: []
  ports:
    - host: 65535
      container: 0
    - host: 0
      container: 65535
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'port-bounds.md'), atBounds);
    registry = makeRegistry([userPersonaDir]);

    expect(registry.parsePersona('port-bounds').config.runtime).toMatchObject({
      type: 'container',
      ports: [
        { host: 65535, container: 0 },
        { host: 0, container: 65535 },
      ],
    });

    const outOfRangeCases = [
      { name: 'host-below-lower-bound', host: -1, container: 80 },
      { name: 'host-over-upper-bound', host: 65536, container: 80 },
      { name: 'container-below-lower-bound', host: 8080, container: -1 },
      { name: 'container-over-upper-bound', host: 8080, container: 65536 },
    ];

    for (const { name, host, container } of outOfRangeCases) {
      const content = `---
runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /work
  mounts: []
  ports:
    - host: ${host}
      container: ${container}
---
Body.`;
      writeFileSync(path.join(tempBundledDir, `port-${name}.md`), content);
      registry = makeRegistry([userPersonaDir]);

      expect(() => registry.parsePersona(`port-${name}`)).toThrow(/ports/i);
    }
  });

  it('parses runtime.type=container with empty mounts and defaulted env', () => {
    const content = `---
runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /w
  mounts: []
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'container-minimal.md'), content);
    registry = makeRegistry([userPersonaDir]);

    const result = registry.parsePersona('container-minimal');
    expect(result.config.runtime).toEqual({
      type: 'container',
      containerSharing: 'per_invocation',
      image: 'img:latest',
      workingDirectory: '/w',
      mounts: [],
      env: {},
      browserCdpSocket: false,
    });
  });

  it('parses runtime.type=container with persistent lifecycle', () => {
    const content = `---
runtime:
  type: container
  containerSharing: persistent
  image: ghcr.io/example/sen-box:latest
  workingDirectory: /home/agent
  mounts:
    - home
  env:
    HOME: /home/agent
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'persistent-runtime.md'), content);
    registry = makeRegistry([userPersonaDir]);

    expect(registry.parsePersona('persistent-runtime').config.runtime).toEqual({
      type: 'container',
      containerSharing: 'persistent',
      image: 'ghcr.io/example/sen-box:latest',
      workingDirectory: '/home/agent',
      mounts: ['home'],
      env: { HOME: '/home/agent' },
      browserCdpSocket: false,
    });
  });

  it('parses runtime.type=container with sysctls', () => {
    const content = `---
runtime:
  type: container
  containerSharing: per_invocation
  image: sen-browser:dev
  workingDirectory: /work
  mounts: []
  sysctls:
    net.ipv6.conf.lo.disable_ipv6: "0"
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'sysctls-runtime.md'), content);
    registry = makeRegistry([userPersonaDir]);

    expect(registry.parsePersona('sysctls-runtime').config.runtime).toMatchObject({
      type: 'container',
      sysctls: { 'net.ipv6.conf.lo.disable_ipv6': '0' },
    });
  });

  it('parses runtime.type=container with capAdd', () => {
    const content = `---
runtime:
  type: container
  containerSharing: per_invocation
  image: sen-box:dev
  workingDirectory: /work
  mounts: []
  capAdd:
    - NET_ADMIN
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'capadd-runtime.md'), content);
    registry = makeRegistry([userPersonaDir]);

    expect(registry.parsePersona('capadd-runtime').config.runtime).toMatchObject({
      type: 'container',
      capAdd: ['NET_ADMIN'],
    });
  });

  it('parses runtime.type=container with network', () => {
    const content = `---
runtime:
  type: container
  containerSharing: per_invocation
  image: sen-box:dev
  workingDirectory: /work
  mounts: []
  network: quarantine
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'network-runtime.md'), content);
    registry = makeRegistry([userPersonaDir]);

    expect(registry.parsePersona('network-runtime').config.runtime).toMatchObject({
      type: 'container',
      network: 'quarantine',
    });
  });

  it('parses runtime.type=container with gatewayRoute', () => {
    const content = `---
runtime:
  type: container
  containerSharing: per_invocation
  image: sen-box:dev
  workingDirectory: /work
  mounts: []
  gatewayRoute: "172.31.250.1"
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'gateway-runtime.md'), content);
    registry = makeRegistry([userPersonaDir]);

    expect(registry.parsePersona('gateway-runtime').config.runtime).toMatchObject({
      type: 'container',
      gatewayRoute: '172.31.250.1',
    });
  });

  it('rejects legacy runtime.agentPlacement', () => {
    const content = `---
runtime:
  type: container
  agentPlacement: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /w
  mounts: []
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'legacy-placement.md'), content);
    registry = makeRegistry([userPersonaDir]);

    expect(() => registry.parsePersona('legacy-placement')).toThrow(/agentPlacement/);
  });

  it('throws when runtime.type=container is missing image', () => {
    const content = `---
runtime:
  type: container
  containerSharing: per_invocation
  workingDirectory: /w
  mounts: []
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'no-image.md'), content);
    registry = makeRegistry([userPersonaDir]);

    expect(() => registry.parsePersona('no-image')).toThrow(/image/i);
  });

  it('throws when runtime.type=container is missing mounts', () => {
    const content = `---
runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /w
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'no-mounts.md'), content);
    registry = makeRegistry([userPersonaDir]);

    expect(() => registry.parsePersona('no-mounts')).toThrow(/mounts/i);
  });

  it('rejects invalid mount names (uppercase / leading digit)', () => {
    const upper = `---
runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /w
  mounts:
    - Scratch
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'bad-mount-upper.md'), upper);
    registry = makeRegistry([userPersonaDir]);
    expect(() => registry.parsePersona('bad-mount-upper')).toThrow(/mounts/i);

    const leadingDigit = `---
runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /w
  mounts:
    - 1scratch
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'bad-mount-digit.md'), leadingDigit);
    registry = makeRegistry([userPersonaDir]);
    expect(() => registry.parsePersona('bad-mount-digit')).toThrow(/mounts/i);
  });

  it('rejects old persona runtime.type=box', () => {
    const content = `---
runtime:
  type: box
  image: img:latest
  workingDirectory: /home/agent
  mounts: []
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'old-box.md'), content);
    registry = makeRegistry([userPersonaDir]);

    expect(() => registry.parsePersona('old-box')).toThrow(/runtime/i);
  });

  it('rejects the old containerLifecycle field name with a helpful error', () => {
    // After the rename to containerSharing, containerLifecycle is an unknown
    // key. The .strict() schema rejects it with "Unrecognized key(s)" which
    // includes the key name, giving the persona author a clear migration hint.
    const content = `---
runtime:
  type: container
  containerLifecycle: session
  image: node:24-bookworm
  workingDirectory: /work
  mounts: []
---
body
`;
    writeFileSync(path.join(tempBundledDir, 'old-lifecycle-field.md'), content);
    registry = makeRegistry([userPersonaDir]);

    expect(() => registry.parsePersona('old-lifecycle-field')).toThrow(/containerLifecycle/);
  });

  it('rejects persistent container runtime with ports', () => {
    const content = `---
runtime:
  type: container
  containerSharing: persistent
  image: img:latest
  workingDirectory: /home/agent
  mounts: []
  ports:
    - host: 8080
      container: 80
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'persistent-with-ports.md'), content);
    registry = makeRegistry([userPersonaDir]);

    expect(() => registry.parsePersona('persistent-with-ports')).toThrow(/ports/i);
  });

  it('rejects unknown runtime discriminator', () => {
    const content = `---
runtime:
  type: nonsense
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'bad-runtime-type.md'), content);
    registry = makeRegistry([userPersonaDir]);
    expect(() => registry.parsePersona('bad-runtime-type')).toThrow(/runtime/i);
  });

  it('parses mcpServers block', () => {
    const content = `---
mcpServers:
  fs:
    command: npx
    args: ['-y', 'fs-mcp']
    enabled: true
---
Body here.`;
    writeFileSync(path.join(tempBundledDir, 'with-mcp.md'), content);
    registry = makeRegistry([userPersonaDir]);

    const result = registry.parsePersona('with-mcp');
    expect(result.config.mcpServers).toBeDefined();
    expect(result.config.mcpServers?.fs).toEqual({
      command: 'npx',
      args: ['-y', 'fs-mcp'],
      enabled: true,
    });
  });

  it('throws on invalid YAML', () => {
    const content = `---
model: : : not valid
  invalid: [unclosed
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'bad-yaml.md'), content);
    registry = makeRegistry([userPersonaDir]);

    expect(() => registry.parsePersona('bad-yaml')).toThrow(/yaml|parse/i);
  });

  it('throws on unknown top-level frontmatter key', () => {
    const content = `---
unknownField: oops
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'unknown-key.md'), content);
    registry = makeRegistry([userPersonaDir]);

    expect(() => registry.parsePersona('unknown-key')).toThrow(/unknown|unrecognized/i);
  });

  it('throws PersonaNotFoundError for unknown persona', () => {
    registry = makeRegistry([userPersonaDir]);
    expect(() => registry.parsePersona('does-not-exist')).toThrow(
      "Persona 'does-not-exist' not found"
    );
  });

  it('user persona overrides bundled when both exist', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), '---\nmodel: bundled\n---\nBundled body');
    mkdirSync(userPersonaDir, { recursive: true });
    writeFileSync(path.join(userPersonaDir, 'lace.md'), '---\nmodel: user-model\n---\nUser body');

    const result = registry.parsePersona('lace');
    expect(result.config.model).toBe('user-model');
    expect(result.body.trim()).toBe('User body');
  });

  it('parses compaction.breakpoints with valid at values in [0,1]', () => {
    const content = `---
compaction:
  strategy: summarize
  breakpoints:
    - at: 0.9
      action: compact
    - at: 0.5
      action: notify
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'compaction-valid.md'), content);
    registry = makeRegistry([userPersonaDir]);

    const result = registry.parsePersona('compaction-valid');
    expect(result.config.compaction?.breakpoints).toEqual([
      { at: 0.9, action: 'compact' },
      { at: 0.5, action: 'notify' },
    ]);
  });

  it('rejects compaction.breakpoints with at > 1 (e.g. at: 90 typo)', () => {
    const content = `---
compaction:
  breakpoints:
    - at: 90
      action: compact
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'compaction-too-high.md'), content);
    registry = makeRegistry([userPersonaDir]);

    expect(() => registry.parsePersona('compaction-too-high')).toThrow();
  });

  it('rejects compaction.breakpoints with at < 0', () => {
    const content = `---
compaction:
  breakpoints:
    - at: -0.1
      action: notify
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'compaction-negative.md'), content);
    registry = makeRegistry([userPersonaDir]);

    expect(() => registry.parsePersona('compaction-negative')).toThrow();
  });
});

describe('PersonaRegistry user search paths', () => {
  let tempBundledDir: string;
  let tempA: string;
  let tempB: string;
  let PersonaRegistry: typeof import('../persona-registry').PersonaRegistry;

  beforeEach(async () => {
    tempBundledDir = fs.mkdtempSync(path.join(tmpdir(), 'bundled-personas-'));
    tempA = fs.mkdtempSync(path.join(tmpdir(), 'user-personas-a-'));
    tempB = fs.mkdtempSync(path.join(tmpdir(), 'user-personas-b-'));

    vi.resetModules();
    ({ PersonaRegistry } = await import('../persona-registry'));
  });

  afterEach(() => {
    rmSync(tempBundledDir, { recursive: true, force: true });
    rmSync(tempA, { recursive: true, force: true });
    rmSync(tempB, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('empty userPersonasPaths: only bundled personas resolve', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Bundled body');
    const registry = new PersonaRegistry({
      bundledPersonasPath: tempBundledDir,
      userPersonasPaths: [],
    });

    expect(registry.hasPersona('lace')).toBe(true);
    expect(registry.parsePersona('lace').body.trim()).toBe('Bundled body');
    expect(() => registry.parsePersona('not-there')).toThrow("Persona 'not-there' not found");
  });

  it('earlier path wins when multiple paths contain the same persona', () => {
    writeFileSync(path.join(tempA, 'librarian.md'), '---\nmodel: from-a\n---\nA body');
    writeFileSync(path.join(tempB, 'librarian.md'), '---\nmodel: from-b\n---\nB body');

    const registry = new PersonaRegistry({
      bundledPersonasPath: tempBundledDir,
      userPersonasPaths: [tempA, tempB],
    });

    const result = registry.parsePersona('librarian');
    expect(result.config.model).toBe('from-a');
    expect(result.body.trim()).toBe('A body');
  });

  it('later path is used when earlier paths lack the persona', () => {
    writeFileSync(path.join(tempB, 'librarian.md'), '---\nmodel: from-b\n---\nB body');

    const registry = new PersonaRegistry({
      bundledPersonasPath: tempBundledDir,
      userPersonasPaths: [tempA, tempB],
    });

    const result = registry.parsePersona('librarian');
    expect(result.config.model).toBe('from-b');
    expect(result.body.trim()).toBe('B body');
  });

  it('bundled persona is overridden by any user path containing it', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), '---\nmodel: bundled\n---\nBundled body');
    writeFileSync(path.join(tempB, 'lace.md'), '---\nmodel: user-b\n---\nUser-B body');

    const registry = new PersonaRegistry({
      bundledPersonasPath: tempBundledDir,
      userPersonasPaths: [tempA, tempB],
    });

    const result = registry.parsePersona('lace');
    expect(result.config.model).toBe('user-b');
    expect(result.body.trim()).toBe('User-B body');
  });

  it('persona present only in later path is not shadowed by unrelated files in earlier path', () => {
    writeFileSync(path.join(tempA, 'unrelated.md'), 'A unrelated');
    writeFileSync(path.join(tempB, 'librarian.md'), 'librarian body');

    const registry = new PersonaRegistry({
      bundledPersonasPath: tempBundledDir,
      userPersonasPaths: [tempA, tempB],
    });

    expect(registry.hasPersona('librarian')).toBe(true);
    expect(registry.parsePersona('librarian').body.trim()).toBe('librarian body');
    expect(registry.hasPersona('unrelated')).toBe(true);
  });

  it('falls back to bundled when no user path has the persona', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Bundled body');
    writeFileSync(path.join(tempA, 'other.md'), 'other body');

    const registry = new PersonaRegistry({
      bundledPersonasPath: tempBundledDir,
      userPersonasPaths: [tempA, tempB],
    });

    expect(registry.parsePersona('lace').body.trim()).toBe('Bundled body');
  });

  it('listAvailablePersonas marks resolved-from-user as user-defined; bundled-only as not', () => {
    writeFileSync(path.join(tempBundledDir, 'only-bundled.md'), 'Bundled only');
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Bundled lace');
    writeFileSync(path.join(tempA, 'lace.md'), 'User lace');

    const registry = new PersonaRegistry({
      bundledPersonasPath: tempBundledDir,
      userPersonasPaths: [tempA, tempB],
    });

    const personas = registry.listAvailablePersonas();
    const byName = new Map(personas.map((p) => [p.name, p]));

    expect(byName.get('lace')?.isUserDefined).toBe(true);
    expect(byName.get('lace')?.path).toContain(tempA);
    expect(byName.get('only-bundled')?.isUserDefined).toBe(false);
  });
});
