// ABOUTME: Tests PluginApi construction, owner injection, and assertVersion
import { describe, it, expect, beforeEach } from 'vitest';
import { createPluginApi, makeRegistries, KERNEL_PLUGIN_VERSION, PluginVersionError } from './api';

const META = { name: 'demo', namespace: 'demo', version: '1.0.0' };

describe('createPluginApi', () => {
  let registries: ReturnType<typeof makeRegistries>;
  beforeEach(() => {
    registries = makeRegistries();
  });

  it('exposes four registrars + meta + kernelVersion', () => {
    const api = createPluginApi(META, registries);
    expect(api.meta.namespace).toBe('demo');
    expect(api.kernelVersion).toBe(KERNEL_PLUGIN_VERSION);
  });

  it('registrar.register stamps the plugin as owner in the underlying registry', () => {
    const api = createPluginApi(META, registries);
    const stubTool = {
      name: 'demo:stub',
      description: 'stub',
      schema: { type: 'object' },
    } as never;
    api.tools.register('demo:stub', stubTool);
    expect(registries.tools.has('demo:stub')).toBe(true);
    expect(registries.tools.owner('demo:stub')).toBe('demo');
  });

  it('assertVersion passes the current major, throws on mismatch', () => {
    const api = createPluginApi(META, registries);
    const major = Number(KERNEL_PLUGIN_VERSION.split('.')[0]);
    expect(() => api.assertVersion(major)).not.toThrow();
    expect(() => api.assertVersion(major + 1)).toThrow(PluginVersionError);
  });
});
