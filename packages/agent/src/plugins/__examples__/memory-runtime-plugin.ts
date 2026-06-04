// ABOUTME: Example plugin — registers an in-memory ContainerRuntime.
// ABOUTME: Useful as a reference for custom runtime authors and as a test double.
//
// ── PACKAGING CONTRACT ────────────────────────────────────────────────────────
// This plugin ships as a SEPARATE package from @lace/agent. Mark @lace/agent as
// EXTERNAL in your bundler (esbuild/rollup) — bundling a second copy breaks
// registry identity (two Map instances, registrations become invisible).
//
// Import types freely; import values only where unavoidable (the Tool base class
// being the canonical example — ContainerRuntime is an interface, so type-only
// is fine here).
// ─────────────────────────────────────────────────────────────────────────────

import { Readable, Writable, PassThrough } from 'node:stream';
import type { PluginApi, PluginModule } from '@lace/agent/plugins';
import type {
  ContainerRuntime,
  ContainerConfig,
  ContainerInfo,
  ContainerState,
  ExecOptions,
  ExecResult,
  ExecStreamOptions,
  ExecStreamHandle,
} from '@lace/agent/containers/types';

export const meta = { name: 'memory-runtime', namespace: 'mem', version: '1.0.0' };

// ── In-memory runtime ─────────────────────────────────────────────────────────
// Tracks containers in a Map. No real daemon interaction. Suitable as a test
// double or as the skeleton for a remote-exec backend.

interface StoredContainer {
  config: ContainerConfig;
  info: ContainerInfo;
}

class MemoryRuntime implements ContainerRuntime {
  private readonly containers = new Map<string, StoredContainer>();
  private idCounter = 0;

  create(config: ContainerConfig): string {
    const id = config.id ?? `mem-${++this.idCounter}`;
    const info: ContainerInfo = { id, state: 'created' };
    this.containers.set(id, { config, info });
    return id;
  }

  async start(containerId: string): Promise<void> {
    const entry = this.requireContainer(containerId);
    entry.info = { ...entry.info, state: 'running', startedAt: new Date() };
  }

  async stop(containerId: string, _timeout?: number): Promise<void> {
    const entry = this.requireContainer(containerId);
    entry.info = { ...entry.info, state: 'stopped', stoppedAt: new Date(), exitCode: 0 };
  }

  async remove(containerId: string): Promise<void> {
    this.requireContainer(containerId);
    this.containers.delete(containerId);
  }

  async exec(containerId: string, options: ExecOptions): Promise<ExecResult> {
    this.requireContainer(containerId);
    // Fake execution: echo the command back on stdout.
    return {
      stdout: options.command.join(' '),
      stderr: '',
      exitCode: 0,
    };
  }

  async execStream(containerId: string, options: ExecStreamOptions): Promise<ExecStreamHandle> {
    this.requireContainer(containerId);
    const stdin = new PassThrough() as unknown as Writable;
    const stdout = Readable.from([options.command.join(' ') + '\n']);
    const stderr = Readable.from([]) as Readable;
    return {
      stdin,
      stdout,
      stderr,
      wait: async () => ({ exitCode: 0 }),
      kill: () => undefined,
    };
  }

  inspect(containerId: string): ContainerInfo {
    return this.requireContainer(containerId).info;
  }

  list(): ContainerInfo[] {
    return Array.from(this.containers.values()).map((e) => e.info);
  }

  async daemonInspect(containerId: string): Promise<ContainerInfo | null> {
    return this.containers.get(containerId)?.info ?? null;
  }

  async adopt(config: ContainerConfig, state: ContainerState): Promise<void> {
    const id = config.id ?? `mem-adopted-${++this.idCounter}`;
    if (!this.containers.has(id)) {
      this.containers.set(id, { config, info: { id, state } });
    }
  }

  private requireContainer(containerId: string): StoredContainer {
    const entry = this.containers.get(containerId);
    if (!entry) throw new Error(`MemoryRuntime: container not found: ${containerId}`);
    return entry;
  }
}

// ── register ─────────────────────────────────────────────────────────────────
export function register(api: PluginApi): void {
  api.assertVersion(1);
  api.runtimes.register('mem/memory', new MemoryRuntime());
}

export default { meta, register } satisfies PluginModule;
