// ABOUTME: The one LACE_PLUGINS loader — import in order, read meta+manifest, register, validate
// ABOUTME: Pure async (no process.exit); fatal == throws PluginLoadError. main.ts handles exit.

import { logger } from '@lace/agent/utils/logger';
import {
  createPluginApi,
  registries as globalRegistries,
  type PluginRegistries,
  type PluginMeta,
} from './api';
import { recordManifest, type CapabilityManifest } from './manifest';

export class PluginLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PluginLoadError';
  }
}

interface LoadedModule {
  register: (api: import('./api').PluginApi) => void;
  meta?: PluginMeta;
  manifest?: CapabilityManifest;
}
export interface LoadPluginsOptions {
  registries?: PluginRegistries;
}
export interface LoadPluginsResult {
  loaded: Array<{ name: string; ms: number }>;
}

export function parsePluginSpec(spec: string | undefined): string[] {
  if (!spec || !spec.trim()) return [];
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function asModule(mod: unknown, specifier: string): LoadedModule {
  if (typeof (mod as { register?: unknown })?.register !== 'function') {
    throw new PluginLoadError(`plugin "${specifier}" does not export a register() function`);
  }
  return mod as LoadedModule;
}

export async function loadPlugins(
  spec: string | undefined,
  opts: LoadPluginsOptions = {}
): Promise<LoadPluginsResult> {
  const registries = opts.registries ?? globalRegistries;
  const loaded: LoadPluginsResult['loaded'] = [];
  for (const specifier of parsePluginSpec(spec)) {
    const startedAt = Date.now();
    let raw: unknown;
    try {
      raw = await import(specifier);
    } catch (err) {
      throw new PluginLoadError(`failed to import plugin "${specifier}"`, { cause: err });
    }
    const mod = asModule(raw, specifier);
    const meta: PluginMeta = mod.meta ?? {
      name: specifier,
      namespace: specifier,
      version: '0.0.0',
    };
    if (mod.manifest) recordManifest(meta.name, mod.manifest);
    const api = createPluginApi(meta, registries);
    try {
      mod.register(api);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      throw new PluginLoadError(`plugin "${specifier}" register() failed: ${m}`, { cause: err });
    }
    const ms = Date.now() - startedAt;
    loaded.push({ name: meta.name, ms });
    logger.info('plugins.loaded', { plugin: meta.name, specifier, ms });
  }
  return { loaded };
}
