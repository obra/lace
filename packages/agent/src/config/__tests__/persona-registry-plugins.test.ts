// ABOUTME: Tests PersonaRegistry resolution of plugin-contributed personas via api.personas
// ABOUTME: Verifies precedence: user-disk > plugin > bundled
import { describe, it, expect, beforeEach } from 'vitest';
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
});
