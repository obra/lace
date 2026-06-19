// ABOUTME: PluginApi — per-plugin owner-injecting registrar views over the registries
// ABOUTME: plus the process-wide registry singletons and assertVersion

import { Registry } from './registry';
import { resetManifestsForTest } from './manifest';
import { addPersonaDir, addSkillDir, resetContributedDirsForTest } from './contributed-dirs';
import type { Tool } from '@lace/agent/tools/tool';
import type { CompactionStrategy } from '@lace/agent/compaction/types';
import type { ContainerRuntime } from '@lace/agent/containers/types';
// Eager import. The api→register-exec→@lace/agent/plugins→api cycle is init-safe:
// neither module accesses the other's bindings at module-evaluation time (only
// inside function bodies), so ESM live bindings resolve by call time.
import { registerExecDirInto } from '@lace/agent/tools/exec/register-exec';

export const KERNEL_PLUGIN_VERSION = '1.0.0';
export class PluginVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginVersionError';
  }
}

export interface PluginMeta {
  name: string;
  namespace: string;
  version: string;
}

/** Returns the event_seqs of events belonging to `key`. `events` = parsed verbatim
 *  events of ONE session; `key` is opaque to the kernel (never parsed here). */
export type RecallMembershipExtractor = (events: unknown[], key: string) => number[];

export interface PluginRegistries {
  tools: Registry<Tool>;
  compaction: Registry<CompactionStrategy>;
  runtimes: Registry<ContainerRuntime>;
  recall: Registry<RecallMembershipExtractor>;
}
export interface PluginRegistrar<T> {
  register(name: string, value: T): void;
}
export interface PluginApi {
  readonly meta: PluginMeta;
  readonly kernelVersion: string;
  assertVersion(major: number): void;
  tools: PluginRegistrar<Tool> & { registerExecDir(dir: string): void };
  compaction: PluginRegistrar<CompactionStrategy>;
  runtimes: PluginRegistrar<ContainerRuntime>;
  recall: PluginRegistrar<RecallMembershipExtractor>;
  personas: { addDir(dir: string): void };
  skills: { addDir(dir: string): void };
}

/**
 * The shape a plugin module must satisfy. Export `register` (required),
 * `meta` (recommended), and `manifest` (required when declaring capabilities).
 *
 * Usage:
 *   const _: PluginModule = { meta, manifest, register }; // type-check
 *   // or (TypeScript 4.9+):
 *   export { meta, manifest, register } satisfies PluginModule;
 */
export interface PluginModule {
  register(api: PluginApi): void;
  meta?: PluginMeta;
  manifest?: import('./manifest').CapabilityManifest;
}

export function makeRegistries(): PluginRegistries {
  return {
    tools: new Registry<Tool>('tools'),
    compaction: new Registry<CompactionStrategy>('compaction'),
    runtimes: new Registry<ContainerRuntime>('runtimes'),
    recall: new Registry<RecallMembershipExtractor>('recall'),
  };
}

function registrar<T>(reg: Registry<T>, owner: string): PluginRegistrar<T> {
  return { register: (name, value) => reg.register(name, value, owner) };
}

export function createPluginApi(meta: PluginMeta, registries: PluginRegistries): PluginApi {
  const kernelMajor = Number(KERNEL_PLUGIN_VERSION.split('.')[0]);
  return {
    meta,
    kernelVersion: KERNEL_PLUGIN_VERSION,
    assertVersion(major) {
      if (major !== kernelMajor) {
        throw new PluginVersionError(
          `plugin "${meta.name}" requires kernel plugin major ${major}, kernel is ${KERNEL_PLUGIN_VERSION}`
        );
      }
    },
    tools: {
      ...registrar(registries.tools, meta.name),
      registerExecDir: (dir: string) =>
        registerExecDirInto(dir, { namespace: meta.namespace, owner: meta.name }),
    },
    compaction: registrar(registries.compaction, meta.name),
    runtimes: registrar(registries.runtimes, meta.name),
    recall: registrar(registries.recall, meta.name),
    personas: { addDir: (dir: string) => addPersonaDir(meta.namespace, dir) },
    skills: { addDir: (dir: string) => addSkillDir(meta.namespace, dir) },
  };
}

/** Process-wide registry singletons. Every lace process imports this and runs the
 *  loader, so root + subagents have identical registries. */
export const registries: PluginRegistries = makeRegistries();

/** Test-support: clear all registries + manifests between cases (the registries are
 *  process-global; vitest isolates per file, but within a file dup→fatal bites). */
export function resetRegistriesForTest(): void {
  registries.tools.clear();
  registries.compaction.clear();
  registries.runtimes.clear();
  registries.recall.clear();
  resetContributedDirsForTest();
  resetManifestsForTest();
}
