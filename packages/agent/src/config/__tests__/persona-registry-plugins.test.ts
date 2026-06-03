// ABOUTME: Tests PersonaRegistry resolution of plugin-contributed personas via api.personas
// ABOUTME: Verifies precedence: user-disk > plugin > bundled
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PersonaRegistry } from '@lace/agent/config/persona-registry';
import { registries, resetRegistriesForTest } from '@lace/agent/plugins';

const reg = () =>
  new PersonaRegistry({ bundledPersonasPath: '/nonexistent', userPersonasPaths: [] });

describe('PersonaRegistry + api.personas', () => {
  beforeEach(() => resetRegistriesForTest());

  it('resolves a plugin persona', () => {
    registries.personas.register(
      'plugin-researcher',
      { config: { runtime: { type: 'root' } } as never, body: 'You are a researcher.' },
      'vendor'
    );
    const r = reg();
    expect(r.hasPersona('plugin-researcher')).toBe(true);
    expect(r.parsePersona('plugin-researcher').body).toContain('researcher');
  });

  it('lists plugin personas', () => {
    registries.personas.register('plugin-listed', { config: {} as never, body: 'x' }, 'vendor');
    expect(
      reg()
        .listAvailablePersonas()
        .some((p) => p.name === 'plugin-listed')
    ).toBe(true);
  });

  describe('disk-wins-over-plugin precedence', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-disk-wins-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('user-disk persona overrides a same-name plugin persona', () => {
      // Register a plugin persona for 'dup-name'
      registries.personas.register(
        'dup-name',
        { config: { runtime: { type: 'root' } } as never, body: 'PLUGIN body' },
        'vendor'
      );
      // Create a user-disk persona with the same name in a temp dir
      fs.writeFileSync(path.join(tempDir, 'dup-name.md'), 'DISK body');

      const r = new PersonaRegistry({
        bundledPersonasPath: '/nonexistent',
        userPersonasPaths: [tempDir],
      });

      // Disk wins: parsePersona should return the disk body, not the plugin body
      expect(r.parsePersona('dup-name').body.trim()).toBe('DISK body');
    });
  });
});
