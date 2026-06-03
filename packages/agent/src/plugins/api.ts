// ABOUTME: PluginApi — per-plugin owner-injecting registrar views over the registries
// ABOUTME: plus the process-wide registry singletons and assertVersion

import { Registry } from './registry';
import { resetManifestsForTest } from './manifest';
import type { Tool } from '@lace/agent/tools/tool';
import type { CompactionStrategy } from '@lace/agent/compaction/types';
import type { ContainerRuntime } from '@lace/agent/containers/types';
import type { ParsedPersona } from '@lace/agent/config/persona-registry';

export const KERNEL_PLUGIN_VERSION = '1.0.0';
export class PluginVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginVersionError';
  }
}

/** A plugin-contributed persona has the same shape disk personas parse to. */
export type PersonaDef = ParsedPersona;
export interface PluginMeta {
  name: string;
  namespace: string;
  version: string;
}

export interface PluginRegistries {
  tools: Registry<Tool>;
  compaction: Registry<CompactionStrategy>;
  runtimes: Registry<ContainerRuntime>;
  personas: Registry<PersonaDef>;
}
export interface PluginRegistrar<T> {
  register(name: string, value: T): void;
}
export interface PluginApi {
  readonly meta: PluginMeta;
  readonly kernelVersion: string;
  assertVersion(major: number): void;
  tools: PluginRegistrar<Tool>;
  compaction: PluginRegistrar<CompactionStrategy>;
  runtimes: PluginRegistrar<ContainerRuntime>;
  personas: PluginRegistrar<PersonaDef>;
}

export function makeRegistries(): PluginRegistries {
  return {
    tools: new Registry<Tool>('tools'),
    compaction: new Registry<CompactionStrategy>('compaction'),
    runtimes: new Registry<ContainerRuntime>('runtimes'),
    personas: new Registry<PersonaDef>('personas'),
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
    tools: registrar(registries.tools, meta.name),
    compaction: registrar(registries.compaction, meta.name),
    runtimes: registrar(registries.runtimes, meta.name),
    personas: registrar(registries.personas, meta.name),
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
  registries.personas.clear();
  resetManifestsForTest();
}
