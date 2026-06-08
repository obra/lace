// ABOUTME: PRI-2012 B7.1 — proves the SELECTOR fields (persona/parentSessionId/
// ABOUTME: childSessionId) survive the FULL ContainerSpec→RuntimeSpec→ContainerSpec
// ABOUTME: round-trip down to the ContainerConfig handed to ContainerRuntime.create().

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { BaseContainerRuntime } from '../runtime';
import type {
  ContainerConfig,
  ContainerInfo,
  ExecResult,
  ExecStreamHandle,
  ExecStreamOptions,
} from '../types';
import { ContainerManager } from '../container-manager';
import { ProjectedContainerToolRuntime } from '../../tools/runtime/projected-container';
import {
  buildPersonaContainerSpec,
  containerSpecToRuntimeSpec,
  type PersonaContainerRuntime,
} from '../../jobs/persona-container-spec';

const PARENT_SESSION_ID = 'sess_pppppppp00000000';
const CHILD_SESSION_ID = 'sess_cccccccc00000000';
const SCRATCH_PATH = '/tmp/test-scratch';

const perInvocationRuntime: PersonaContainerRuntime = {
  type: 'container',
  containerSharing: 'per_invocation',
  image: 'devcontainer:latest',
  workingDirectory: '/work',
  mounts: [],
};

// Records every create() config so the test can assert the selector fields
// arrived. Only docker is faked — every spec-threading hop is the real code.
class RecordingRuntime extends BaseContainerRuntime {
  readonly createdConfigs: ContainerConfig[] = [];

  create(config: ContainerConfig): string {
    this.createdConfigs.push(config);
    const id = config.id ?? config.name ?? 'rec';
    this.containers.set(id, { id, state: 'created', mounts: config.mounts });
    this.registerMounts(id, config);
    return config.name ?? id;
  }
  async start(containerId: string): Promise<void> {
    const info = this.containers.get(containerId);
    if (info) info.state = 'running';
  }
  async stop(): Promise<void> {}
  async remove(): Promise<void> {}
  async exec(): Promise<ExecResult> {
    return { stdout: '', stderr: '', exitCode: 0 };
  }
  async execStream(_containerId: string, _options: ExecStreamOptions): Promise<ExecStreamHandle> {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    queueMicrotask(() => {
      stdout.end('ok');
      stderr.end();
    });
    return {
      stdin: new PassThrough(),
      stdout,
      stderr,
      wait: () => Promise.resolve({ exitCode: 0 }),
      kill: () => {},
    };
  }
  override async daemonInspect(containerId: string): Promise<ContainerInfo | null> {
    return this.containers.get(containerId) ?? null;
  }
}

describe('PRI-2012 B7.1 SELECTOR round-trip to create() config', () => {
  let runtime: RecordingRuntime;
  let manager: ContainerManager;

  beforeEach(() => {
    runtime = new RecordingRuntime();
    manager = new ContainerManager(runtime);
  });

  afterEach(() => {});

  it('threads persona/role/parentSessionId/childSessionId from a persona binding to create()', async () => {
    // Hops 1+2: build the daemon spec, then the projected runtime spec (the wire
    // descriptor shape). This is the exact production path buildPersonaProjected-
    // RuntimeBinding takes. Helper omitted — irrelevant to the selector thread.
    // personaName (the ROLE) is intentionally DISTINCT from environmentName so the
    // round-trip proves the role — not the environment — reaches create().
    const spec = buildPersonaContainerSpec({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'ephemeral-box-worker',
      environmentName: 'ephemeral-box',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: perInvocationRuntime,
      containerMounts: {},
    });
    const runtimeSpec = containerSpecToRuntimeSpec({ spec });

    // Hops 3+4: a real ContainerManager over the recording runtime, driven through
    // the real projected-container path (containerSpecFromDescriptor → materialize
    // → materializeOnce → create()).
    const projected = new ProjectedContainerToolRuntime({
      id: 'rt_selector',
      containerManager: manager,
      descriptor: { spec: runtimeSpec, cwd: '/work' },
    });

    await projected.process.exec(['true']);

    expect(runtime.createdConfigs).toHaveLength(1);
    const config = runtime.createdConfigs[0];
    // persona (the SELECTOR) is the environment; role is the persona/role name.
    expect(config.persona).toBe('ephemeral-box');
    expect(config.role).toBe('ephemeral-box-worker');
    expect(config.parentSessionId).toBe(PARENT_SESSION_ID);
    expect(config.childSessionId).toBe(CHILD_SESSION_ID);
  });
});
